/** Dock — left-edge canonical live-terminal navigator.
 *
 *  Two progressive levels of detail, toggled in place. Per-device
 *  `dockMode` persists across reloads so a 13" laptop can stay on the
 *  rail while a 27" desktop sits on cards.
 *
 *  1. **rail** — narrow strip of repo-colored swatches, one per live
 *     terminal. State-cadenced (breathe / pulse) via `dock-rail-*`
 *     animations. Click any swatch to expand; click the chevron at the
 *     top to switch to cards.
 *  2. **cards** (default) — rows grouped by repo. Each repo gets a
 *     small section header (uppercase name + repo-colored swatch +
 *     row count); rows below stack as `branch · pips · time` lines.
 *     The agent-kind pip carries state directly via colour + cadence
 *     (busy + pulse/spin for `working`, warning + pulse for
 *     `awaiting`), so a single icon does double duty as "which
 *     agent" + "what is it doing now" — no redundant status dot.
 *     PR pip is a link to the PR with the live checks verdict in its
 *     tooltip; the sub-terminal chip surfaces when there are nested
 *     terminals. The active row gets a quiet highlight
 *     (`bg-surface-2` + 3 px accent left-edge stripe); row geometry
 *     stays constant so the dock never reflows when the active
 *     terminal changes. Pip columns share a CSS subgrid across each
 *     section so a column whose rows all lack a pip collapses to
 *     0 width and gives that space back to the branch label.
 *
 *  The activity-window chip (`24h`/`12h`/`All`) is a hard filter, not a
 *  dim: rows past the window disappear from the dock entirely; a small
 *  footer surfaces the hidden count and offers a one-click "show all"
 *  escape via `setActivityWindow("all")`.
 *
 *  In maximized-tile mode the dock renders as a flush left-edge sidebar
 *  with opaque background, full canvas height, separator on the right.
 *  In tiled mode the dock floats over the canvas — the same opaque
 *  surface, rounded with a drop shadow, so canvas tiles don't bleed
 *  through.
 *
 *  Auto-hides only when the workspace has no terminals — once the user
 *  has any terminal at all, the dock stays on screen, since it is the
 *  primary navigator. */

import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, For, Show, createMemo, createSignal } from "solid-js";
import { formatTimeAgo } from "../../terminal/staleness";
import IntentGlyph from "../../intent/IntentGlyph";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { AgentSlot, RowIcons } from "./RowIcons";
import {
  activityWindow,
  setActivityWindow,
  WINDOW_OPTIONS,
  windowOption,
} from "../../terminal/activityWindow";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "../../ui/Icons";
import { OptionMenu } from "../../ui/OptionMenu";
import { isPlatformModifier } from "../../input/keyboard";
import { useViewPosture } from "../useViewPosture";
import type { DockRowBucket } from "./dockRowRanking";
import type { DockGroup, DockTree } from "./dockTree";
import { useDockOrder } from "./useDockOrder";

export type DockMode = "rail" | "cards";

// 40px so the 24px-wide header buttons (`w-6`) + 8px of `px-1` padding
// fit without overflowing the rail's outer width.
const RAIL_WIDTH_PX = 40;
const CARDS_WIDTH_PX = 288;

// Breath/pulse animation belongs only to live attention states. Idle,
// none, and parked rails stay flat — undefined entries fall back to
// "". Parked rows are filtered before tree construction so the bucket
// is listed only for exhaustiveness on the lookup type.
const RAIL_ANIM: Partial<Record<DockRowBucket, string>> = {
  awaiting: "dock-rail-awaiting",
  working: "dock-rail-working",
};

/** Width in pixels for a given mode. Drives both the outer aside's
 *  inline `width` style and (in maximized posture) the dock's flex
 *  footprint as a left-panel sibling of the canvas. */
function dockWidth(mode: DockMode): number {
  return mode === "rail" ? RAIL_WIDTH_PX : CARDS_WIDTH_PX;
}

