/** Worktree operations — create and remove git worktrees with associated terminals. */

import { sleepingArm } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";
import { activePadiRpc } from "../wire";
import type {
  TerminalCreateRefused,
  TerminalDiscardFailed,
} from "./useTerminalCrud";
import type { TerminalStore } from "./useTerminalStore";

export function useWorktreeOps(deps: {
  store: TerminalStore;
  handleCreate: (
    cwd?: string,
  ) => Effect.Effect<TerminalId, TerminalCreateRefused>;
  handleKill: (id: TerminalId) => UiAction;
  /** Discard a SLEEPING terminal's record — the dormant arm has no PTY, so the
   *  worktree-removal close path routes it here instead of the live kill RPC.
   *  FAILS when the discard failed (and was toasted) so the caller aborts before
   *  removing the worktree out from under a still-live record — a fact this
   *  module cannot forget to check, where the old `Promise<boolean>` was one it
   *  could. */
  handleDiscard: (id: TerminalId) => Effect.Effect<void, TerminalDiscardFailed>;
}) {
  const { store } = deps;

  function handleCreateWorktree(
    repoPath: string,
    name: string,
    initialCommand?: string,
  ): UiAction {
    return Effect.suspend(() => {
      const id = toast.loading("Creating worktree…");
      return Effect.gen(function* () {
        const result = yield* activePadiRpc.git.worktreeCreate({
          repoPath,
          name,
        });
        toast.success(`Created worktree at ${result.path}`, { id });
        const newTerminalId = yield* deps.handleCreate(result.path);
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
          yield* activePadiRpc.lifecycle
            .sendInput({ id: newTerminalId, data: `${initialCommand}\r` })
            .pipe(
              Effect.catch((err) =>
                Effect.sync(() => {
                  toast.error(`Failed to start agent: ${toError(err).message}`);
                }),
              ),
            );
        }
      }).pipe(
        // Toast surfaces the message and RECOVERS — the caller (palette
        // value-mode onSubmit) is fire-and-forget, and user-typed names make
        // WORKTREE_NAME_COLLISION a normal-flow error rather than a bug.
        //
        // A `TerminalCreateRefused` from the create arm lands here too, and
        // deliberately: the worktree exists but its terminal does not, which is
        // exactly what "Failed to create worktree" should read as at this point
        // in the sequence — the operation the user asked for did not complete.
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Failed to create worktree: ${toError(err).message}`, {
              id,
            });
          }),
        ),
      );
    });
  }

  /** Close a terminal and remove its worktree.
   *  Accepts an explicit ID so callers can snapshot it before confirming.
   *
   *  A SLEEPING terminal has no PTY to kill, so it takes the DISCARD path (F8) —
   *  routing it through the live `terminal.kill` RPC would try to kill a
   *  non-existent PTY and log a spurious pty-host kill error before unregistering.
   *  An active terminal (and any live sub-terminals) take the normal kill path. */
  function handleKillWorktree(targetId?: TerminalId): UiAction {
    return Effect.gen(function* () {
      const id = targetId ?? store.activeId();
      if (!id) return;
      const meta = store.getMetadata(id);
      const worktreePath = meta?.git?.isWorktree ? meta.git.worktreePath : null;
      if (sleepingArm(meta)) {
        // No splits on a sleeping record (sleep closes them) and no PTY to kill —
        // discard the dormant record, then fall through to remove the worktree.
        // If the discard failed (toasted by handleDiscard), the failure SHORT-
        // CIRCUITS this whole program (F10): removing the worktree now would
        // strand the still-present terminal at a deleted cwd. The user can retry
        // the close once the server is reachable again. `catchTag` recovers it to
        // a plain early return, because the toast has already been shown.
        const stop = yield* deps.handleDiscard(id).pipe(
          Effect.as(false),
          Effect.catchTag("TerminalDiscardFailed", () => Effect.succeed(true)),
        );
        if (stop) return;
      } else {
        for (const subId of store.getSplitPaneIds(id))
          yield* deps.handleKill(subId);
        yield* deps.handleKill(id);
      }
      if (!worktreePath) return;
      const tid = toast.loading("Removing worktree…");
      yield* activePadiRpc.git.worktreeRemove({ worktreePath }).pipe(
        Effect.tap(() =>
          Effect.sync(() => toast.success("Worktree removed", { id: tid })),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Failed to remove worktree: ${toError(err).message}`, {
              id: tid,
            });
          }),
        ),
      );
    });
  }

  return {
    handleCreateWorktree,
    handleKillWorktree,
  };
}
