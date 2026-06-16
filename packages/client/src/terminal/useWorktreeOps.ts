/** Worktree operations — create and remove git worktrees with associated terminals. */

import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { client } from "../wire";
import type { TerminalStore } from "./useTerminalStore";

export function useWorktreeOps(deps: {
  store: TerminalStore;
  handleCreate: (cwd?: string) => Promise<TerminalId>;
  handleKill: (id: TerminalId) => Promise<void>;
}) {
  const { store } = deps;

  async function handleCreateWorktree(
    repoPath: string,
    name: string,
    initialCommand?: string,
  ) {
    const id = toast.loading("Creating worktree…");
    try {
      // Route the worktree to the active terminal's host (P3) so a remote tile's
      // worktree is created on the host the repo lives on; absent ⇒ local.
      const activeTerminal = store.activeId();
      const hostId = activeTerminal
        ? store.getMetadata(activeTerminal)?.location?.hostId
        : undefined;
      const result = await client.git.worktreeCreate({
        repoPath,
        name,
        hostId,
      });
      toast.success(`Created worktree at ${result.path}`, { id });
      const newTerminalId = await deps.handleCreate(result.path);
      // Recent repos update reactively via trackRecentRepo → publishSystem

      // Optional initial command (phase 2 of #452): write the agent command
      // to the new terminal's input so the agent starts immediately.
      //
      // PTY input is buffered: the shell reads `initialCommand\r` at its
      // first prompt once rc initialization completes. Works reliably in
      // practice, but has a latent race on slow-rc systems (NixOS with
      // many sourced files) where init output can interleave with command
      // echo. If that becomes visible in dogfooding, promote to a
      // server-side createTerminal parameter gated on a shell-ready
      // signal (OSC 133;A prompt mark) — a contract change deliberately
      // deferred out of phase 2 scope.
      if (initialCommand !== undefined) {
        await client.terminal
          .sendInput({ id: newTerminalId, data: `${initialCommand}\r` })
          .catch((err: Error) =>
            toast.error(`Failed to start agent: ${err.message}`),
          );
      }
    } catch (err) {
      // Toast surfaces the message; don't rethrow — the caller (palette
      // value-mode onSubmit) is fire-and-forget, and a rethrow leaks as
      // an unhandled rejection now that user-typed names make
      // WORKTREE_NAME_COLLISION a normal-flow error.
      toast.error(`Failed to create worktree: ${(err as Error).message}`, {
        id,
      });
    }
  }

  /** Kill a terminal and remove its worktree.
   *  Accepts an explicit ID so callers can snapshot it before confirming. */
  async function handleKillWorktree(targetId?: TerminalId) {
    const id = targetId ?? store.activeId();
    if (!id) return;
    const meta = store.getMetadata(id);
    const worktreePath = meta?.git?.isWorktree ? meta.git.worktreePath : null;
    // The terminal's host (P3) — remove the worktree on the host it lives on.
    const hostId = meta?.location?.hostId;
    const subs = store.getSubTerminalIds(id);
    for (const subId of subs) await deps.handleKill(subId);
    await deps.handleKill(id);
    if (worktreePath) {
      const tid = toast.loading("Removing worktree…");
      try {
        await client.git.worktreeRemove({ worktreePath, hostId });
        toast.success("Worktree removed", { id: tid });
      } catch (err) {
        toast.error(`Failed to remove worktree: ${(err as Error).message}`, {
          id: tid,
        });
        throw err;
      }
    }
  }

  return {
    handleCreateWorktree,
    handleKillWorktree,
  };
}
