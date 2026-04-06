/** Worktree operations — create and remove git worktrees with associated terminals. */

import { toast } from "solid-sonner";
import { client } from "./rpc";
import type { TerminalId } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useWorktreeOps(deps: {
  store: TerminalStore;
  handleCreate: (cwd?: string) => Promise<TerminalId>;
  handleKill: (id: TerminalId) => Promise<void>;
}) {
  const { store } = deps;

  async function handleCreateWorktree(repoPath: string) {
    const result = await client.git
      .worktreeCreate({ repoPath })
      .catch((err: Error) => {
        toast.error(`Failed to create worktree: ${err.message}`);
        throw err;
      });
    toast.success(`Created worktree at ${result.path}`);
    await deps.handleCreate(result.path);
    // Recent repos update reactively via trackRecentRepo → publishSystem
  }

  /** Kill a terminal and remove its worktree.
   *  Accepts an explicit ID so callers can snapshot it before confirming. */
  async function handleKillWorktree(targetId?: TerminalId) {
    const id = targetId ?? store.activeId();
    if (!id) return;
    const meta = store.getMetadata(id);
    const worktreePath = meta?.git?.isWorktree ? meta.git.worktreePath : null;
    const subs = store.getSubTerminalIds(id);
    for (const subId of subs) await deps.handleKill(subId);
    await deps.handleKill(id);
    if (worktreePath) {
      await client.git.worktreeRemove({ worktreePath }).catch((err: Error) => {
        toast.error(`Failed to remove worktree: ${err.message}`);
        throw err;
      });
      toast.success(`Removed worktree at ${worktreePath}`);
    }
  }

  return {
    handleCreateWorktree,
    handleKillWorktree,
  };
}
