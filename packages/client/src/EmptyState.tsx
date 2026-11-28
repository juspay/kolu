/** Empty state — shown when no terminals exist. Offers session restore + key shortcuts. */

import type { SavedSession, SavedTerminal } from "@kolu/padi-client/surface";
import type { PwaInstall } from "@kolu/solid-pwa-install";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
import { resumableCommand } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  mapArray,
  Show,
} from "solid-js";
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
import { foldEach } from "@kolu/surface/solid";

const chrome = surface();

/** The empty sources a card with no saved session reads — one frozen array
 *  each, so an absent session hands `mapArray` the same reference and it has
 *  nothing to diff. */
const NO_TERMINALS: readonly SavedTerminal[] = Object.freeze([]);
const NO_IDS: readonly string[] = Object.freeze([]);

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

/** ONE saved terminal's grouping facts, read off the session store a row at a
 *  time. The saved session is a cell frame — a `createStore` — so each of
 *  these is that record's own store leaf, and a single memo walking the list
 *  took about six sources per saved terminal: a session of a few dozen was
 *  already past Solid's 200-source `WIDE_SCOPE_DEPS` judge. Grouping reads
 *  these PLAIN rows instead; the record rides along for the card's own per-row
 *  bindings, which are each their own scope. */
interface SavedRow {
  terminal: SavedTerminal;
  /** `terminalKey().group` — the group this terminal belongs to. */
  group: string;
  /** Where it sat on the saved canvas, `Infinity` when it had no place. */
  x: number;
}

/** Whether two readings of one saved row say the same thing — what keeps an
 *  untouched row's identity, and so the group list's, across a serve. */
function sameSavedRow(a: SavedRow, b: SavedRow): boolean {
  return a.terminal === b.terminal && a.group === b.group && a.x === b.x;
}

/** Group EVERY saved terminal by `terminalKey().group` — flat walk, no
 *  parented filter. Splits / tree children are first-class rows (the tree is
 *  the tiling; layout-shaped split chrome is not invested here). Groups are
 *  sorted by the minimum `canvasLayout.x` of their members so the restore
 *  card's left-to-right order matches the canvas the user saw. Within-group
 *  order preserves the array order of the saved session. */
function groupSavedRows(rows: readonly SavedRow[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  const leftmost = new Map<string, number>();
  for (const row of rows) {
    const held = groups.get(row.group);
    if (held) held.terminals.push(row.terminal);
    else groups.set(row.group, { key: row.group, terminals: [row.terminal] });
    leftmost.set(
      row.group,
      Math.min(leftmost.get(row.group) ?? Infinity, row.x),
    );
  }
  return [...groups.values()].sort(
    (a, b) =>
      (leftmost.get(a.key) ?? Infinity) - (leftmost.get(b.key) ?? Infinity),
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
  /** True while `handleForfeitSession` is running — its write is in flight and
   *  the host has not cleared the session yet. */
  isForfeiting?: boolean;
  onRestore?: (options: {
    resumeAgents: boolean;
    optOutIds: readonly string[];
  }) => void;
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
  // Single global toggle: should the restore re-run the agents it detected at
  // save time? Default on — users almost always want their agents back.
  const [resumeAgents, setResumeAgents] = createSignal(true);

  // Host-served resumable set — the client never constructs membership; it only
  // renders this list and may subtract (opt-out). A live host always stamps;
  // absence is a hard error (never soft-empty to "no agents").
  //
  // COPIED with `mapArray`, never read in place: the stamped ids are a store
  // array, so `new Set(ids)` below walked a leaf per id on its own scope. The
  // copy is a flat two sources at any session size and hands back a plain
  // array, so every reading of it is one source.
  const resumableIds = mapArray(
    () => {
      const session = props.savedSession;
      if (!session) return NO_IDS;
      if (session.resumableIds === undefined) {
        throw new Error(
          "Saved session missing host-stamped resumableIds — padi must stamp membership on every serve",
        );
      }
      return session.resumableIds;
    },
    (id) => id,
    { name: "emptyState.resumableIds" },
  );

  const resumeCount = () => (resumeAgents() ? resumableIds().length : 0);

  // Lifted to component scope: the restore list (scroll region) and the pinned
  // action bar are now separate flex children of the card, so these derivations
  // are read outside a single render-prop — the list reads groups, the
  // footer reads hasAnyAgent. Memo the group sort; hasAnyAgent is a trivial
  // single-consumer length check over the resumableIds memo.
  //
  // The grouping reads one PLAIN row per saved terminal ({@link SavedRow}),
  // joined a chunk at a time, so the sort itself is one source for any number
  // of saved terminals.
  const savedRows = foldEach(
    "emptyState.savedRows",
    () => props.savedSession?.terminals ?? NO_TERMINALS,
    (terminal): SavedRow => ({
      terminal,
      group: terminalKey(terminal).group,
      x: terminal.canvasLayout?.x ?? Infinity,
    }),
    sameSavedRow,
  );
  const groups = createMemo(() => groupSavedRows(savedRows()), {
    name: "emptyState.groups",
  });
  // Stable per-key hues (same `assignColors` as the live dock). Pure
  // function of each group name — co-set membership does not shift hue.
  const groupColors = createMemo(
    () => assignColors(groups().map((g) => g.key)),
    { name: "emptyState.groupColors" },
  );
  const hasAnyAgent = () => resumableIds().length > 0;
  const resumableSet = createMemo(() => new Set(resumableIds()), {
    name: "emptyState.resumableSet",
  });

  /** Either card action is in flight — the one fact BOTH action buttons gate on,
   *  so the two can never race. Named once here rather than spelled as a
   *  disjunction at each button. */
  const busy = () => Boolean(props.isRestoring || props.isForfeiting);

  const handleRestore = () => {
    // Intent only: host owns the resumable set; client may only opt out.
    // Global toggle off → resumeAgents false (no opt-outs needed).
    props.onRestore?.({
      resumeAgents: resumeAgents(),
      optOutIds: [],
    });
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
      class={[
        "flex h-full items-start justify-center px-5 pb-6 pointer-events-none",
        {
          "pt-20": isDesktop(),
          "pt-5": !isDesktop(),
        },
      ]}
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
              class={{
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
                          <span class="repo-group-band-title truncate">
                            <RepoMonogram
                              group={group.key}
                              color={color()}
                              size="sm"
                              data-testid="restore-repo-monogram"
                            />
                            {/* testid on the name alone — monogram is decorative
                             *  (aria-hidden) and must not pollute e2e textContent. */}
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
                                  class={[
                                    "text-sm text-fg-2 truncate leading-snug",
                                    { "opacity-60": t.state === "sleeping" },
                                  ]}
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
              {/* Explicit forfeit — the deliberate "discard my previous
                  session" path, and the only irreversible act on this card, so
                  it carries its own inline confirmation and a hit area no wider
                  than its label (see `ForfeitSessionButton`). Kept visually
                  secondary to Restore so it never competes with the primary
                  action. Only rendered when the parent wires `onForfeit`. */}
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
