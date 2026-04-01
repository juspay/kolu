/** Worktree operations — create and remove git worktrees with associated terminals. */

import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { orpc } from "./orpc";
import { client } from "./rpc";
import type { TerminalId, WorktreeAgent } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export interface WorktreeCreateOpts {
  repoPath: string;
  agent: WorktreeAgent;
  dangerouslySkipPermissions: boolean;
  prompt: string;
}

/** Wait for Claude Code to reach "waiting" state via metadata stream. */
async function waitForClaudeReady(
  id: string,
  timeoutMs = 30_000,
): Promise<void> {
  const stream = await client.terminal.onMetadataChange({ id });
  const timeout = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), timeoutMs),
  );
  const ready = (async () => {
    for await (const meta of stream) {
      if (meta.claude?.state === "waiting") return;
    }
  })();
  await Promise.race([ready, timeout]);
}

export function useWorktreeOps(deps: {
  store: TerminalStore;
  handleCreate: (cwd?: string) => Promise<void>;
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

  async function handleCreateWorktree(opts: WorktreeCreateOpts) {
    const result = await worktreeCreateMut.mutateAsync({
      repoPath: opts.repoPath,
    });
    toast(`Created worktree at ${result.path}`);
    await deps.handleCreate(result.path);

    // Send agent command to the newly active terminal
    if (opts.agent === "claude") {
      const id = store.activeId();
      if (id) {
        let cmd = "claude";
        if (opts.dangerouslySkipPermissions)
          cmd += " --dangerously-skip-permissions";
        cmd += "\n";
        await client.terminal.sendInput({ id, data: cmd });
        // If a prompt was provided, send it as the first user message.
        // Wait for Claude Code to become ready (watching metadata state),
        // then type the prompt into the interactive session.
        if (opts.prompt) {
          void waitForClaudeReady(id).then(() =>
            client.terminal.sendInput({ id, data: opts.prompt + "\n" }),
          );
        }
      }
    }

    invalidateRepos();
  }

  async function handleKillWorktree() {
    const id = store.activeId();
    if (!id) return;
    const meta = store.activeMeta();
    const worktreePath = meta?.git?.isWorktree ? meta.git.worktreePath : null;
    const subs = store.getSubTerminalIds(id);
    for (const subId of subs) await deps.handleKill(subId);
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
