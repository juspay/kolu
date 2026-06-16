/**
 * `initialServerMeta` — the server-owned half of a freshly-spawned terminal's
 * metadata, before its provider DAG resolves git/PR/agent.
 *
 * Lives in `@kolu/terminal-dag` (which both hosts already depend on) so the
 * field set is defined ONCE. The only deliberate difference between the two
 * hosts is the initial `pr` kind — kolu-server seeds `pending` (its PR provider
 * is about to poll), kolu-watcher seeds `absent` — so that is the single
 * argument, not a forked object literal. Client-persisted fields (theme,
 * layout, …) are the caller's concern and are spread on top where needed.
 */

import type { PrResult, TerminalServerMetadata } from "kolu-common/surface";

/** The server-persisted + live defaults of a new terminal. `lastActivityAt: 0`
 *  means "no agent transition observed yet". `pr` is passed by the caller so the
 *  one deliberate local-vs-watcher difference is explicit. */
export function initialServerMeta(
  cwd: string,
  opts: { pr: PrResult },
): TerminalServerMetadata {
  return {
    cwd,
    git: null,
    lastActivityAt: 0,
    pr: opts.pr,
    agent: null,
    foreground: null,
  };
}
