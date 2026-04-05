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
    try {
      const result = await client.git.worktreeCreate({ repoPath });
      toast.success(`Created worktree at ${result.path}`);
      await deps.handleCreate(result.path);
    } catch (err) {
      toast.error(
        `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
      try {
        await client.git.worktreeRemove({ worktreePath });
        toast.success(`Removed worktree at ${worktreePath}`);
      } catch (err) {
        toast.error(
          `Failed to remove worktree: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return {
    handleCreateWorktree,
    handleKillWorktree,
  };
}
