/** Worktree operations — create and remove git worktrees with associated workspaces. */

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
    toast(`Created worktree at ${result.path}`);
    await deps.handleCreate(result.path);
    invalidateRepos();
  }

  async function handleKillWorktree() {
    const id = store.activeId();
    if (!id) return;
    const meta = store.activeMeta();
    const worktreePath = meta?.git?.isWorktree ? meta.git.worktreePath : null;
    const terminals = store.getTerminalIds(id);
    for (const termId of terminals) await deps.handleKill(termId);
    await deps.handleKill(id);
    if (worktreePath) {
      await worktreeRemoveMut.mutateAsync({ worktreePath });
      toast(`Removed worktree at ${worktreePath}`);
      invalidateRepos();
    }
  }

  return {
    handleCreateWorktree,
    handleKillWorktree,
  };
}
