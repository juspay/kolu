import type { Logger } from "@kolu/surface-daemon";
import { makeFailureLedger } from "@kolu/surface/failure-ledger";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect } from "effect";
import { kavalDaemonGroup } from "./daemonSurface.ts";
import { ptyHostClientOver } from "./ptyHostClient.ts";

export const SELF_PROBE_INTERVAL_MS = 10_000;

export const SELF_PROBE_DEADLINE_MS = SELF_PROBE_INTERVAL_MS / 2;

export const SUSPENSION_GAP_MS = SELF_PROBE_INTERVAL_MS * 2;

export function isResumeAfterSuspension(
  lateByMs: number,
  gapMs = SUSPENSION_GAP_MS,
): boolean {
  return lateByMs > gapMs;
}

export const SELF_PROBE_CEILING = 3;

function selfProbe(socketPath: string): Effect.Effect<void, unknown> {
  const bounded = <A, E>(
    read: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> =>
    Effect.timeoutOrElse(read, {
      duration: SELF_PROBE_DEADLINE_MS,
      orElse: () =>
        Effect.fail(
          new Error(`self-probe timed out after ${SELF_PROBE_DEADLINE_MS}ms`),
        ),
    });
  return Effect.scoped(
    Effect.flatMap(
      Effect.acquireRelease(
        bounded(
          Effect.promise(() =>
            unixSocketLink({ group: kavalDaemonGroup, socketPath }),
          ),
        ),
        (link) => Effect.promise(() => link.dispose()),
      ),
      (link) =>
        Effect.asVoid(
          bounded(ptyHostClientOver(link.dispatch).surface.system.version({})),
        ),
    ),
  );
}

export interface KavalSelfLivenessOptions {
  readonly socketPath: string;
  readonly log: Logger;
  readonly onExhausted: () => void;
  readonly pollMs?: number;
}

function unrefPoll(opts: {
  everyMs: number;
  onLate: (lateByMs: number) => void;
  tick: (signal: AbortSignal) => Promise<"continue" | "stop">;
}): () => void {
  const stopper = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = Date.now() + opts.everyMs;

  const arm = (): void => {
    dueAt = Date.now() + opts.everyMs;
    timer = setTimeout(() => void run(), opts.everyMs);
    timer.unref?.();
  };

  const run = async (): Promise<void> => {
    if (stopper.signal.aborted) return;
    opts.onLate(Date.now() - dueAt);
    const next = await opts.tick(stopper.signal);
    if (next === "continue" && !stopper.signal.aborted) arm();
  };

  arm();
  return () => {
    stopper.abort();
    clearTimeout(timer);
  };
}

export function startKavalSelfLiveness(
  opts: KavalSelfLivenessOptions,
): () => void {
  const ledger = makeFailureLedger({
    selfProbe: { ceiling: SELF_PROBE_CEILING },
  });
  const everyMs = opts.pollMs ?? SELF_PROBE_INTERVAL_MS;

  return unrefPoll({
    everyMs,
    onLate: (lateByMs) => {
      if (!isResumeAfterSuspension(lateByMs, everyMs * 2)) return;
      ledger.success();
      opts.log.info(
        { lateByMs },
        "kaval self-liveness: the clock jumped (the process was suspended) — self-probe budget reset",
      );
    },
    tick: async (signal) => {
      const failure = await Effect.runPromise(
        Effect.match(selfProbe(opts.socketPath), {
          onSuccess: () => undefined,
          onFailure: (err: unknown) => err ?? new Error("self-probe failed"),
        }),
      ).catch((err: unknown) => err ?? new Error("self-probe defect"));

      if (signal.aborted) return "stop";
      if (failure === undefined) {
        ledger.success();
        return "continue";
      }
      const verdict = ledger.record("selfProbe");
      if (!verdict.exhausted) {
        opts.log.debug(
          { err: failure, run: verdict.run, ceiling: verdict.ceiling },
          "kaval self-liveness: self-probe failed",
        );
        return "continue";
      }
      opts.log.error(
        { err: failure, run: verdict.run, ceiling: verdict.ceiling },
        `FATAL: kaval self-liveness — ${verdict.run} consecutive self-probes failed (ceiling ${verdict.ceiling}). This daemon accepts connections and cannot serve them; exiting non-zero so its padi respawns it, rather than staying comatose.`,
      );
      opts.onExhausted();
      return "stop";
    },
  });
}
