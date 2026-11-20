import type { Logger } from "@kolu/log";
import {
  type FailureClassSpec,
  makeFailureLedger,
} from "@kolu/surface/failure-ledger";
import { Effect } from "effect";
import { HOST_INVENTORY_SAMPLE_INTERVAL_MS } from "./hostInventory.ts";
import { type KavalObservation, observeHeldKaval } from "./kavalObservation.ts";
import { recycleLocalKaval } from "./ptyHost/restartLocal.ts";

export type KavalFailureClass =
  Exclude<KavalObservation["kind"], "healthy"> extends infer K
    ? K | "unrepaired"
    : never;

/** Consecutive failing probes a daemon gets before the verdict is believed —
 *  the probe cadence spent over `windowMs` of continuous failure. */
const consecutiveProbesOver = (windowMs: number): number =>
  Math.ceil(windowMs / HOST_INVENTORY_SAMPLE_INTERVAL_MS);

const COMA_WINDOW_MS = 30_000;

/** Automatic recycles launched without a healthy probe in between, after which
 *  the supervisor stands down: a fourth respawn is a hot loop, not a repair. */
const REPAIR_CEILING = 3;

export const KAVAL_SUPERVISION_SPEC: Record<
  KavalFailureClass,
  FailureClassSpec
> = {
  wedged: { ceiling: consecutiveProbesOver(COMA_WINDOW_MS), resets: [] },
  unreachable: { ceiling: consecutiveProbesOver(COMA_WINDOW_MS), resets: [] },
  unrepaired: {
    ceiling: REPAIR_CEILING,
    resets: ["wedged", "unreachable"],
  },
};

export interface KavalSupervisorDeps {
  readonly repair: () => Effect.Effect<void, unknown>;
  readonly log: Logger;
  readonly onRecovered: () => void;
}

export interface KavalSupervisor {
  observe(observation: KavalObservation): Effect.Effect<void>;
}

export function makeKavalSupervisor(
  deps: KavalSupervisorDeps,
): KavalSupervisor {
  const ledger = makeFailureLedger(KAVAL_SUPERVISION_SPEC);
  let standingDown = false;
  let repairing = false;
  let awaitingProof = false;

  return {
    observe: (observation) =>
      Effect.suspend(() => {
        if (repairing) return Effect.void;

        if (observation.kind === "healthy") {
          ledger.success();
          standingDown = false;
          if (awaitingProof) {
            awaitingProof = false;
            deps.log.info(
              {},
              "kaval supervision: the recycled kaval is serving again",
            );
            deps.onRecovered();
          }
          return Effect.void;
        }

        const verdict = ledger.record(observation.kind);
        if (!verdict.exhausted) return Effect.void;
        if (standingDown) return Effect.void;

        const spent = ledger.record("unrepaired");
        standingDown = spent.exhausted;
        repairing = true;
        awaitingProof = true;
        deps.log.error(
          {
            verdict: observation.kind,
            run: verdict.run,
            ceiling: verdict.ceiling,
            repairAttempt: spent.run,
            repairCeiling: spent.ceiling,
            err: observation.kind === "wedged" ? observation.err : undefined,
          },
          `kaval supervision: ${verdict.run} consecutive '${observation.kind}' probes (ceiling ${verdict.ceiling}) — recycling the daemon`,
        );
        return deps.repair().pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              deps.log.error(
                { err },
                "kaval supervision: the automatic recycle failed; the captured session is safe on disk and the kaval card stands",
              );
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              repairing = false;
              if (standingDown) {
                deps.log.error(
                  { repairCeiling: spent.ceiling },
                  "kaval supervision: standing down — the daemon did not come back across the repair budget; no further automatic recycle until a probe succeeds",
                );
              }
            }),
          ),
        );
      }),
  };
}

/** Run `tick` every `everyMs`, chained so one run never overlaps the next, on
 *  an `unref`'d timer so the loop never holds a draining padi open. Returns the
 *  stop. */
function unrefPollLoop(everyMs: number, tick: () => Promise<void>): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick().then(schedule);
    }, everyMs);
    timer.unref?.();
  };

  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

export function startKavalSupervision(opts: {
  readonly stateRoot: string;
  readonly log: Logger;
  readonly onRecovered: () => void;
  readonly pollMs?: number;
}): () => void {
  const supervisor = makeKavalSupervisor({
    repair: () => recycleLocalKaval("supervision"),
    log: opts.log,
    onRecovered: opts.onRecovered,
  });
  const everyMs = opts.pollMs ?? HOST_INVENTORY_SAMPLE_INTERVAL_MS;
  return unrefPollLoop(everyMs, async () => {
    try {
      const observation = await Effect.runPromise(
        observeHeldKaval(opts.stateRoot),
      );
      await Effect.runPromise(supervisor.observe(observation));
    } catch (err) {
      opts.log.error({ err }, "kaval supervision: tick threw; cadence held");
    }
  });
}
