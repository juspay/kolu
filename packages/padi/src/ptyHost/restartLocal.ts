/**
 * The soul of B3.2's supervised restart: kolu's session/terminal policy for
 * restarting the local kaval daemon without losing the session.
 *
 * The spine (`@kolu/surface-daemon-supervisor`) owns the *mechanism* — coalesce
 * concurrent triggers, hold `restarting`, run capture → drain → recycle →
 * reattach. This module fills those steps with what they MEAN for kolu:
 *
 *   - **capture** — snapshot the live terminals and persist them as the saved
 *     session, BEFORE the daemon is killed (the #1034 constraint: never
 *     kill-then-pray). `setSavedSessionFromSnapshot` is the F1 receptacle — it
 *     cancels any pending autosave so a stale `terminals:dirty` timer can't
 *     clobber the snapshot to null mid-restart, AND it preserves an existing
 *     saved session when the live registry is empty (e.g. a `dead` boot, where
 *     the daemon never came up so nothing is live, but a prior run's session is
 *     still on disk and is the only restore data) rather than erasing it.
 *   - **drain** — `killAllTerminals` tears down the provider DAGs and clears the
 *     registry. The daemon (about to be recycled) takes the PTYs with it; this
 *     just clears kolu's side so the canvas goes honestly empty. It fires no
 *     `terminals:dirty`, so it arms no autosave that could race the capture.
 *   - **reattach** — PARK the captured session (W1.R6). A B3.2 restart kills the
 *     daemon, so *nothing survives*: every terminal is one you still want,
 *     restored from the captured session on the now-empty canvas (no live
 *     survivors, no autosave race). `parkSavedSession` seeds a parked registry
 *     entry per saved active record so the restore card shows and
 *     `session.restore` re-spawns them — the same no-survivor parking the cold
 *     boot runs (`ensureLocalEndpoint`'s `onNotAdopted`). Previously a no-op that
 *     left the client to drive restore off the raw saved session; the parked
 *     entries are now the restore idempotency token. (B3.3's adoption is what
 *     fills `reattach` on the SURVIVOR path instead.)
 *
 * See `docs/atlas/src/content/atlas/pty-daemon.mdx` (B3.2 — supervised restart).
 */

import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
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

/** Restart the local kaval daemon, preserving the session. Succeeds once the
 *  fresh daemon is connected (or fails if the recycle failed — the endpoint
 *  has already reported `dead`, and the captured session is safe on disk for the
 *  user to retry or restore). Concurrent calls coalesce onto one restart. */
