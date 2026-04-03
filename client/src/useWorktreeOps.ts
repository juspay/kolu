/** Worktree operations — create and remove git worktrees with associated terminals. */

import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { orpc } from "./orpc";
import type { TerminalId } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useWorktreeOps(deps: {
  store: TerminalStore;
  handleCreate: (cwd?: string) => Promise<TerminalId>;
  handleKill: (id: TerminalId) => Promise<void>;
}) {
  const { store } = deps;
  const qc = useQueryClient();
  const invalidateRepos = () =>
    void qc.invalidateQueries({ queryKey: orpc.git.recentRepos.key() });

  const worktreeCreateMut = createMutation(() =>
    orpc.git.worktreeCreate.mutationOptions(),
  );

  const worktreeRemoveMut = createMutation(() =>
    orpc.git.worktreeRemove.mutationOptions(),
  );

  async function handleCreateWorktree(repoPath: string) {
    const promise = worktreeCreateMut.mutateAsync({ repoPath });
    toast.promise(promise, {
      loading: "Creating worktree…",
      success: (r) => `Created worktree at ${r.path}`,
      error: (e) => `Failed to create worktree: ${e.message}`,
    });
    const result = await promise;
    await deps.handleCreate(result.path);
    invalidateRepos();
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
      const promise = worktreeRemoveMut.mutateAsync({ worktreePath });
      toast.promise(promise, {
        loading: "Removing worktree…",
        success: `Removed worktree at ${worktreePath}`,
        error: (e) => `Failed to remove worktree: ${e.message}`,
      });
      await promise;
      invalidateRepos();
    }
  }

  return {
    handleCreateWorktree,
    handleKillWorktree,
  };
}
