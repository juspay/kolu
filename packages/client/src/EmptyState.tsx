/** Empty state — shown when no terminals exist. Offers session restore + key shortcuts. */

import { type Component, For, Show, createSignal, createMemo } from "solid-js";
import type {
  SavedSession,
  SavedAgentResume,
  SavedTerminal,
} from "kolu-common";
import { SHORTCUTS, formatKeybind } from "./input/keyboard";
import Kbd from "./ui/Kbd";

const features = [
  { label: "New terminal", shortcut: SHORTCUTS.createTerminalAlt.keybind },
  { label: "New terminal menu", shortcut: SHORTCUTS.newTerminalMenu.keybind },
  { label: "Command palette", shortcut: SHORTCUTS.commandPalette.keybind },
  { label: "Cycle terminals", shortcut: SHORTCUTS.cycleTerminalMru.keybind },
];

interface RepoGroup {
  /** Display name — the repo name for git worktrees, or the cwd fallback. */
  key: string;
  terminals: SavedTerminal[];
  /** Most-recent `lastSeen` across the group's captured agent commands,
   *  or 0 when the group has no agents. Drives MRU group ordering. */
  lastSeen: number;
}

/** Group top-level terminals by repoName (falling back to cwd), sort groups
 *  by most-recent agent `lastSeen`, and preserve saved sortOrder within
 *  each group. */
function groupByRepo(
  terminals: readonly SavedTerminal[],
  agentResume: SavedAgentResume,
): RepoGroup[] {
  const bySortOrder = (a: SavedTerminal, b: SavedTerminal) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  const groups = new Map<string, SavedTerminal[]>();
  for (const t of terminals) {
    if (t.parentId) continue;
    const key = t.repoName ?? t.cwd;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const out: RepoGroup[] = [];
  for (const [key, list] of groups) {
    list.sort(bySortOrder);
    let lastSeen = 0;
    for (const t of list) {
      const entry = agentResume[t.id];
      if (entry && entry.lastSeen > lastSeen) lastSeen = entry.lastSeen;
    }
    out.push({ key, terminals: list, lastSeen });
  }
  out.sort((a, b) => b.lastSeen - a.lastSeen);
  return out;
}

interface EmptyStateProps {
  savedSession?: SavedSession;
  agentResume?: SavedAgentResume;
  onRestore?: (options: { resumeIds: ReadonlySet<string> }) => void;
}

const EmptyState: Component<EmptyStateProps> = (props) => {
  // Opt-out set: terminal IDs that have a captured agent but the user
  // doesn't want auto-resumed. Default empty — everything with a capture
  // is in by default (checkbox pre-ticked).
  const [optedOut, setOptedOut] = createSignal<ReadonlySet<string>>(new Set());

  const resumableIds = createMemo(() => {
    const map = props.agentResume ?? {};
    const session = props.savedSession;
    if (!session) return [] as string[];
    return session.terminals
      .filter((t) => !t.parentId && map[t.id] !== undefined)
      .map((t) => t.id);
  });

  const resumeCount = () =>
    resumableIds().filter((id) => !optedOut().has(id)).length;

  const toggleOptOut = (id: string) => {
    const next = new Set(optedOut());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOptedOut(next);
  };

  const handleRestore = () => {
    const out = optedOut();
    const resumeIds = new Set(resumableIds().filter((id) => !out.has(id)));
    props.onRestore?.({ resumeIds });
  };

  return (
    <div
      data-testid="empty-state"
      class="flex items-center justify-center h-full"
    >
      <div class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/40 p-5 max-w-xs w-full">
        <Show when={props.savedSession}>
          {(session) => {
            const subCount = () =>
              session().terminals.filter((t) => t.parentId).length;
            const groups = () =>
              groupByRepo(session().terminals, props.agentResume ?? {});
            return (
              <div
                data-testid="session-restore"
                class="mb-4 pb-4 border-b border-edge"
              >
                <p class="text-fg-2 text-sm mb-2">Restore previous session</p>
                <div class="max-h-[60vh] overflow-y-auto mb-3">
                  <For each={groups()}>
                    {(group) => (
                      <div
                        data-testid="repo-group"
                        data-repo-name={group.key}
                        class="mb-2 last:mb-0"
                      >
                        <div class="sticky top-0 bg-surface-1 text-xs text-fg-2 font-medium py-0.5 truncate">
                          {group.key}
                        </div>
                        <For each={group.terminals}>
                          {(t) => {
                            const entry = () => (props.agentResume ?? {})[t.id];
                            const resumable = () => entry() !== undefined;
                            const optIn = () => !optedOut().has(t.id);
                            return (
                              <div
                                class="flex items-center gap-2 text-xs text-fg-3 py-0.5"
                                title={t.cwd}
                              >
                                <span class="shrink-0 truncate max-w-[6rem] text-fg-3/70">
                                  {t.branch ?? "—"}
                                </span>
                                <Show
                                  when={entry()}
                                  fallback={
                                    <span class="truncate grow">—</span>
                                  }
                                >
                                  {(e) => (
                                    <span
                                      data-testid="resume-command"
                                      data-terminal-id={t.id}
                                      class="truncate grow font-mono"
                                    >
                                      {e().command}
                                    </span>
                                  )}
                                </Show>
                                <Show when={resumable()}>
                                  <input
                                    type="checkbox"
                                    data-testid="resume-toggle"
                                    data-terminal-id={t.id}
                                    checked={optIn()}
                                    onChange={() => toggleOptOut(t.id)}
                                    class="shrink-0"
                                    aria-label={`Resume agent in ${t.branch ?? t.cwd}`}
                                  />
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    )}
                  </For>
                  <Show when={subCount() > 0}>
                    <div class="text-xs text-fg-3/50 mt-1">
                      +{subCount()} split{subCount() > 1 ? "s" : ""}
                    </div>
                  </Show>
                </div>
                <button
                  data-testid="restore-session"
                  class="w-full px-3 py-1.5 text-sm rounded-xl bg-accent text-surface-1 font-medium hover:brightness-110 transition-all"
                  onClick={handleRestore}
                >
                  Restore {session().terminals.length} terminal
                  {session().terminals.length > 1 ? "s" : ""}
                  <Show when={resumeCount() > 0}>
                    <span>
                      {" "}
                      · resume {resumeCount()} agent
                      {resumeCount() > 1 ? "s" : ""}
                    </span>
                  </Show>
                </button>
              </div>
            );
          }}
        </Show>
        <p class="text-fg-2 text-sm mb-3">Get started</p>
        <div class="space-y-2">
          <For each={features}>
            {(f) => (
              <div class="flex items-center justify-between text-sm">
                <span class="text-fg-3">{f.label}</span>
                <Kbd>{formatKeybind(f.shortcut)}</Kbd>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default EmptyState;
