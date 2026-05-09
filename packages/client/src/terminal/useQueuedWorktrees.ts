import type { InitialTerminalMetadata, TerminalId } from "kolu-common/surface";
import { randomName } from "memorable-names";
import { queuedWorktrees, setQueuedWorktrees } from "../wire";

/** Client-side owner for queued-worktree lifecycle operations. */
export function useQueuedWorktrees(deps: {
  handleCreateWorktree: (
    repoPath: string,
    name: string,
    options?: {
      initialCommand?: string;
      initial?: InitialTerminalMetadata;
    },
  ) => Promise<TerminalId | undefined>;
}) {
  function enqueue(repoPath: string, intent: string): void {
    const trimmed = intent.trim();
    if (!trimmed) return;
    setQueuedWorktrees([
      ...queuedWorktrees(),
      {
        id: crypto.randomUUID(),
        repoPath,
        intent: trimmed,
        createdAt: Date.now(),
      },
    ]);
  }

  function remove(id: string): void {
    setQueuedWorktrees(queuedWorktrees().filter((q) => q.id !== id));
  }

  function rememberWorktreeName(id: string, worktreeName: string): void {
    setQueuedWorktrees(
      queuedWorktrees().map((q) => (q.id === id ? { ...q, worktreeName } : q)),
    );
  }

  async function start(
    id: string,
    options: { worktreeName?: string; agentCommand?: string } = {},
  ): Promise<void> {
    const item = queuedWorktrees().find((q) => q.id === id);
    if (!item) return;
    const worktreeName =
      options.worktreeName?.trim() || item.worktreeName || randomName();
    rememberWorktreeName(id, worktreeName);
    const terminalId = await deps.handleCreateWorktree(
      item.repoPath,
      worktreeName,
      {
        initialCommand: options.agentCommand,
        initial: { intent: item.intent },
      },
    );
    if (terminalId) remove(id);
  }

  return {
    items: queuedWorktrees,
    enqueue,
    remove,
    start,
  };
}