// Holding the platform modifier (Cmd on macOS, Ctrl elsewhere) reveals
// numeric hints over the first nine dock rows so the user can see what
// `Cmd+1..9` will target. Same modifier as the shortcut itself — the
// hint and the chord that fires it share one key, so users learn the
// mapping by holding-then-pressing without re-mapping a separate
// discovery modifier in their head. Module-scope so a single pair of
// window listeners fans out to every DockRow.
const [modHeld, setModHeld] = createSignal(false);
if (typeof window !== "undefined") {
  const refresh = (e: KeyboardEvent) => setModHeld(isPlatformModifier(e));
  const clear = () => setModHeld(false);
  window.addEventListener("keydown", refresh);
  window.addEventListener("keyup", refresh);
  // Tab-away can drop the keyup that would otherwise reset state; the
  // hint would visibly stick to "mod held" until the user re-focused
  // and pressed the modifier again. Blur and visibility-change both reset.
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", clear);
}

/** Two-state mode persisted per-device. `"cards"` is the default — the
 *  dock surfaces real context first, ambient compression on opt-in. */
export const [dockMode, setDockMode] = makePersisted(
  createSignal<DockMode>("cards"),
  {
    name: "kolu-dock-mode",
    serialize: (v) => v,
    deserialize: (raw): DockMode => (raw === "rail" ? raw : "cards"),
  },
);

/** Toggle the dock between rail (collapsed) and cards (expanded).
 *  Exported so the chrome-bar dock-toggle button and the
 *  `Cmd+Shift+B` keyboard shortcut can drive the same lifecycle as
 *  the dock-header chevron. */
export function toggleRailCards(): void {
  setDockMode(dockMode() === "rail" ? "cards" : "rail");
}

/** Read-only accessor for "is the dock expanded?" — true when in
 *  cards. Drives the chrome-bar toggle button's `active` pip so the
 *  icon reflects current state. */
export const dockExpanded = (): boolean => dockMode() !== "rail";

const Dock: Component<{
  /** Opens the command palette pre-drilled into "Search workspaces" —
   *  invoked by the dock's search-icon button. */
  onOpenWorkspaceSearch: () => void;
  onCreate: () => void;
}> = (props) => {
  const tree = useDockOrder();
  const posture = useViewPosture();
  const hasAnyRow = () => tree().flatRows.length > 0 || tree().parkedCount > 0;

  return (
    <Show when={hasAnyRow()}>
      <aside
        data-testid="dock"
        data-mode={dockMode()}
        data-maximized={posture.maximized() ? "" : undefined}
        class="flex flex-col select-none overflow-hidden bg-surface-1"
        classList={{
          // Tiled: absolute float inside the canvas; positions over
          // tiles rather than reflowing them. Opaque background (see
          // base class) so canvas tiles don't bleed through the seams
          // between rows or behind the rounded corners.
          "absolute z-30 top-20 left-4 rounded-2xl shadow-2xl shadow-black/40":
            !posture.maximized(),
          "max-h-[calc(100vh-22rem)]": !posture.maximized(),
          // Maximized: real left-panel flex sibling of the canvas. The
          // canvas takes the remaining space via `flex-1` next to us
          // (see TerminalCanvas). Full canvas height comes from the
          // parent flex container (`stretch` is the default
          // `align-items`); a right-edge separator reads as a hard
          // panel boundary rather than a floating card.
          "relative shrink-0 h-full border-r border-edge": posture.maximized(),
        }}
        style={{ width: `${dockWidth(dockMode())}px` }}
      >
        <RailOrCards
          mode={dockMode()}
          tree={tree()}
          onCreate={props.onCreate}
          onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
        />
      </aside>
    </Show>
  );
};

/** Rail / cards body — header on top, scrolling content below, optional
 *  hidden-by-window footer at the bottom. Rail iterates the flat row
 *  list (one swatch per terminal); cards iterates the grouped tree
 *  (section header + rows per repo). */