export function restartLocalDaemon(): Effect.Effect<void, unknown> {
  return Effect.suspend(() => {
    // This restart's own freeze lease, captured at `capture` and released in the
    // `ensuring` — releasing THIS token only, never a concurrent restore's lease.
    // A closure `let` rather than a `Ref`: it is written and read by ONE restart's
    // own steps, in order, and never leaves this expression.
    let freeze: AutosaveFreeze | undefined;
    return restartLocalEndpoint({
      // Snapshot + persist BEFORE the kill — the session must outlive the daemon.
      capture: Effect.sync(() => {
        log.info({}, "session-trace restart: capture");
        // Freeze the autosave for the WHOLE critical section before anything can arm
        // it: the drain below kills the PTYs → they fire `terminals:dirty` → the 500ms
        // autosave would fire in the recycle GAP with an empty registry and no parked
        // entries yet, nulling the session we're about to capture, before park runs.
        freeze = freezeAutosave(
          "restart critical section (capture→drain→park)",
        );
        setSavedSessionFromSnapshot(snapshotSession());
      }),
      // Tear down kolu's terminal layer; the recycle takes the PTYs themselves.
      drain: () =>
        Effect.gen(function* () {
          log.info({}, "session-trace restart: drain (killAll)");
          // `killAllTerminals` is padi’s own terminal-layer verb, Promise-shaped
          // by the endpoint handle it drives; it absorbs its own kill failure and
          // never rejects, so it is LIFTED rather than run.
          //
          // BOUNDED (#2101 N1). The drain sends `terminal.killAll` to the daemon
          // we are about to recycle — and the whole reason we may be recycling is
          // that that daemon ACCEPTS and never answers. Unbounded, this step waits
          // forever on a comatose peer and the recycle never reaches the reap
          // ladder that would have fixed it: the repair deadlocks on the fault.
          // The deadline is the SAME baked constant the handshake read uses, and
          // for the same reason — a kaval that has not answered one RPC in ten
          // seconds is not busy, it is wedged — reused rather than re-derived.
          // Losing the race abandons the WAIT, not the work: the underlying
          // promise settles whenever it settles, and it is moot either way
          // because `reapHolder`'s SIGTERM→SIGKILL takes the PTYs next. Skipping
          // the courtesy drain costs a less graceful shell teardown; waiting on it
          // forever costs the entire repair.
          //
          // The deadline is a PROMISE race, not `Effect.timeout`: `killAllTerminals`
          // is a bare promise with no `AbortSignal`, so the effect wrapping it is
          // UNINTERRUPTIBLE and a fiber timeout would dutifully wait for the very
          // thing it was meant to give up on. (Observed: the recycle parked on this
          // line for the whole life of a SIGSTOP'd kaval, with `Effect.timeoutOrElse`
          // in place.) Racing the promise abandons the WAIT for real.
          const drained = yield* Effect.promise(() =>
            Promise.race([
              killAllTerminals().then(() => true as const),
              new Promise<false>((resolve) => {
                const t = setTimeout(
                  () => resolve(false),
                  HANDSHAKE_READ_DEADLINE_MS,
                );
                t.unref?.();
              }),
            ]),
          );
          if (!drained) {
            log.warn(
              { deadlineMs: HANDSHAKE_READ_DEADLINE_MS },
              "session-trace restart: drain (killAll) did not answer within the deadline — the daemon is unserving; proceeding to the recycle, which takes the PTYs anyway",
            );
          }
        }),
      // B3.2: nothing survives a daemon kill — park the captured session so the
      // restore card shows and `session.restore` re-spawns it (W1.R6). Same
      // no-survivor parking the cold boot runs. (B3.3 adopts survivors here.)
      reattach: () =>
        Effect.sync(() => {
          log.info({}, "session-trace restart: reattach (park)");
          parkSavedSession();
        }),
    }).pipe(
      // Park has seeded the parked entries (`hasParkedTerminals()` guards the autosave
      // from here), OR the restart FAILED before park — either way lift THIS restart's
      // freeze lease (undefined if it failed before `capture` ran) and cancel any
      // drain-armed timer, so a failed restart can't null the captured session after the
      // freeze lifts. Releasing only our own token leaves a concurrent restore's lease
      // intact. `ensuring` rather than a `finally`, so an INTERRUPTED restart lifts the
      // lease too — a `finally` around an `await` never got that.
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
export type KavalRecycleTrigger =
  /** The user pressed the card's button (`lifecycle.recycleKaval`). */
  | "Restart kaval"
  /** `kavalSupervision` exhausted the held kaval's failure ledger (#2101 N1). */
  | "supervision";

/**
 * THE recycle routine — narrate, restart, narrate the failure. One rule, one
 * implementation, two callers (#2101 N1): the "Restart kaval" button's RPC and
 * the steady-state supervisor. Before N1 this body lived inside the RPC handler,
 * which is why automating the button meant either a second copy of it or a
 * supervisor that called a differently-narrated path; now the only thing the two
 * callers do differently is what they do with the REJECTION — the RPC retypes a
 * contract skew as a declared wire error (SK6), the supervisor folds it into its
 * ledger — and neither of those is part of recycling.
 *
 * Rejects with the captured session safe on disk; the endpoint has already
 * reported its terminal state by then.
 */
export function recycleLocalKaval(
  trigger: KavalRecycleTrigger,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    log.info({ trigger }, `recycle kaval (${trigger})`);
    yield* Effect.catch(restartLocalDaemon(), (err) => {
      // A failed restart otherwise surfaces ONLY as a client toast — padi's
      // journal would show the "recycle kaval" start line and then an
      // unexplained silence. Surface it: the endpoint has already reported its
      // terminal state and the captured session is safe on disk (the user can
      // retry or restore), but the failure must be legible in the journal —
      // naming the ACTUAL state (skew → `incompatible`).
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
