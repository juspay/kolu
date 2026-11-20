import type { SavedSession, SavedTerminal } from "@kolu/padi-client/surface";
import type { PwaInstall } from "@kolu/solid-pwa-install";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
import { resumableCommand } from "kolu-common/surface";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { showsWelcome } from "./capabilities";
import ForfeitSessionButton from "./ForfeitSessionButton";
import { ACTIONS, advertisedNewTerminalKey } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import { assignColors } from "./terminal/terminalDisplay";
import DocLink from "./ui/DocLink";
import Kbd from "./ui/Kbd";
import RepoMonogram from "./ui/RepoMonogram";
import { surface } from "./ui/Surface";
import Toggle from "./ui/Toggle";
import { isDesktop } from "./useMobile";
import WelcomeMoments from "./WelcomeMoments";

const chrome = surface();

const features = [
  { label: ACTIONS.createTerminal.label, shortcut: advertisedNewTerminalKey },
  {
    label: ACTIONS.newTerminalMenu.label,
    shortcut: ACTIONS.newTerminalMenu.keybind,
  },
  {
    label: ACTIONS.commandPalette.label,
    shortcut: ACTIONS.commandPalette.keybind,
  },
  { label: "Cycle terminals", shortcut: ACTIONS.cycleTerminalMru.keybind },
];

interface RepoGroup {
  key: string;
  terminals: SavedTerminal[];
}

function groupSavedTerminals(terminals: readonly SavedTerminal[]): RepoGroup[] {
  const minX = (ts: readonly SavedTerminal[]) =>
    ts.reduce(
      (acc, t) => Math.min(acc, t.canvasLayout?.x ?? Infinity),
      Infinity,
    );
  const groups = new Map<string, RepoGroup>();
  for (const t of terminals) {
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
  install: PwaInstall;
  savedSession?: SavedSession;
  isRestoring?: boolean;
  isForfeiting?: boolean;
  onRestore?: (options: {
    resumeAgents: boolean;
    optOutIds: readonly string[];
  }) => void;
  onForfeit?: () => void;
  onCreate?: () => void;
}

const EmptyState: Component<EmptyStateProps> = (props) => {
  const [resumeAgents, setResumeAgents] = createSignal(true);

  const resumableIds = createMemo(() => {
    const session = props.savedSession;
    if (!session) return [] as string[];
    if (session.resumableIds === undefined) {
      throw new Error(
        "Saved session missing host-stamped resumableIds — padi must stamp membership on every serve",
      );
    }
    return session.resumableIds;
  });

  const resumeCount = () => (resumeAgents() ? resumableIds().length : 0);

  const groups = createMemo(() => {
    const session = props.savedSession;
    return session ? groupSavedTerminals(session.terminals) : [];
  });
  const groupColors = createMemo(() =>
    assignColors(groups().map((g) => g.key)),
  );
  const hasAnyAgent = () => resumableIds().length > 0;
  const resumableSet = createMemo(() => new Set(resumableIds()));

  const busy = () => Boolean(props.isRestoring || props.isForfeiting);

  const handleRestore = () => {
    props.onRestore?.({
      resumeAgents: resumeAgents(),
      optOutIds: [],
    });
  };

  return (
    <div
      data-testid="empty-state"
      class="flex h-full items-start justify-center px-5 pb-6"
      classList={{
        "pt-20": isDesktop(),
        "pt-5": !isDesktop(),
      }}
    >
      <div
        class={`${chrome.class} scrollbar-subtle p-5 max-w-md w-full pointer-events-auto flex flex-col max-h-full overflow-y-auto`}
      >
        <div class="scrollbar-subtle flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
          <Show when={showsWelcome()}>
            <div class="mb-5 pb-5 border-b border-edge">
              <WelcomeMoments install={props.install} />
            </div>
          </Show>
          <Show when={props.savedSession}>
            <div
              data-testid="session-restore"
              classList={{
                "mb-5 pb-5 border-b border-edge": !isDesktop(),
              }}
            >
              <div class="mb-3 flex items-baseline justify-between gap-3">
                <p class="text-sm font-medium text-fg">Restore session</p>
                <DocLink
                  slug="sessions"
                  class="text-xs text-accent hover:underline"
                  data-testid="session-restore-docs"
                >
                  Docs →
                </DocLink>
              </div>
              <div class="space-y-4">
                <For each={groups()}>
                  {(group) => {
                    const color = () => {
                      const c = groupColors().get(group.key);
                      if (c === undefined) {
                        throw new Error(
                          `assignColors missing restore group "${group.key}" — map must cover every group key`,
                        );
                      }
                      return c;
                    };
                    return (
                      <div
                        data-testid="repo-group"
                        data-repo-name={group.key}
                        class="repo-group-band"
                        style={{ "--repo-color": color() }}
                      >
                        <div class="pb-1.5">
                          <span class="repo-group-band-title truncate">
                            <RepoMonogram
                              group={group.key}
                              color={color()}
                              size="sm"
                              data-testid="restore-repo-monogram"
                            />
                            <span data-testid="repo-heading">{group.key}</span>
                          </span>
                        </div>
                        <div class="ml-1 space-y-2.5">
                          <For each={group.terminals}>
                            {(t) => (
                              <div
                                title={t.cwd}
                                data-testid="restore-terminal-row"
                                data-terminal-id={t.id}
                              >
                                <div
                                  class="text-sm text-fg-2 truncate leading-snug"
                                  classList={{
                                    "opacity-60": t.state === "sleeping",
                                  }}
                                >
                                  <Show when={t.state === "sleeping"}>
                                    <span
                                      data-testid="restore-sleeping"
                                      data-terminal-id={t.id}
                                      class="mr-1 text-fg-3"
                                      title="Asleep — restores dormant; wake it later"
                                      aria-hidden="true"
                                    >
                                      ☾
                                    </span>
                                  </Show>
                                  {terminalKey(t).label}
                                </div>
                                <Show
                                  when={t.state === "sleeping"}
                                  fallback={
                                    <Show
                                      when={
                                        resumeAgents() &&
                                        resumableSet().has(t.id)
                                          ? resumableCommand(t.restoreTarget)
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
                                  }
                                >
                                  <div class="mt-1 text-[11px] text-fg-3/60 truncate leading-relaxed italic">
                                    Asleep · restores dormant
                                  </div>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>
          <Show when={!isDesktop() && props.onCreate}>
            <button
              type="button"
              data-testid="empty-create-terminal"
              class="mb-5 w-full px-3 py-2 text-sm rounded-xl bg-accent text-surface-1 font-medium hover:brightness-110 active:brightness-95 transition-all"
              onClick={() => props.onCreate?.()}
            >
              {ACTIONS.createTerminal.label}
            </button>
          </Show>
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
        <Show when={props.savedSession}>
          {(session) => (
            <div class="shrink-0 mt-4 pt-4 border-t border-edge">
              <Show when={hasAnyAgent()}>
                <div class="flex items-center justify-between gap-4">
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
                disabled={busy()}
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
              <Show when={props.onForfeit}>
                <div class="mt-2">
                  <ForfeitSessionButton
                    inFlight={busy()}
                    onConfirm={() => props.onForfeit?.()}
                  />
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
};

export default EmptyState;
