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
import { restartLocalEndpoint } from "./index.ts";

/** Restart the local kaval daemon, preserving the session. Resolves once the
 *  fresh daemon is connected (or rejects if the recycle failed — the endpoint
 *  has already reported `dead`, and the captured session is safe on disk for the
 *  user to retry or restore). Concurrent calls coalesce onto one restart. */
export function restartLocalDaemon(): Promise<void> {
  // This restart's own freeze lease, captured at `capture` and released in the
  // `finally` — releasing THIS token only, never a concurrent restore's lease.
  let freeze: AutosaveFreeze | undefined;
  return restartLocalEndpoint({
    // Snapshot + persist BEFORE the kill — the session must outlive the daemon.
    capture: async () => {
      log.info({}, "session-trace restart: capture");
      // Freeze the autosave for the WHOLE critical section before anything can arm
      // it: the drain below kills the PTYs → they fire `terminals:dirty` → the 500ms
      // autosave would fire in the recycle GAP with an empty registry and no parked
      // entries yet, nulling the session we're about to capture, before park runs.
      freeze = freezeAutosave("restart critical section (capture→drain→park)");
      setSavedSessionFromSnapshot(snapshotSession());
    },
    // Tear down kolu's terminal layer; the recycle takes the PTYs themselves.
    drain: async () => {
      log.info({}, "session-trace restart: drain (killAll)");
      await killAllTerminals();
    },
    // B3.2: nothing survives a daemon kill — park the captured session so the
    // restore card shows and `session.restore` re-spawns it (W1.R6). Same
    // no-survivor parking the cold boot runs. (B3.3 adopts survivors here.)
    reattach: async () => {
      log.info({}, "session-trace restart: reattach (park)");
      parkSavedSession();
    },
  }).finally(() => {
    // Park has seeded the parked entries (`hasParkedTerminals()` guards the autosave
    // from here), OR the restart FAILED before park — either way lift THIS restart's
    // freeze lease (undefined if it failed before `capture` ran) and cancel any
    // drain-armed timer, so a failed restart can't null the captured session after the
    // freeze lifts. Releasing only our own token leaves a concurrent restore's lease
    // intact.
    if (freeze !== undefined) unfreezeAutosave(freeze);
    cancelPendingAutosave();
  });
}
