import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
import {
  markRosterEstablished,
  markRosterSettling,
} from "../attention/fleetGate.ts";
import {
  type AutosaveFreeze,
  cancelPendingAutosave,
  freezeAutosave,
  unfreezeAutosave,
} from "../session/autosaveGate.ts";
import { log } from "../log.ts";
import { setSavedSessionFromSnapshot } from "../session/session.ts";
import { parkSavedSession } from "../terminalEndpoint/reattach.ts";
import { killAllTerminals, snapshotSession } from "../terminals.ts";
import { Effect } from "effect";
import { HANDSHAKE_READ_DEADLINE_MS } from "./connect.ts";
import { restartLocalEndpoint } from "./index.ts";

/** Wait for `work`, abandoning the WAIT — never the work — once `ms` elapses.
 *  A promise race rather than `Effect.timeout`, because the work it wraps has no
 *  `AbortSignal`: the effect around it is uninterruptible, so a fiber timeout
 *  would wait for the very thing it is meant to give up on. */
function raceDeadline<A>(
  work: Promise<A>,
  ms: number = HANDSHAKE_READ_DEADLINE_MS,
): Promise<A | "deadline"> {
  const { promise, resolve } = Promise.withResolvers<"deadline">();
  const timer = setTimeout(() => resolve("deadline"), ms);
  timer.unref?.();
  return Promise.race([work, promise]).finally(() => clearTimeout(timer));
}

/** Restart the local kaval daemon, preserving the session. Succeeds once the
 *  fresh daemon is connected (or fails if the recycle failed — the endpoint
 *  has already reported `dead`, and the captured session is safe on disk for the
 *  user to retry or restore). Concurrent calls coalesce onto one restart. */
export function restartLocalDaemon(): Effect.Effect<void, unknown> {
  return Effect.suspend(() => {
    let freeze: AutosaveFreeze | undefined;
    return restartLocalEndpoint({
      capture: Effect.sync(() => {
        log.info({}, "session-trace restart: capture");
        markRosterSettling();
        freeze = freezeAutosave(
          "restart critical section (capture→drain→park)",
        );
        setSavedSessionFromSnapshot(snapshotSession());
      }),
      drain: () =>
        Effect.gen(function* () {
          log.info({}, "session-trace restart: drain (killAll)");
          const drained = yield* Effect.promise(() =>
            raceDeadline(killAllTerminals()),
          );
          if (drained === "deadline") {
            log.warn(
              { deadlineMs: HANDSHAKE_READ_DEADLINE_MS },
              "session-trace restart: drain (killAll) did not answer within the deadline — the daemon is unserving; proceeding to the recycle, which takes the PTYs anyway",
            );
          }
        }),
      reattach: () =>
        Effect.sync(() => {
          log.info({}, "session-trace restart: reattach (park)");
          parkSavedSession();
          markRosterEstablished();
        }),
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (freeze !== undefined) unfreezeAutosave(freeze);
          cancelPendingAutosave();
        }),
      ),
    );
  });
}

/** Who asked for the recycle. Not a policy switch — every trigger runs the SAME
 *  routine; this is only what the journal says about who pressed it. */
export type KavalRecycleTrigger = "Restart kaval" | "supervision";

export function recycleLocalKaval(
  trigger: KavalRecycleTrigger,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    log.info({ trigger }, `recycle kaval (${trigger})`);
    yield* Effect.catch(restartLocalDaemon(), (err) => {
      log.error(
        { err, trigger },
        isContractSkewError(err)
          ? `recycle kaval (${trigger}) failed — endpoint reported incompatible (contract skew); captured session is safe on disk`
          : `recycle kaval (${trigger}) failed — endpoint reported dead/degraded; captured session is safe on disk`,
      );
      return Effect.fail(err);
    });
  });
}