const RailOrCards: Component<{
  mode: DockMode;
  tree: DockTree;
  onCreate: () => void;
  onOpenWorkspaceSearch: () => void;
}> = (props) => {
  // Pre-built `id → flat position` map. RepoSection used to compute
  // each row's flat index via `findIndex` over `flatRows`, costing
  // O(rows²) per render. The map is rebuilt only when the tree
  // changes (one O(n) pass) and every row reads its position in O(1).
  const flatIndexOf = createMemo(
    () => new Map(props.tree.flatRows.map((r, i) => [r.id, i])),
  );
  return (
    <div class="flex flex-col w-full min-h-0">
      <DockHeader
        mode={props.mode}
        onCreate={props.onCreate}
        onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
      />
      <div class="flex flex-col overflow-y-auto overflow-x-hidden scrollbar-none flex-1 min-h-0">
        <Show
          when={props.mode === "rail"}
          fallback={
            <For each={props.tree.groups}>
              {(group) => (
                <RepoSection group={group} flatIndexOf={flatIndexOf()} />
              )}
            </For>
          }
        >
          <For each={props.tree.flatRows}>
            {(row, index) => (
              <RailRow id={row.id} bucket={row.bucket} flatIndex={index()} />
            )}
          </For>
        </Show>
      </div>
      <HiddenFooter parkedCount={props.tree.parkedCount} />
    </div>
  );
};

/** Dock header — `+` new terminal, workspace-search trigger, an activity-
 *  window selector (governs how aggressively rows fall off the dock;
 *  picking a tighter window hides more), and the rail ↔ cards mode
 *  toggle. Layout is row in cards mode (icons on one line at the top),
 *  column in rail mode (stacked vertically inside the narrow rail). */
const DockHeader: Component<{
  mode: DockMode;
  onCreate: () => void;
  onOpenWorkspaceSearch: () => void;
}> = (props) => {
  const railLayout = () => props.mode === "rail";
  return (
    <div
      class="flex items-center gap-1 px-1 py-1 border-b border-edge/40 shrink-0"
      classList={{ "flex-col": railLayout() }}
    >
      <button
        type="button"
        data-testid="dock-new"
        onClick={props.onCreate}
        class="group/new flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="New terminal"
        title="New terminal"
      >
        <PlusIcon class="w-3.5 h-3.5 transition-transform duration-200 group-hover/new:rotate-90" />
      </button>
      <button
        type="button"
        data-testid="dock-search"
        onClick={props.onOpenWorkspaceSearch}
        class="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="Search workspaces"
        title="Search workspaces (⌘⇧K)"
      >
        <SearchIcon class="w-3.5 h-3.5" />
      </button>
      <ActivityWindowMenu />
      <button
        type="button"
        data-testid="dock-mode-toggle"
        onClick={toggleRailCards}
        class="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{ "ml-auto": !railLayout() }}
        aria-label={railLayout() ? "Expand to cards" : "Collapse to rail"}
        title={railLayout() ? "Expand to cards" : "Collapse to rail"}
      >
        <span
          class="inline-flex"
          classList={{
            "rotate-90": !railLayout(),
            "-rotate-90": railLayout(),
          }}
        >
          <ChevronDownIcon class="w-3.5 h-3.5" />
        </span>
      </button>
    </div>
  );
};

/** Activity-window chip: shows the current short label (`24h`, `4h`,
 *  `All`, …) and opens an `OptionMenu` of all options. Same shared
 *  signal the minimap reads, so picking `12h` here also tightens the
 *  minimap's fade.
 *
 *  Always anchors `bottom-start` because the dock lives at the left
 *  edge of the viewport — `bottom-end` would push the 180px-wide panel
 *  LEFT of the trigger and clip it off-screen. */
