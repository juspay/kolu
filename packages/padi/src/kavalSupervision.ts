/**
 * STEADY-STATE kaval supervision (juspay/kolu#2101 N1) — the arm that makes
 * padi's diagnosis actionable.
 *
 * ## The doctrine this retires
 *
 * padi has always been able to SEE a dead kaval: `probeKavalStatus` dials the
 * local socket every 10 s and, in the field incident, correctly classified a
 * comatose daemon within ten seconds. It has always owned the full repair kit
 * too — the SIGTERM→SIGKILL reap ladder, the respawn, the session capture and
 * park — and already runs every piece of it at boot and behind the "Restart
 * kaval" button. What it lacked was permission: probing was PUBLISH-ONLY by
 * design, and the reap ladder's one call site was boot-time convergence. The
 * result was a supervisor that could diagnose but not treat, which is a
 * dashboard. Convergence was an event; this module makes it an invariant.
 *
 * ## Why a ledger and not a counter
 *
 * The verdicts come in two shapes and they must not spend each other's budget
 * — the exact disease `@kolu/surface/failure-ledger` was extracted to make
 * unrepresentable (#2101 M1). Each class owns its own run, its own ceiling, and
 * declares as DATA which runs a recording of it resets. See
 * {@link KAVAL_SUPERVISION_SPEC} for the ceilings and their derivations.
 *
 * ## Loudness (K3's idiom)
 *
 * Silence per tick, one structured line per DECISION. A probe that fails once
 * is a busy kaval and says nothing; the line is written when the ledger says
 * "exhausted", and it names the verdict, the run that tripped, and the ceiling.
 * A repair that lands stamps the recovery so the client can toast it once.
 */

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

/**
 * The adjudicated budgets. Every number here is derived from the probe cadence
 * (`HOST_INVENTORY_SAMPLE_INTERVAL_MS` = 10 s) and the probe deadline
 * (`PROBE_TIMEOUT_MS` = half of it = 5 s), and each derivation is written on the
 * literal because the ledger cannot check a domain claim.
 */
export const KAVAL_SUPERVISION_SPEC: Record<
  KavalFailureClass,
  FailureClassSpec
> = {
  /** **3 ≈ 30 s of coma.** One wedged probe is not evidence: the deadline is
   *  half the poll interval *deliberately sized against peak* — the load that
   *  broke the old 1500 ms budget was 24 terminals restoring with several agents
   *  resuming (#2101 G4) — so a single miss is a busy minute, and the transient
   *  negative is pinned by test. Three CONSECUTIVE misses is a daemon that could
   *  not answer three read-only verbs within 5 s, three times, across 30 s. That
   *  is past any honest busy spike; the field coma lasted hours.
   *
   *  `resets`: NONE. See `unreachable` below — the rule is stated once there. */
  wedged: { ceiling: 3, resets: [] },
  /** **3 — the same cadence math**, plus one extra reason it cannot be lower: a
   *  momentarily absent socket is exactly what padi's OWN recycle produces
   *  (kill → respawn window), and a supervisor that repaired on the first
   *  refusal would fight its own reap ladder. 30 s is comfortably past a ladder
   *  bounded in single-digit seconds.
   *
   *  `resets`: NONE, and this is the interleaving rule for BOTH failing classes.
   *  `@kolu/surface-remote`'s session resets its remote run on a network failure
   *  because an unreachable gap means the host WENT AWAY — the next blip is
   *  fresh evidence, not accumulation. Here the opposite holds: `wedged` and
   *  `unreachable` are the same claim ("this kaval cannot serve") observed
   *  through two different failure modes of one dying process, and the field
   *  incident FLAPPED between them (padi's established link died with
   *  `SocketWriteError` at wake, then the socket accepted and hung). A coma that
   *  alternates refuse/hang must still exhaust — so each class accumulates
   *  independently and only a HEALTHY probe (`success()`) clears either. The
   *  cost of the rule is a flapping coma taking up to 5 ticks instead of 3,
   *  which is the honest price of never being talked out of a verdict. */
  unreachable: { ceiling: 3, resets: [] },
  /** **3 auto-repairs without a healthy probe in between.** Recorded when a
   *  repair is LAUNCHED, cleared only by a subsequent healthy probe — because
   *  the repair resolving proves only that a fresh kaval connected, and
   *  "connects then hangs" is the very shape being repaired. Only a probe can
   *  prove a repair stuck.
   *
   *  Three is derived from what one costs: each repair is preceded by its own
   *  fresh 3-probe streak (see `resets`), so exhausting this class means ≥ 90 s
   *  of continuous coma across three complete capture→drain→SIGTERM→SIGKILL→
   *  respawn→park ladders. If three consecutive fresh kaval processes cannot
   *  answer a probe, the fault is not the daemon process and a fourth respawn is
   *  a hot loop, not a repair. At that point the auto-arm stands down and the
   *  card + one structured log are the honest surface — the "genuinely
   *  unrepairable" case the button was always for.
   *
   *  `resets`: `wedged` + `unreachable`. A repair replaces the process the
   *  evidence was about, so the next repair must be EARNED by a fresh streak
   *  against the NEW kaval rather than inherited from the dead one's history.
   *  This is what keeps the give-up bound at "three repairs", not "three
   *  repairs in the first 30 s and then one per tick forever". */
  unrepaired: { ceiling: 3, resets: ["wedged", "unreachable"] },
};

export interface KavalSupervisorDeps {
  /** The ONE repair routine — the same `recycleLocalKaval` the "Restart kaval"
   *  button's RPC invokes (one rule, one implementation). Resolves once a fresh
   *  kaval is connected; rejects with the captured session safe on disk. */
  readonly repair: () => Effect.Effect<void, unknown>;
  readonly log: Logger;
  /** Stamp the recovery so the client can announce it exactly once. Called only
   *  after a repair that a subsequent probe PROVED (the healthy edge), never on
   *  the repair's own resolution. */
  readonly onRecovered: () => void;
}

