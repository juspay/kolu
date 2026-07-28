/** Empty state — shown when no terminals exist. Offers session restore + key shortcuts. */

import type { SavedSession, SavedTerminal } from "@kolu/padi/surface";
import type { PwaInstall } from "@kolu/solid-pwa-install";
import { resumableCommand } from "kolu-common/surface";
import { terminalKey } from "kolu-common/terminalKey";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { showsWelcome } from "./capabilities";
import { ACTIONS, advertisedNewTerminalKey } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import { resumableTerminalIds } from "./restoreModel";
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
  /** Explicit "start fresh" — discard the saved session (server-side forfeit).
   *  Rendered as a secondary action below Restore, only while there IS a
   *  `savedSession` to forfeit. Creating a terminal no longer forfeits
   *  implicitly, so this is the user's one deliberate discard path. */
  onForfeit?: () => void;
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
    // Sleeping records are excluded — they restore DORMANT (no agent resumed),
    // so they must not inflate the "resume N agents" count or the resume set.
    return resumableTerminalIds(session.terminals);
  });

  const resumeCount = () => (resumeAgents() ? resumableIds().length : 0);

  // Lifted to component scope: the restore list (scroll region) and the pinned
  // action bar are now separate flex children of the card, so these derivations
  // are read outside a single render-prop — the list reads groups/subCount, the
  // footer reads hasAnyAgent. Memo the two that do real work per read (groups
  // sorts; subCount filters and is read 3× per render); hasAnyAgent is a trivial
  // single-consumer length check over the resumableIds memo.
  const groups = createMemo(() => {
    const session = props.savedSession;
    return session ? groupSavedTerminals(session.terminals) : [];
  });
  // Stable per-key hues (same `assignColors` as the live dock). Pure
  // function of each group name — co-set membership does not shift hue.
  const groupColors = createMemo(() =>
    assignColors(groups().map((g) => g.key)),
  );
  const subCount = createMemo(
    () => props.savedSession?.terminals.filter((t) => t.parentId).length ?? 0,
  );
  const hasAnyAgent = () => resumableIds().length > 0;

  const handleRestore = () => {
    const resumeIds = resumeAgents()
      ? new Set(resumableIds())
      : new Set<string>();
    props.onRestore?.({ resumeIds });
  };

  return (
    // The wrapper fills the empty canvas to center the card, but its bare
    // area is `pointer-events-none` so a double-click on empty space falls
    // through to the canvas-container's double-click-to-create gesture (the
    // container guards on `target === currentTarget`). The card itself is
    // `pointer-events-auto`, so its buttons/toggles stay clickable and a
    // double-click on the card never reaches the create handler. No overflow
    // here — the `max-h-full` card can never exceed the wrapper, so the card
    // owns the scroll (and a scroll on this `pointer-events-none` layer would
    // be wheel-dead anyway).
    <div
      data-testid="empty-state"
      class="flex h-full items-start justify-center px-5 pb-6 pointer-events-none"
      classList={{
        "pt-20": isDesktop(),
        "pt-5": !isDesktop(),
      }}
    >
      {/* App-shell card: a flex column capped to the wrapper's height. The
          wrapper owns the overflow but is `pointer-events-none` (double-click on
          bare canvas falls through to create-on-double-click), so its scroll is
          wheel-dead. The card is `pointer-events-auto`, so the scroll lives here.
          Only the middle region scrolls; the Restore action bar is a pinned
          FOOTER so the primary action never drops below the fold on a short
          viewport. The card keeps `overflow-y-auto` as a fallback: if the
          viewport is shorter than the pinned footer's own height, the `flex-1`
          list shrinks to zero and the footer would otherwise be clipped — the
          card scroll still lets the user reach it. */}
      <div
        class={`${chrome.class} scrollbar-subtle p-5 max-w-md w-full pointer-events-auto flex flex-col max-h-full overflow-y-auto`}
      >
        {/* The scroll region — the welcome header, the session list, and (on
            touch) the create button + shortcut list. `flex-1 min-h-0
            overflow-y-auto` absorbs all the overflow so the footer below stays
            pinned. `min-h-0` is load-bearing: without it a flex child won't
            shrink below its content and the scroll never engages. `scrollbar-subtle`
            is the app's thin themed scrollbar; `-mr-2 pr-2` insets it off the
            card's rounded edge. */}
        <div class="scrollbar-subtle flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
          {/* The bird's-eye welcome — desktop only (no mobile welcome, by design). */}
          <Show when={showsWelcome()}>
            <div class="mb-5 pb-5 border-b border-edge">
              <WelcomeMoments install={props.install} />
            </div>
          </Show>
          <Show when={props.savedSession}>
            <div
              data-testid="session-restore"
              classList={{
                // On touch layouts the create button / Get started list follow
                // this block in the SAME scroll region — restore the gap +
                // divider that separated them. On desktop the pinned footer's
                // own `border-t` is the separator, so no divider here.
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
                        {/* NOT sticky. A pinned, opaque heading masks its own
                            two-line rows as they scroll under it — the name line
                            hides behind the heading while the subtitle peeks out,
                            leaving an orphaned "Asleep · restores dormant" with no
                            session above it. Let the heading scroll with its rows. */}
                        <div class="pb-1.5">
                          <span
                            data-testid="repo-heading"
                            class="repo-group-band-title truncate"
                          >
                            <RepoMonogram
                              group={group.key}
                              color={color()}
                              size="sm"
                              data-testid="restore-repo-monogram"
                            />
                            {group.key}
                          </span>
                        </div>
                        <div class="ml-1 space-y-2.5">
                          <For each={group.terminals}>
                            {(t) => (
                              <div title={t.cwd}>
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
                                        resumeAgents()
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
                                  {/* A sleeping record restores DORMANT — no agent
                                      relaunches on restore; it comes back asleep
                                      and the user wakes it later. Say so plainly
                                      instead of a resume-command line. */}
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
                <Show when={subCount() > 0}>
                  <div class="text-xs text-fg-3/50 ml-1">
                    +{subCount()} split{subCount() > 1 ? "s" : ""}
                  </div>
                </Show>
              </div>
            </div>
          </Show>
          {/* Touch create button — the tappable path to the first terminal on the
              phone + compact layouts, which mount no Dock (its clickable `+` is
              desktop-only) and can't action the shortcut list with a finger. On
              desktop the empty Dock owns the `+`, so this is suppressed there. */}
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
        {/* Pinned action bar — the Restore controls live OUTSIDE the scroll
            region so the primary action never scrolls off on a short viewport.
            Present only with a saved session; `border-t` divides it from the
            scrolling list above. */}
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
              {/* Explicit forfeit — the deliberate "discard my previous
                  session" path. Kept visually secondary to Restore (a bare
                  text button, no fill) so it never competes with the primary
                  action. Only rendered when the parent wires `onForfeit`. */}
              <Show when={props.onForfeit}>
                <button
                  type="button"
                  data-testid="forfeit-session"
                  disabled={props.isRestoring}
                  class="mt-2 w-full px-3 py-1.5 text-xs text-fg-3 hover:text-fg-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  onClick={() => props.onForfeit?.()}
                >
                  Start fresh
                </button>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
};

export default EmptyState;