const ActivityWindowMenu: Component = () => {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [triggerRef, setTriggerRef] = createSignal<HTMLButtonElement>();
  const current = () => windowOption(activityWindow());
  return (
    <>
      <button
        type="button"
        ref={setTriggerRef}
        data-testid="dock-window-trigger"
        data-window={activityWindow()}
        class="flex items-center justify-center h-6 min-w-6 px-1 rounded-md cursor-pointer text-[0.65rem] font-mono tabular-nums hover:bg-surface-2/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{
          "text-fg-3 hover:text-fg": activityWindow() === "all",
          "text-accent": activityWindow() !== "all",
        }}
        aria-label={`Activity window: ${current().label}`}
        title={`Activity window: ${current().label} — click to change`}
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        {current().short}
      </button>
      <OptionMenu
        triggerRef={triggerRef}
        open={menuOpen}
        onDismiss={() => setMenuOpen(false)}
        anchor="bottom-start"
        options={WINDOW_OPTIONS}
        value={activityWindow()}
        onSelect={setActivityWindow}
        testIdPrefix="dock-window"
      />
    </>
  );
};

/** Repo section — a small header (uppercase name + colored swatch +
 *  row count) over the group's rows. Always rendered, even for
 *  single-repo workspaces — a consistent structure beats a
 *  degenerate-case collapse. */
const RepoSection: Component<{
  group: DockGroup;
  /** Pre-built `id → flat position` lookup so each row's `Cmd+N` hint
   *  index is an O(1) read instead of an O(rows) `findIndex` scan per
   *  row per render. Built once per tree update by `RailOrCards`. */
  flatIndexOf: ReadonlyMap<TerminalId, number>;
}> = (props) => (
  // Section is the grid container. Six columns: dot · branch ·
  // pr-pip · agent-pip · sub-count · time. Branch is `minmax(0,1fr)`
  // so it stretches and truncates; the pip columns are `auto`, so
  // any column whose rows are entirely empty collapses to 0 instead
  // of stealing branch width. Each DockRow is a subgrid item that
  // inherits these columns, keeping the icons aligned vertically
  // across rows.
  <section
    data-testid="dock-section"
    data-repo={props.group.name}
    class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] gap-x-2 pl-6 pr-3"
  >
    {/* Header is a band — bg-surface-2 plus a hairline divider top
     *  and bottom — so a `KOLU` / `NIXOS-CONFIG` label reads as a
     *  section break rather than a faint label that blends into
     *  the rows. Header text sits at `pl-3` (12 px) from the dock's
     *  outer edge; row content sits at `pl-6` (24 px) inside the
     *  section's grid, so the header reads as an outdented parent
     *  and the rows nest visually beneath it. */}
    <div class="col-span-full flex items-center gap-2 -ml-6 -mr-3 pl-3 pr-3 py-1.5 bg-surface-2/60 border-y border-edge/30">
      <span
        aria-hidden="true"
        class="w-2 h-2 rounded-sm shrink-0"
        style={{ "background-color": props.group.color }}
      />
      <span
        class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em] text-fg-2 truncate min-w-0"
        title={props.group.name}
      >
        {props.group.name}
      </span>
      <span class="ml-auto font-mono text-[0.6rem] tabular-nums text-fg-3 shrink-0">
        {props.group.rows.length}
      </span>
    </div>
    <For each={props.group.rows}>
      {(row) => (
        <DockRow
          id={row.id}
          bucket={row.bucket}
          flatIndex={props.flatIndexOf.get(row.id) ?? -1}
        />
      )}
    </For>
  </section>
);

/** A row in cards mode — `dot · branch · icons · time`, with an
 *  active-only detail line below. Bucket drives the dot's color and
 *  animation; tiny inline icons (PR state, agent kind, sub-terminal
 *  count) carry presence-only signal so an inactive row reads as
 *  "has a PR, has an agent" at a glance without the full PrLine /
 *  AgentIndicator clutter. The active row gets a subtle highlight
 *  (lifted surface + accent left-edge stripe) and the full detail
 *  line beneath. */