export interface KavalSupervisor {
  /** Fold one probe verdict into the ledger and act on its verdict. Never
   *  rejects: a supervisor that dies of its own repair failure is worse than the
   *  coma it was watching for. */
  observe(observation: KavalObservation): Effect.Effect<void>;
}

export function makeKavalSupervisor(
  deps: KavalSupervisorDeps,
): KavalSupervisor {
  const ledger = makeFailureLedger(KAVAL_SUPERVISION_SPEC);
  /** A one-bit MEMO of the ledger's own `unrepaired` verdict, not a second
   *  budget: the ledger has no way to READ a run without recording one, and
   *  re-recording per tick after the ceiling would keep the run climbing and the
   *  verdict permanently exhausted. Set from `record("unrepaired").exhausted`,
   *  cleared by the same healthy probe that clears the ledger. */
  let standingDown = false;
  /** A repair in flight. Probes taken DURING a recycle are meaningless — the
   *  kaval is deliberately down between the SIGTERM and the respawn — so they
   *  are dropped rather than recorded, which is also what keeps one slow repair
   *  from being counted by three ticks. */
  let repairing = false;
  /** Whether a repair has run since the last healthy probe — the edge
   *  `onRecovered` fires on. */
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
        // Per-tick silence is the point: one slow probe is a busy kaval, and a
        // line per tick would bury the line that matters.
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

/**
 * Install the steady-state supervision loop over the kaval THIS padi holds.
 * Returns a stop function (idempotent).
 *
 * ## Cadence, and why its own tick rather than the inventory scan's
 *
 * The cadence IS the inventory scan's — `HOST_INVENTORY_SAMPLE_INTERVAL_MS`,
 * imported rather than re-derived — but the tick is this loop's own. Riding the
 * scan looked cheaper (one dial instead of two) and is wrong for two reasons.
 * First, the scan probes every kaval on the host and REJECTS as a whole when any
 * one of them fails, so the verdict this supervisor needs would arrive fused with
 * verdicts about daemons it does not supervise. Second, the scan only probes what
 * `discoverKavalDaemons` found — and "the held socket's inode is gone" is one of
 * the two failure classes here, i.e. exactly the case the scan stops probing. A
 * supervisor whose sensor goes blind in one of its two failure modes is not a
 * supervisor. The cost of the second dial is three read-only RPCs per ten seconds
 * over a local unix socket.
 *
 * ## Timer choice — node timers, not Effect's Clock
 *
 * The same ruling `@kolu/heap-diag` wrote down, for the same two reasons, so the
 * next sweep does not re-litigate it: (1) the timer must be `unref`'d — a live
 * supervisor must never be the thing holding a draining padi open — and Effect
 * 4's default `Clock` sleeps on a plain, REF'd `setTimeout`
 * (`effect/src/internal/effect.ts`, `ClockImpl.sleepMillis`) with no unref, so
 * `Effect.sleep` / `Schedule.fixed` cannot express this timer without a bespoke
 * Clock service; and (2) this is a chained `setTimeout`, NOT `setInterval`, so a
 * slow probe (the wedged case takes the full 5 s deadline) can never overlap the
 * next one — the same idiom the screen-read sampler uses.
 *
 * ## Why nothing here is an unbounded wait or retry
 *
 * The loop is a POLL, not a retry: it does the same bounded work forever at a
 * fixed cadence and never accumulates state outside the ledger. Every wait inside
 * it is already bounded — the probe by `PROBE_TIMEOUT_MS`, the drain by the
 * handshake deadline, the reap by `reapHolder`'s SIGTERM→SIGKILL ladder — and the
 * REPAIRS are bounded by the ledger's `unrepaired` ceiling, after which the arm
 * stands down until a probe succeeds. There is no path here that waits on an
 * unresponsive peer without a deadline and no path that retries without a budget.
 */
export function startKavalSupervision(opts: {
  /** THIS padi's resolved state-root — resolves the held-kaval address, re-read
   *  every tick so a recycle that relocates the socket is followed. */
  readonly stateRoot: string;
  readonly log: Logger;
  /** Stamp the proven recovery for the client's one-shot toast. */
  readonly onRecovered: () => void;
  /** Poll cadence override, in ms — a TEST seam (like `daemonMain`'s
   *  `anchorPollMs`); production omits it and uses the inventory cadence. */
  readonly pollMs?: number;
}): () => void {
  const supervisor = makeKavalSupervisor({
    repair: () => recycleLocalKaval("supervision"),
    log: opts.log,
    onRecovered: opts.onRecovered,
  });
  const everyMs = opts.pollMs ?? HOST_INVENTORY_SAMPLE_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), everyMs);
    timer.unref?.();
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      // The SAME reading the link-loss arm's precondition takes — one
      // implementation in `kavalObservation.ts`, so the two arms cannot disagree
      // about what is standing at the rendezvous by drifting apart. (The scan's
      // poll cell absorbs the probe's defect channel a different way:
      // cell-locally, one stale tick.)
      const observation = await Effect.runPromise(
        observeHeldKaval(opts.stateRoot),
      );
      await Effect.runPromise(supervisor.observe(observation));
    } catch (err) {
      // `observe` handles its own repair failure, so reaching here means a DEFECT
      // — a bug in the supervision itself. Say so and keep the cadence: a
      // supervisor that stops watching because it threw once is the silence this
      // whole module exists to end.
      opts.log.error({ err }, "kaval supervision: tick threw; cadence held");
    }
    schedule();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
