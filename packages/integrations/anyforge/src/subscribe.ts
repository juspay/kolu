/** The generic PR watcher — forge-agnostic poll/dedup/pending/emit-guard
 *  machinery, one instance per terminal for its whole life.
 *
 *  Mirrors `kolu-git`'s `subscribeGitInfo` shape: the caller wires the
 *  watcher to its own git source (channel subscription, signal, whatever)
 *  via `setGit`, and receives resolved `PrResult` values through `onChange`.
 *
 *  Owns: git-context dedup, result dedup (via `prResultEqual`), pending
 *  emission on a context change (so stale PR info doesn't linger while a
 *  resolve is in flight), and a 30s polling loop that re-resolves on the
 *  last-seen context (PRs can be created/updated externally).
 *
 *  Does not own: the git source, metadata publishing, terminal lifecycle,
 *  or *which* forge answers — the single `provider` is injected, so the
 *  watcher is forge-agnostic without ever naming a forge, mirroring how
 *  `startAgentProvider` takes one `AgentProvider`. */

import type { Logger } from "kolu-shared";
import type { PrGitContext, PrProvider } from "./provider.ts";
import {
  type PrResult,
  prResultEqual,
  type PrUnavailableSourceBase,
} from "./schemas.ts";

const POLL_INTERVAL_MS = 30_000;

/** Watcher handle returned by `subscribePr`. */
export interface PrWatcher {
  /** Feed the latest git state. Context dedup happens internally; a real
   *  change triggers a synchronous `{ kind: "pending" }` emit followed by
   *  an async resolve that emits the result. Pass `null` when the
   *  terminal leaves a repo. */
  setGit: (git: PrGitContext | null) => void;
  /** Cancel the poll timer and stop accepting updates. */
  stop: () => void;
}

function gitContextEqual(
  a: PrGitContext | null,
  b: PrGitContext | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // `remoteUrl` is part of the resolve context: an upstream dispatcher routes
  // to a forge by the remote's host, so a remote-only change (`git remote
  // set-url`) must re-resolve and re-dispatch. Omitting it here would leave a
  // stale forge selection stuck until a branch/repo switch.
  return (
    a.repoRoot === b.repoRoot &&
    a.branch === b.branch &&
    a.remoteUrl === b.remoteUrl
  );
}

/** Subscribe to PR changes for a terminal. `provider` is the single
 *  injected forge adapter that resolves every PR for this watcher — the
 *  watcher is forge-agnostic because the provider is injected, mirroring
 *  how `startAgentProvider` takes one `AgentProvider`. */
export function subscribePr<S extends PrUnavailableSourceBase>(
  provider: PrProvider<S>,
  onChange: (pr: PrResult<S>) => void,
  log?: Logger,
): PrWatcher {
  let lastGit: PrGitContext | null = null;
  let lastPr: PrResult<S> = { kind: "pending" };
  let stopped = false;

  function emit(pr: PrResult<S>): void {
    if (stopped || prResultEqual(pr, lastPr)) return;
    lastPr = pr;
    // `onChange` is the caller's callback (a metadata write that can throw).
    // Guard it here — the single funnel every emission path passes through —
    // so a throwing consumer degrades this terminal's PR metadata instead of
    // escaping: synchronously out of `setGit` into the git channel's consume
    // loop, or as an unhandled rejection out of the floated `fetchAndEmit`.
    try {
      onChange(pr);
    } catch (err) {
      log?.error({ err }, "pr watcher: emit failed");
    }
  }

  async function fetchAndEmit(git: PrGitContext): Promise<void> {
    try {
      const pr = await provider.resolve(git, log);
      // Drop a result whose git context is no longer current. A resolve is
      // async, so a branch/repo switch (or leaving the repo via
      // `setGit(null)`) can land `lastGit` on a different context — or null —
      // while this one is in flight. Emitting here would overwrite the fresh
      // context's PR with a stale one; worse, after `setGit(null)` the poll
      // stops, so a late stale emit would never be corrected and would
      // persist. Re-check against `lastGit` immediately before publishing.
      if (!gitContextEqual(git, lastGit)) return;
      emit(pr);
    } catch (err) {
      // The provider contract says resolve() classifies failures into
      // PrResult and never throws. Guard anyway so a misbehaving adapter
      // degrades this terminal's PR metadata instead of escaping the
      // floated call as an unhandled rejection; the next poll retries.
      log?.error({ err }, "pr watcher: resolve threw");
    }
  }

  function setGit(git: PrGitContext | null): void {
    if (gitContextEqual(git, lastGit)) return;
    log?.debug(
      { from: lastGit?.branch ?? null, to: git?.branch ?? null },
      "git context changed, re-resolving",
    );
    lastGit = git;
    // Emit pending so stale PR info doesn't linger while resolve is in
    // flight. If we already last-emitted pending, dedup inside `emit`
    // makes this a no-op.
    emit({ kind: "pending" });
    if (git) void fetchAndEmit(git);
  }

  const pollTimer = setInterval(() => {
    if (lastGit) {
      log?.debug({ branch: lastGit.branch }, "poll tick");
      void fetchAndEmit(lastGit);
    }
  }, POLL_INTERVAL_MS);

  return {
    setGit,
    stop: () => {
      stopped = true;
      clearInterval(pollTimer);
      log?.debug({ branch: lastGit?.branch ?? null }, "stopped");
    },
  };
}
