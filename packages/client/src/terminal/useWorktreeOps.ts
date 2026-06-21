/** Worktree operations — create and remove git worktrees with associated terminals. */

import { sleepingArm, type TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { client } from "../wire";
import type { TerminalStore } from "./useTerminalStore";

export function useWorktreeOps(deps: {
  store: TerminalStore;
  handleCreate: (cwd?: string) => Promise<TerminalId>;
  handleKill: (id: TerminalId) => Promise<void>;
  /** Discard a SLEEPING terminal's record — the dormant arm has no PTY, so the
   *  worktree-removal close path routes it here instead of the live kill RPC.
   *  Resolves `false` when the discard failed (and was toasted) so the caller
   *  can abort before removing the worktree out from under a still-live record. */
  handleDiscard: (id: TerminalId) => Promise<boolean>;
}) {
  const { store } = deps;

  async function handleCreateWorktree(
    repoPath: string,
    name: string,
    initialCommand?: string,
  ) {
    const id = toast.loading("Creating worktree…");
    try {
      const result = await client.git.worktreeCreate({ repoPath, name });
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

  /** Close a terminal and remove its worktree.
   *  Accepts an explicit ID so callers can snapshot it before confirming.
   *
   *  A SLEEPING terminal has no PTY to kill, so it takes the DISCARD path (F8) —
   *  routing it through the live `terminal.kill` RPC would try to kill a
   *  non-existent PTY and log a spurious pty-host kill error before unregistering.
   *  An active terminal (and any live sub-terminals) take the normal kill path. */
  async function handleKillWorktree(targetId?: TerminalId) {
    const id = targetId ?? store.activeId();
    if (!id) return;
    const meta = store.getMetadata(id);
    const worktreePath = meta?.git?.isWorktree ? meta.git.worktreePath : null;
    if (sleepingArm(meta)) {
      // No splits on a sleeping record (sleep closes them) and no PTY to kill —
      // discard the dormant record, then fall through to remove the worktree.
      // If the discard failed (toasted by handleDiscard), STOP (F10): removing
      // the worktree now would strand the still-present terminal at a deleted
      // cwd. The user can retry the close once the server is reachable again.
      const discarded = await deps.handleDiscard(id);
      if (!discarded) return;
    } else {
      const subs = store.getSubTerminalIds(id);
      for (const subId of subs) await deps.handleKill(subId);
      await deps.handleKill(id);
    }
    if (worktreePath) {
      const tid = toast.loading("Removing worktree…");
      try {
        await client.git.worktreeRemove({ worktreePath });
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