const DockRow: Component<{
  id: TerminalId;
  bucket: DockRowBucket;
  /** Position in the dock-wide flat row order. `< 9` qualifies the row
   *  for a `Cmd+(flatIndex+1)` shortcut hint while the platform
   *  modifier is held. */
  flatIndex: number;
}> = (props) => {
  const store = useTerminalStore();
  const combined = createMemo(() => {
    const info = store.getDisplayInfo(props.id);
    const meta = store.getMetadata(props.id);
    if (!info || !meta) return null;
    return { info, meta };
  });
  const active = () => store.activeId() === props.id;
  const unread = () => store.isUnread(props.id);
  const showShortcutHint = () => modHeld() && props.flatIndex < 9;
  const foreground = (meta: TerminalMetadata) =>
    meta.foreground?.title ?? meta.foreground?.name ?? null;
  return (
    <Show when={combined()}>
      {(c) => (
        <button
          type="button"
          data-testid="dock-row"
          data-terminal-id={props.id}
          data-bucket={props.bucket}
          data-agent-state={c().meta.agent?.state}
          data-active={active() ? "" : undefined}
          data-unread={unread() ? "" : undefined}
          data-sub-count={c().info.subCount > 0 ? c().info.subCount : undefined}
          onClick={() => store.activate(props.id)}
          class="relative w-full grid grid-cols-subgrid col-span-full items-center py-1.5 -ml-6 -mr-3 border-l-[3px] border-l-transparent text-left cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 hover:bg-surface-2/40 data-[active]:bg-accent/15 data-[active]:border-l-accent"
          title="Jump to this terminal"
        >
          <AgentSlot agent={c().meta.agent} />
          <span
            class="font-medium text-[0.85rem] leading-tight truncate min-w-0"
            style={{
              color: c().info.annotationColor,
            }}
          >
            <IntentMarkdownInline
              markdown={annotationLine(c().meta.intent, c().info.key.label)}
            />
          </span>
          <RowIcons meta={c().meta} info={c().info} />
          <span class="font-mono text-[0.6rem] tabular-nums text-fg-3 text-right">
            {formatTimeAgo(c().meta.lastActivityAt)}
          </span>
          <Show when={unread()}>
            <span
              aria-hidden="true"
              class="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-alert animate-pulse"
            />
          </Show>
          <Show when={showShortcutHint()}>
            <span
              data-testid="dock-row-shortcut-hint"
              class="absolute top-0.5 left-0.5 inline-flex items-center justify-center h-3.5 min-w-3.5 px-1 rounded bg-accent text-surface-1 font-mono text-[0.55rem] font-bold tabular-nums pointer-events-none"
              aria-hidden="true"
            >
              {props.flatIndex + 1}
            </span>
          </Show>
          {/* Plain-shell foreground process — `nix build`, `pu connect`,
           *  etc. Surfaced only when there's no agent in the row, since
           *  agent-bearing rows already carry the agent-kind pip on
           *  the right. */}
          <Show when={!c().meta.agent && foreground(c().meta)}>
            {(fg) => (
              <span
                data-testid="dock-quiet-foreground"
                class="col-start-2 col-end-[-1] font-mono text-[0.65rem] text-fg-2 truncate min-w-0"
              >
                {fg()}
              </span>
            )}
          </Show>
        </button>
      )}
    </Show>
  );
};

/** Rail-mode row — one colored swatch per terminal. The bucket comes
 *  from the same `RankedDockRow` the cards mode renders, so the rail's
 *  breathe/pulse animation can never disagree with cards on which row
 *  is awaiting/working. */
