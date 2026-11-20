import type { Logger } from "@kolu/log";
import type { ForgeAdapter, PrGitContext, PrResolveCause } from "./adapter.ts";
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
  /** ASK AGAIN, NOW — a re-resolve on the context already fed, for a caller
   *  that has learned the answer may have moved (the repository changed under
   *  it) and does not want to wait out the poll. It emits only if the answer
   *  is DIFFERENT, like every other resolve here, so calling it often costs a
   *  `gh` run and never a frame. A no-op before any context is fed. */
  refresh: () => void;
  /** Cancel the poll timer and stop accepting updates. */
  stop: () => void;
}

function gitContextEqual(
  a: PrGitContext | null,
  b: PrGitContext | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.repoRoot === b.repoRoot &&
    a.branch === b.branch &&
    a.remoteUrl === b.remoteUrl
  );
}

/** Subscribe to PR changes for a terminal. `adapter` is the single
 *  injected forge adapter that resolves every PR for this watcher — the
 *  watcher is forge-agnostic because the adapter is injected, mirroring
 *  how `startAgentSensor` takes one `AgentAdapter`. */
export function subscribePr<S extends PrUnavailableSourceBase>(
  adapter: ForgeAdapter<S>,
  onChange: (pr: PrResult<S>) => void,
  log?: Logger,
): PrWatcher {
  let lastGit: PrGitContext | null = null;
  let lastPr: PrResult<S> = { kind: "pending" };
  let stopped = false;

  function emit(pr: PrResult<S>): void {
    if (stopped || prResultEqual(pr, lastPr)) return;
    lastPr = pr;
    try {
      onChange(pr);
    } catch (err) {
      log?.error({ err }, "pr watcher: emit failed");
    }
  }

  async function fetchAndEmit(
    git: PrGitContext,
    cause: PrResolveCause,
  ): Promise<void> {
    try {
      const pr = await adapter.resolve(git, cause, log);
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
    emit({ kind: "pending" });
    if (git) void fetchAndEmit(git, "context");
  }

  const pollTimer = setInterval(() => {
    if (lastGit) {
      log?.debug({ branch: lastGit.branch }, "poll tick");
      void fetchAndEmit(lastGit, "poll");
    }
  }, POLL_INTERVAL_MS);

  return {
    setGit,
    refresh: () => {
      if (!stopped && lastGit) void fetchAndEmit(lastGit, "refresh");
    },
    stop: () => {
      stopped = true;
      clearInterval(pollTimer);
      log?.debug({ branch: lastGit?.branch ?? null }, "stopped");
    },
  };
}
