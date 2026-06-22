/**
 * The `pulam-tui git-status` data layer — subscribe to the surface's
 * `subscribeRepoChange` watcher stream and re-query `git.getStatus` on each
 * `{seq}` pulse. This is the pulse-then-requery loop R4.7 proves: the
 * `subscribeRepoChange` stream + `git.getStatus` procedure, end to end over a
 * real link (stdioLink or unixSocketLink), with the result pushed to a sink the
 * view paints.
 *
 * No OpenTUI, no Solid here: the sink is plain callbacks, so this is unit-tested
 * under Node with a fake client. `gitStatusView.tsx` wires the sink to a Solid
 * store; `bin.ts` supplies the real connector (`connectArivu` local,
 * `connectArivuViaHost` remote).
 *
 * The branch name comes from the awareness collection (read once at startup):
 * a terminal whose `git.repoRoot` or `git.worktreePath` matches `repoPath`
 * carries the branch. The awareness collection is the primitive R4.5 already
 * proved; R4.7 exercises the *other* arm — the fs/git procedures + watcher
 * streams.
 */

import type { GitStatusOutput } from "@kolu/terminal-workspace/surface";
import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import type { ArivuClient } from "./connect.ts";
import { snapshotAwareness } from "./read.ts";

/** One live update: the two status modes, the pulse counter, and any error
 *  from the latest re-query (null when it succeeded). The view projects this
 *  through `projectGitStatus`; an error surfaces rather than collapsing to an
 *  empty screen. */
export interface GitStatusUpdate {
  local: GitStatusOutput | null;
  branchMode: GitStatusOutput | null;
  seq: number;
  error: string | null;
}

/** Where the data layer pushes live state. `gitStatusView.tsx` implements it
 *  over a Solid store; the unit test records the calls. */
export interface GitStatusSink {
  onStatus: (update: GitStatusUpdate) => void;
}

export interface GitStatusHandle {
  dispose: () => void;
}

/** Find the branch name for `repoPath` by matching against the awareness
 *  collection's `git` fields. A terminal whose `git.repoRoot` or
 *  `git.worktreePath` equals `repoPath` carries the branch. Returns null when
 *  no terminal is in that repo (the branch is still unknown from awareness).
 *  A pure data-derivation function over awareness entries — lives in the data
 *  layer, not the projection layer, so the data→render dependency arrow
 *  points the right way (mirrors `fleet.ts` not importing from `render.ts`). */
export function branchFromAwareness(
  entries: Array<[string, AwarenessValue]>,
  repoPath: string,
): string | null {
  const normalized = repoPath.replace(/\/+$/, "");
  for (const [, v] of entries) {
    const git = v.git;
    if (!git) continue;
    if (
      git.repoRoot.replace(/\/+$/, "") === normalized ||
      git.worktreePath.replace(/\/+$/, "") === normalized
    ) {
      const branch = git.branch.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
      return branch || null;
    }
  }
  return null;
}

/** Subscribe to `subscribeRepoChange({ repoPath })` and re-query `git.getStatus`
 *  on each `{seq}` pulse. The first pulse (`seq: 0`) is the snapshot — the
 *  initial status is queried immediately. Each subsequent pulse (a file write,
 *  a `git add`, a branch switch) re-runs both `local` and `branch` mode queries
 *  and pushes the result to the sink.
 *
 *  Returns a handle that tears the subscription down (abort the stream + the
 *  in-flight queries). Errors from `git.getStatus` surface as
 *  `update.error` (the loop continues — a transient git error shouldn't kill
 *  the view); an error from the subscription itself (the link dropped) ends
 *  the loop. */
export function startGitStatus(opts: {
  client: ArivuClient;
  repoPath: string;
  sink: GitStatusSink;
}): GitStatusHandle {
  const abort = new AbortController();
  void (async () => {
    try {
      const stream = await opts.client.surface.subscribeRepoChange.get(
        { repoPath: opts.repoPath },
        { signal: abort.signal },
      );
      for await (const pulse of stream) {
        if (abort.signal.aborted) break;
        await requery(opts, pulse.seq, abort.signal);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        opts.sink.onStatus({
          local: null,
          branchMode: null,
          seq: 0,
          error: (err as Error).message,
        });
      }
    }
  })();
  return {
    dispose: () => abort.abort(),
  };
}

/** Re-query both `local` and `branch` mode statuses and push the result. A
 *  failure in either query surfaces as `error` (the other result is still
 *  included if it succeeded); the loop continues for the next pulse. */
async function requery(
  opts: {
    client: ArivuClient;
    repoPath: string;
    sink: GitStatusSink;
  },
  seq: number,
  signal: AbortSignal,
): Promise<void> {
  let local: GitStatusOutput | null = null;
  let branchMode: GitStatusOutput | null = null;
  let error: string | null = null;
  try {
    local = await opts.client.surface.git.getStatus({
      repoPath: opts.repoPath,
      mode: "local",
    });
  } catch (err) {
    error = (err as Error).message;
  }
  if (signal.aborted) return;
  try {
    branchMode = await opts.client.surface.git.getStatus({
      repoPath: opts.repoPath,
      mode: "branch",
    });
  } catch (err) {
    if (error === null) error = (err as Error).message;
  }
  if (signal.aborted) return;
  opts.sink.onStatus({ local, branchMode, seq, error });
}

/** One-shot: read the awareness collection (for the branch name) and the
 *  `git.getStatus` procedures (both modes), without subscribing to the watcher
 *  stream. Used by `--json` and to seed the view before the first pulse.
 *  Query failures propagate (the fail-fast rule: a caught error must surface,
 *  never collapse to null). The awareness read is best-effort (a failure means
 *  the branch name is unknown, not that the git status is). */
export async function snapshotGitStatus(
  client: ArivuClient,
  repoPath: string,
): Promise<{
  branch: string | null;
  local: GitStatusOutput;
  branchMode: GitStatusOutput;
}> {
  const [entries, local, branchMode] = await Promise.all([
    snapshotAwareness(client).catch(
      () => [] as Array<[TerminalId, AwarenessValue]>,
    ),
    client.surface.git.getStatus({ repoPath, mode: "local" }),
    client.surface.git.getStatus({ repoPath, mode: "branch" }),
  ]);
  return {
    branch: branchFromAwareness(entries, repoPath),
    local,
    branchMode,
  };
}
