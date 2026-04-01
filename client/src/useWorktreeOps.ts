/** Worktree operations — create and remove git worktrees with associated terminals. */

import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { orpc } from "./orpc";
import { client } from "./rpc";
import type { TerminalId, WorktreeAgent } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

/** Options for creating a worktree with an optional agent. */
export interface WorktreeCreateOpts {
  repoPath: string;
  agent: WorktreeAgent;
  dangerouslySkipPermissions: boolean;
  prompt: string;
}

/**
 * Wait for Claude Code to reach "waiting" state via the terminal metadata stream.
 * The `for await` loop automatically calls `.return()` on the async iterator
 * when we break out, releasing the server-side subscription.
 */
async function waitForClaudeReady(
  id: string,
  timeoutMs = 30_000,
): Promise<void> {
  const stream = await client.terminal.onMetadataChange({ id });
  const deadline = Date.now() + timeoutMs;
  for await (const meta of stream) {
    if (meta.claude?.state === "waiting") return;
    if (Date.now() > deadline)
      throw new Error("Claude Code did not become ready in time");
  }
  throw new Error("Stream ended before Claude Code became ready");
}

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

  async function handleCreateWorktree(opts: WorktreeCreateOpts) {
    const result = await worktreeCreateMut.mutateAsync({
      repoPath: opts.repoPath,
    });
    toast(`Created worktree at ${result.path}`);
    await deps.handleCreate(result.path);

    // Launch Claude Code in the newly active terminal
    if (opts.agent === "claude") {
      const id = store.activeId();
      if (id) {
        const args = ["claude"];
        if (opts.dangerouslySkipPermissions)
          args.push("--dangerously-skip-permissions");
        await client.terminal.sendInput({ id, data: args.join(" ") + "\n" });

        // Send prompt as the first user message once Claude Code is ready
        if (opts.prompt) {
          void waitForClaudeReady(id)
            .then(() =>
              client.terminal.sendInput({ id, data: opts.prompt + "\n" }),
            )
            .catch(() =>
              toast.error("Could not send prompt — Claude Code didn't start"),
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
