/** Empty state — shown when no terminals exist. Offers session restore + key shortcuts. */

import { type Component, For, Show, createSignal, createMemo } from "solid-js";
import type { SavedSession, SavedTerminal } from "kolu-common";
import { SHORTCUTS, formatKeybind } from "./input/keyboard";
import Kbd from "./ui/Kbd";
import Toggle from "./ui/Toggle";

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
}

/** Group top-level terminals by repoName (falling back to cwd). Groups are
 *  sorted by the minimum `canvasLayout.x` of their members so the restore
 *  card's left-to-right order matches the canvas the user saw. Within-group
 *  order preserves the array order of the saved session, which is the same
 *  Map insertion order the server stamps. */
function groupSavedTerminals(terminals: readonly SavedTerminal[]): RepoGroup[] {
  const minX = (ts: readonly SavedTerminal[]) =>
    ts.reduce(
      (acc, t) => Math.min(acc, t.canvasLayout?.x ?? Infinity),
      Infinity,
    );
  const groups = new Map<string, SavedTerminal[]>();
  for (const t of terminals) {
    if (t.parentId) continue;
    const key = t.git?.repoName ?? t.cwd;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const out: RepoGroup[] = [];
  for (const [key, list] of groups) {
    out.push({ key, terminals: list });
  }
  out.sort((a, b) => minX(a.terminals) - minX(b.terminals));
  return out;
}

interface EmptyStateProps {
  savedSession?: SavedSession;
  onRestore?: (options: { resumeIds: ReadonlySet<string> }) => void;
}

const EmptyState: Component<EmptyStateProps> = (props) => {
  // Single global toggle: should the restore re-run captured agent CLIs?
  // Default on — users almost always want their agents back.
  const [resumeAgents, setResumeAgents] = createSignal(true);

  const resumableIds = createMemo(() => {
    const session = props.savedSession;
    if (!session) return [] as string[];
    return session.terminals
      .filter((t) => !t.parentId && t.lastAgentCommand !== undefined)
      .map((t) => t.id);
  });

  const resumeCount = () => (resumeAgents() ? resumableIds().length : 0);

  const handleRestore = () => {
    const resumeIds = resumeAgents()
      ? new Set(resumableIds())
      : new Set<string>();
    props.onRestore?.({ resumeIds });
  };

  return (
    <div
      data-testid="empty-state"
      class="flex items-center justify-center h-full"
    >
      <div class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-5 max-w-md w-full">
        <Show when={props.savedSession}>
          {(session) => {
            const subCount = () =>
              session().terminals.filter((t) => t.parentId).length;
            const groups = () => groupSavedTerminals(session().terminals);
            const hasAnyAgent = () => resumableIds().length > 0;
            return (
              <div
                data-testid="session-restore"
                class="mb-5 pb-5 border-b border-edge"
              >
                <p class="text-sm font-medium text-fg mb-3">Restore session</p>
                <div class="max-h-[55vh] overflow-y-auto space-y-4">
                  <For each={groups()}>
                    {(group) => (
                      <div data-testid="repo-group" data-repo-name={group.key}>
                        <div class="sticky top-0 z-10 bg-surface-1 pb-1.5">
                          <span class="text-sm font-semibold text-fg truncate">
                            {group.key}
                          </span>
                        </div>
                        <div class="ml-1 pl-3 border-l border-edge/70 space-y-2.5">
                          <For each={group.terminals}>
                            {(t) => (
                              <div title={t.cwd}>
                                <div class="text-sm text-fg-2 truncate leading-snug">
                                  {t.git?.branch ?? t.cwd}
                                </div>
                                <Show
                                  when={
                                    resumeAgents() && t.lastAgentCommand
                                      ? t.lastAgentCommand
                                      : undefined
                                  }
                                >
                                  {(cmd) => (
                                    <div
                                      data-testid="resume-command"
                                      data-terminal-id={t.id}
                                      title={cmd()}
                                      class="mt-1 font-mono text-[11px] text-fg-3/80 truncate leading-relaxed"
                                    >
                                      {cmd()}
                                    </div>
                                  )}
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                  <Show when={subCount() > 0}>
                    <div class="text-xs text-fg-3/50 ml-1">
                      +{subCount()} split{subCount() > 1 ? "s" : ""}
                    </div>
                  </Show>
                </div>
                <Show when={hasAnyAgent()}>
                  <div class="mt-4 flex items-center justify-between gap-4">
                    <span class="text-sm text-fg-2">Resume agent sessions</span>
                    <Toggle
                      testId="resume-agents-toggle"
                      enabled={resumeAgents()}
                      onChange={setResumeAgents}
                    />
                  </div>
                </Show>
                <button
                  data-testid="restore-session"
                  class="mt-4 w-full px-3 py-2 text-sm rounded-xl bg-accent text-surface-1 font-medium hover:brightness-110 transition-all"
                  onClick={handleRestore}
                >
                  Restore {session().terminals.length} terminal
                  {session().terminals.length > 1 ? "s" : ""}
                  <Show when={resumeCount() > 0}>
                    <span class="opacity-80">
                      {" · resume "}
                      {resumeCount()} agent{resumeCount() > 1 ? "s" : ""}
                    </span>
                  </Show>
                </button>
              </div>
            );
          }}
        </Show>
        <p class="text-sm font-medium text-fg mb-3">Get started</p>
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
