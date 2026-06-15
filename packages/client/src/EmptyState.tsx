/** Empty state — shown when no terminals exist. Offers session restore + key shortcuts. */

import type { PwaInstall } from "@kolu/solid-pwa-install";
import type { SavedSession, SavedTerminal } from "kolu-common/surface";
import { terminalKey } from "kolu-common/terminalKey";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { showsWelcome } from "./capabilities";
import { ACTIONS, advertisedNewTerminalKey } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import { isDesktop } from "./useMobile";
import Kbd from "./ui/Kbd";
import { surface } from "./ui/Surface";
import Toggle from "./ui/Toggle";
import WelcomeMoments from "./WelcomeMoments";

const chrome = surface();

const features = [
  { label: "New terminal", shortcut: advertisedNewTerminalKey },
  { label: "New terminal menu", shortcut: ACTIONS.newTerminalMenu.keybind },
  { label: "Command palette", shortcut: ACTIONS.commandPalette.keybind },
  { label: "Cycle terminals", shortcut: ACTIONS.cycleTerminalMru.keybind },
];

interface RepoGroup {
  /** `terminalKey().group` — both the identity (collision detection) and
   *  the rendered heading (basename for non-git, repoName for git). One
   *  projection, one field. */
  key: string;
  terminals: SavedTerminal[];
}

/** Group top-level terminals by `terminalKey().group`. Groups are sorted
 *  by the minimum `canvasLayout.x` of their members so the restore card's
 *  left-to-right order matches the canvas the user saw. Within-group order
 *  preserves the array order of the saved session — the same Map insertion
 *  order the server stamps. */
function groupSavedTerminals(terminals: readonly SavedTerminal[]): RepoGroup[] {
  const minX = (ts: readonly SavedTerminal[]) =>
    ts.reduce(
      (acc, t) => Math.min(acc, t.canvasLayout?.x ?? Infinity),
      Infinity,
    );
  const groups = new Map<string, RepoGroup>();
  for (const t of terminals) {
    if (t.parentId) continue;
    const key = terminalKey(t).group;
    const existing = groups.get(key);
    if (existing) existing.terminals.push(t);
    else groups.set(key, { key, terminals: [t] });
  }
  return [...groups.values()].sort(
    (a, b) => minX(a.terminals) - minX(b.terminals),
  );
}

interface EmptyStateProps {
  /** The shared PWA-install controller — drives the "Pin it" moment. */
  install: PwaInstall;
  savedSession?: SavedSession;
  /** True while `handleRestoreSession` is running. The restore card
   *  stays mounted (button disabled, label changes to "Restoring…")
   *  so the click target doesn't detach between click and canvas
   *  reveal. */
  isRestoring?: boolean;
  onRestore?: (options: { resumeIds: ReadonlySet<string> }) => void;
  /** Open the "New terminal" flow. On desktop the always-mounted empty Dock
   *  carries the clickable `+` (#1202), so the button below renders only on the
   *  touch layouts (phone + compact), where there is no Dock and the shortcut
   *  list is unreachable with a finger. */
  onCreate?: () => void;
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
      <div class={`${chrome.class} p-5 max-w-md w-full`}>
        {/* The bird's-eye welcome — desktop only (no mobile welcome, by design). */}
        <Show when={showsWelcome()}>
          <div class="mb-5 pb-5 border-b border-edge">
            <WelcomeMoments install={props.install} />
          </div>
        </Show>
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
                          <span
                            data-testid="repo-heading"
                            class="text-sm font-semibold text-fg truncate"
                          >
                            {group.key}
                          </span>
                        </div>
                        <div class="ml-1 pl-3 border-l border-edge/70 space-y-2.5">
                          <For each={group.terminals}>
                            {(t) => (
                              <div title={t.cwd}>
                                <div class="text-sm text-fg-2 truncate leading-snug">
                                  {terminalKey(t).label}
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
                  type="button"
                  data-testid="restore-session"
                  disabled={props.isRestoring}
                  class="mt-4 w-full px-3 py-2 text-sm rounded-xl bg-accent text-surface-1 font-medium hover:brightness-110 disabled:opacity-70 disabled:cursor-wait transition-all"
                  onClick={handleRestore}
                >
                  <Show when={!props.isRestoring} fallback={<>Restoring…</>}>
                    Restore {session().terminals.length} terminal
                    {session().terminals.length > 1 ? "s" : ""}
                    <Show when={resumeCount() > 0}>
                      <span class="opacity-80">
                        {" · resume "}
                        {resumeCount()} agent{resumeCount() > 1 ? "s" : ""}
                      </span>
                    </Show>
                  </Show>
                </button>
              </div>
            );
          }}
        </Show>
        {/* Touch create button — the tappable path to the first terminal on the
            phone + compact layouts, which mount no Dock (its clickable `+` is
            desktop-only) and can't action the shortcut list with a finger. On
            desktop the empty Dock owns the `+`, so this is suppressed there. */}
        <Show when={!isDesktop() && props.onCreate}>
          {(onCreate) => (
            <button
              type="button"
              data-testid="empty-create-terminal"
              class="mb-5 w-full px-3 py-2 text-sm rounded-xl bg-accent text-surface-1 font-medium hover:brightness-110 active:brightness-95 transition-all"
              onClick={() => onCreate()()}
            >
              New terminal
            </button>
          )}
        </Show>
        {/* Shortcut list — only where the welcome moments aren't shown (mobile).
            On desktop the moments above already advertise these, so the list is
            redundant there. */}
        <Show when={!showsWelcome()}>
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
        </Show>
      </div>
    </div>
  );
};

export default EmptyState;
