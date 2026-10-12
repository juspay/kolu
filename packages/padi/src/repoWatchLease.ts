/**
 * `@kolu/padi/repoWatchLease` — padi's OWN reference on a repo's change watcher,
 * one per terminal living in that repo (juspay/kolu#2286).
 *
 * THE BUG THIS EXISTS FOR. kolu-git's repo-change watcher (four inotify
 * watchers: HEAD, reflog, index, working tree) used to be installed by exactly
 * one thing — a CLIENT `subscribeRepoChange` — and torn down the instant the
 * last client subscription left. The web client re-keys that subscription onto
 * the focused pane's repo, so a user alternating between two repos' panes made
 * padi tear four watchers down and build four more on every switch: 120 installs
 * + 120 retires per 5 minutes at a 2.5s focus cadence, with every fs event
 * landing in a rebuild gap simply lost. A watcher's lifetime was being decided by
 * a browser's focus.
 *
 * THE CURE. The lifetime becomes a fact padi already knows: which repos the
 * terminals ON THIS HOST are working in. Each ACTIVE terminal whose resolved
 * repo root is R holds one silent reference on R's watcher
 * (`endpoint.fs.holdRepoChange`), layered on top of the client-subscription
 * refcount inside kolu-git. A client subscription on a held repo then ATTACHES to
 * the live watcher — no install, no teardown, no gap — and a repo with no
 * reference at all still survives a re-key through kolu-git's retirement grace
 * window.
 *
 * THE SOURCE OF TRUTH IS THE REGISTRY, NOT A SECOND RESOLVE. The repo root is
 * read off `TerminalProcess.snapshot.git` — the git sensor already resolved it
 * and `commitSnapshot` already published it. This module never calls git.
 *
 * WHY THE ACTIVE ARM ONLY. A sleeping or parked entry has no PTY and no sensors:
 * its snapshot is frozen-stale, so "the repo it is in" is a memory, not a live
 * fact. Holding four inotify watchers open for it would be precisely the idle
 * waste #2286 is about. Wake re-publishes through `publishTerminalState`, which
 * re-syncs the lease, so the hold comes back with the process.
 */

import { log } from "./log.ts";
import { getTerminal } from "./terminal-registry.ts";
import { createTerminalWorkspaceEndpoint } from "./terminalWorkspace/endpoint.ts";

/** The local fs face. `createTerminalWorkspaceEndpoint` is a stateless wrapper
 *  over kolu-git's module-scope watcher registries — the same registries
 *  `terminalEndpoint/local.ts`'s own instance reaches — so constructing one here
 *  shares every watcher with the serving path rather than forking a second set.
 *  It is built at module scope (as `local.ts` builds its own) because the write
 *  seams that drive leases, `terminalEndpoint/metadata.ts`, are module-scope
 *  functions with no dep record to thread an endpoint through; an inject-later
 *  global would mean leases silently skipped for every commit before the inject. */
const { fs } = createTerminalWorkspaceEndpoint(log);

/** terminalId → the repo root padi currently holds for it, with that hold's
 *  release. Absent means "this terminal holds nothing" (no entry, not active, or
 *  outside a repo). */
const held = new Map<string, { repoRoot: string; release: () => void }>();

/** Reconcile `terminalId`'s repo-watch hold against the registry — the ONE lease
 *  seam, driven by the registry's own write seams (`installSnapshot`,
 *  `commitSnapshot`, `publishTerminalState`, `dropSnapshot` in
 *  `terminalEndpoint/metadata.ts`).
 *
 *  It reads the entry rather than taking a repo root as an argument so that
 *  "removed", "slept", "moved out of a repo" and "git not resolved yet" are all
 *  the SAME call with the same answer — a removal seam cannot forget to release,
 *  because releasing is just what reconciling a vanished entry does.
 *
 *  Idempotent and cheap: the overwhelmingly common case is the ~150ms snapshot
 *  firehose re-committing an unchanged repo root, which is one map lookup and a
 *  string compare. */
export function syncRepoWatchLease(terminalId: string): void {
  const entry = getTerminal(terminalId);
  // `handle` narrows the 3-arm union to the ACTIVE process (see the header's
  // "why the active arm only").
  const git = entry?.handle ? entry.snapshot.git : undefined;
  const repoRoot = git?.kind === "repo" ? git.info.repoRoot : undefined;

  const current = held.get(terminalId);
  if (current?.repoRoot === repoRoot) return;

  if (current) {
    held.delete(terminalId);
    current.release();
  }
  if (repoRoot === undefined) return;
  held.set(terminalId, { repoRoot, release: fs.holdRepoChange(repoRoot) });
}

/** Test-only — the repo root padi currently holds for each terminal. */
export function _repoWatchLeases(): Map<string, string> {
  return new Map([...held].map(([id, lease]) => [id, lease.repoRoot]));
}
