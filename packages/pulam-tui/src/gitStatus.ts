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
import { branchFromAwareness } from "./gitStatusRender.ts";
import { snapshotAwareness } from "./read.ts";

/** One live update: the two status modes, the pulse counter, and any error
 *  from the latest re-query (null when it succeeded). The view projects this
 *  through `projectGitStatus`; an error surfaces rather than collapsing to an
 *  empty screen. */
export interface GitStatusUpdate {
  local: GitStatusOutput | null;
  branch: GitStatusOutput | null;
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

/** The branch name resolved from the awareness collection, plus the awareness
 *  entries themselves (the view may re-derive the branch if a terminal's git
 *  info changes). Read once at startup — the branch name is slow-changing
 *  (kolu's sensors resolve it from cwd), and R4.7's proof is the *git status*
 *  pulse, not the awareness collection's liveness. */
export interface BranchInfo {
  branch: string | null;
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
  log?: (line: string) => void;
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
          branch: null,
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
    log?: (line: string) => void;
  },
  seq: number,
  signal: AbortSignal,
): Promise<void> {
  let local: GitStatusOutput | null = null;
  let branch: GitStatusOutput | null = null;
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
    branch = await opts.client.surface.git.getStatus({
      repoPath: opts.repoPath,
      mode: "branch",
    });
  } catch (err) {
    if (error === null) error = (err as Error).message;
  }
  if (signal.aborted) return;
  opts.sink.onStatus({ local, branch, seq, error });
}

/** One-shot: read the awareness collection (for the branch name) and the
 *  `git.getStatus` procedures (both modes), without subscribing to the watcher
 *  stream. Used by `--json` and to seed the view before the first pulse. */
export async function snapshotGitStatus(
  client: ArivuClient,
  repoPath: string,
): Promise<{
  branch: string | null;
  local: GitStatusOutput | null;
  branchMode: GitStatusOutput | null;
}> {
  const [entries, local, branchMode] = await Promise.all([
    snapshotAwareness(client).catch(
      () => [] as Array<[TerminalId, AwarenessValue]>,
    ),
    client.surface.git.getStatus({ repoPath, mode: "local" }).catch(() => null),
    client.surface.git
      .getStatus({ repoPath, mode: "branch" })
      .catch(() => null),
  ]);
  return {
    branch: branchFromAwareness(entries, repoPath),
    local,
    branchMode,
  };
}