const RailRow: Component<{
  id: TerminalId;
  bucket: DockRowBucket;
  flatIndex: number;
}> = (props) => {
  const store = useTerminalStore();
  const combined = createMemo(() => {
    const info = store.getDisplayInfo(props.id);
    const meta = store.getMetadata(props.id);
    if (!info || !meta) return null;
    return { info, meta };
  });
  const active = () => store.activeId() === props.id;
  const unread = () => store.isUnread(props.id);
  const showShortcutHint = () => modHeld() && props.flatIndex < 9;
  return (
    <Show when={combined()}>
      {(c) => (
        <div
          class="relative flex items-stretch border-b border-edge/15 last:border-b-0"
          data-testid="dock-row"
          data-terminal-id={props.id}
          data-bucket={props.bucket}
          data-agent-state={c().meta.agent?.state}
          data-active={active() ? "" : undefined}
          data-unread={unread() ? "" : undefined}
          data-sub-count={c().info.subCount > 0 ? c().info.subCount : undefined}
        >
          <Show when={unread()}>
            <span
              class="absolute -top-1 right-1 inline-flex h-2 w-2"
              aria-hidden="true"
            >
              <span class="absolute inline-flex h-full w-full rounded-full bg-alert opacity-75 animate-ping" />
              <span class="relative inline-flex rounded-full h-2 w-2 bg-alert" />
            </span>
          </Show>
          <Show when={showShortcutHint()}>
            <span
              data-testid="dock-row-shortcut-hint"
              class="absolute top-1 left-1 z-10 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded bg-accent text-surface-1 font-mono text-[0.6rem] font-bold tabular-nums pointer-events-none"
              aria-hidden="true"
            >
              {props.flatIndex + 1}
            </span>
          </Show>
          <RailSegment
            id={props.id}
            repoColor={c().info.repoColor}
            bucket={props.bucket}
            intent={c().meta.intent}
          />
        </div>
      )}
    </Show>
  );
};

/** Colored rail segment — one per dock row in rail mode. Clicking
 *  activates the corresponding terminal. A `dock-rail-*` filter
 *  animation cycles the segment's brightness so state-cadence (breathe
 *  / pulse) survives even in the minimal rail surface. */
const RailSegment: Component<{
  id: TerminalId;
  repoColor: string;
  bucket: DockRowBucket;
  intent: string | undefined;
}> = (props) => {
  const store = useTerminalStore();
  const animClass = () => RAIL_ANIM[props.bucket] ?? "";
  return (
    <button
      type="button"
      data-testid="dock-rail"
      data-agent-bucket={props.bucket}
      onClick={() => store.activate(props.id)}
      class={`shrink-0 w-full h-6 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 flex items-center justify-center ${animClass()}`}
      classList={{
        "opacity-50": props.bucket === "none",
      }}
      style={{ "background-color": props.repoColor }}
      title="Jump to this terminal"
      aria-label="Jump to this terminal"
    >
      <Show when={props.intent}>
        <IntentGlyph
          intent={props.intent}
          class="block text-base leading-none mix-blend-multiply"
        />
      </Show>
    </button>
  );
};

/** Footer line shown when the activity-window filter dropped at least
 *  one row from the dock. The "show all" link flips the window to
 *  `"all"`, surfacing every parked row at its real bucket — the same
 *  signal the minimap and other consumers read, so the relaxation is
 *  one persistent choice, not a dock-local override. */
const HiddenFooter: Component<{ parkedCount: number }> = (props) => (
  <Show when={props.parkedCount > 0 && activityWindow() !== "all"}>
    <button
      type="button"
      data-testid="dock-hidden-footer"
      onClick={() => setActivityWindow("all")}
      class="flex items-center gap-1.5 px-3 py-2 border-t border-edge/40 text-[0.65rem] text-fg-3 hover:text-fg hover:bg-surface-2/40 transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      title="Show every terminal, regardless of activity window"
    >
      <span class="tabular-nums">{props.parkedCount}</span>
      <span class="truncate">
        hidden by{" "}
        <span class="font-mono">{windowOption(activityWindow()).short}</span>{" "}
        window
      </span>
      <span class="ml-auto text-accent shrink-0">show all</span>
    </button>
  </Show>
);

export default Dock;
