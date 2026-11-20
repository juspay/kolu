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
  handleKillWithSubs: (id: TerminalId) => UiAction;
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

  function handleKillWorktree(targetId?: TerminalId): UiAction {
    return Effect.gen(function* () {
      const id = targetId ?? store.activeId();
      if (!id) return;
      const meta = store.getMetadata(id);
      const git = meta?.git;
      const worktreePath =
        git?.kind === "repo" && git.info.isWorktree
          ? git.info.worktreePath
          : null;
      if (sleepingArm(meta)) {
        const stop = yield* deps.handleDiscard(id).pipe(
          Effect.as(false),
          Effect.catchTag("TerminalDiscardFailed", () => Effect.succeed(true)),
        );
        if (stop) return;
      } else {
        yield* deps.handleKillWithSubs(id);
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
