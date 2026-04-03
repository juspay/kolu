/** Worktree operations — create and remove git worktrees with associated terminals. */

import { createMutation } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { orpc } from "./orpc";
import { useServerState } from "./useServerState";
import type { TerminalId } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useWorktreeOps(deps: {
  store: TerminalStore;
  handleCreate: (cwd?: string) => Promise<TerminalId>;
  handleKill: (id: TerminalId) => Promise<void>;
}) {
  const { store } = deps;
  const { invalidate: invalidateState } = useServerState();

  const worktreeCreateMut = createMutation(() => ({
    ...orpc.git.worktreeCreate.mutationOptions(),
    onError: (err: Error) =>
      toast.error(`Failed to create worktree: ${err.message}`),
  }));

  const worktreeRemoveMut = createMutation(() => ({
    ...orpc.git.worktreeRemove.mutationOptions(),
    onError: (err: Error) =>
      toast.error(`Failed to remove worktree: ${err.message}`),
  }));

  async function handleCreateWorktree(repoPath: string) {
    const result = await worktreeCreateMut.mutateAsync({ repoPath });
    toast.success(`Created worktree at ${result.path}`);
    await deps.handleCreate(result.path);
    invalidateState();
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
      await worktreeRemoveMut.mutateAsync({ worktreePath });
      toast.success(`Removed worktree at ${worktreePath}`);
      invalidateState();
    }
  }

  return {
    handleCreateWorktree,
    handleKillWorktree,
  };
}
