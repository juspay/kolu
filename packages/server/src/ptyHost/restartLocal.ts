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
 *   - **reattach** — a no-op here, by design. A B3.2 restart kills the daemon,
 *     so *nothing survives*: every terminal is one you still want, restored from
 *     the captured session on the now-empty canvas (no live survivors, no
 *     autosave race). The client's existing restore card drives that restore.
 *     (B3.3's adoption is what fills `reattach` — adopt the survivors.)
 *
 * See `docs/atlas/src/content/atlas/pty-daemon.mdx` (B3.2 — supervised restart).
 */

import { setSavedSessionFromSnapshot } from "../session.ts";
import { killAllTerminals, snapshotSession } from "../terminals.ts";
import { restartLocalEndpoint } from "./index.ts";

/** Restart the local kaval daemon, preserving the session. Resolves once the
 *  fresh daemon is connected (or rejects if the recycle failed — the endpoint
 *  has already reported `dead`, and the captured session is safe on disk for the
 *  user to retry or restore). Concurrent calls coalesce onto one restart. */
export function restartLocalDaemon(): Promise<void> {
  return restartLocalEndpoint({
    // Snapshot + persist BEFORE the kill — the session must outlive the daemon.
    capture: async () => {
      setSavedSessionFromSnapshot(snapshotSession());
    },
    // Tear down kolu's terminal layer; the recycle takes the PTYs themselves.
    drain: async () => {
      await killAllTerminals();
    },
    // B3.2: nothing survives a daemon kill — the empty canvas + preserved
    // session is the restore surface; the client drives it. (B3.3 adopts here.)
    reattach: async () => {},
  });
}
