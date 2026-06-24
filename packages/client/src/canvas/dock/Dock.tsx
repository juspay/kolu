/** Dock — left-edge canonical live-terminal navigator.
 *
 *  Two progressive levels of detail, toggled in place. Per-device
 *  `dockMode` persists across reloads so a 13" laptop can stay on the
 *  rail while a 27" desktop sits on cards.
 *
 *  1. **rail** — narrow strip of two-glyph chips, one per live
 *     terminal. Each chip carries first letter of the repo + the intent's
 *     lead grapheme (emoji when the user leads with one, otherwise first
 *     alphanumeric of the branch tail) so two terminals in the same repo
 *     stay distinguishable. Repo color tints the chip; bucket state
 *     animates its ring (breath for `awaiting`, spin-glow for
 *     `working`); active wears an accent halo; unread shows an alert
 *     badge top-right. Tiny tinted dividers between repo groups
 *     carry the cards-mode section-header colour into the rail so
 *     the two modes share one repo-identity vocabulary — every
 *     repo-tinted dock surface (cards spine, sticky header, name,
 *     rail chip bg+ring, rail divider) reads the same `--repo-color`
 *     custom property, so the shared socket is a structural fact, not
 *     a comment. (Canvas tiles' `--card-color` / `--aura-c` are a
 *     separate module; converging them onto `--repo-color` is future
 *     work, not done here.)
 *  2. **cards** (default) — rows grouped by repo. Each repo gets a
 *     continuous repo-colored **spine** down the section's left edge
 *     plus a faintly repo-tinted **sticky** header (uppercase name +
 *     row count) that pins to the scrollport top until the next
 *     repo's header pushes it off — so a row's repo is legible at a
 *     glance and the label survives the scroll. Rows below stack as
 *     `indicator · branch · pips · time` lines. The leading **status
 *     indicator** (`StatePip`) folds three axes into one glyph: the
 *     agent-state CORE by shape (dim small disk for already-seen
 *     awaiting, hollow spinning ring for working, muted dot for idle,
 *     nothing for parked/none), a thin green **live ring** that gently
 *     sweeps around it while the terminal is moving bytes ("moving bytes
 *     right now", orthogonal to agent state), and a small amber **unread
 *     corner badge** while a fired alert is unopened (a badge, not a
 *     ring, so the two never compound into nested circles) — so one
 *     glance reads overall activity and the state stays fully visible.
 *     Agent kind is not surfaced here — it lives on
 *     the terminal title bar where there's room. PR pip is a link
 *     to the PR with the live checks verdict in its
 *     tooltip; the sub-terminal chip surfaces when there are nested
 *     terminals. The active row gets a quiet highlight
 *     (`bg-surface-2` + 3 px accent left-edge stripe); row geometry
 *     stays constant so the dock never reflows when the active
 *     terminal changes. Pip columns share a CSS subgrid across each
 *     section so a column whose rows all lack a pip collapses to
 *     0 width and gives that space back to the branch label.
 *
 *  The activity-window picker (`24h`/`12h`/`All`) is a hard filter, not
 *  a dim: rows past the window disappear from the dock entirely. The
 *  picker lives inline inside `HiddenFooter` at the bottom of the dock
 *  alongside the parked-count disclosure ("N hidden by [Wh] window"),
 *  so cause and effect share one zone — and the same strip offers a
 *  one-click "show all" escape via `setActivityWindow("all")` whenever
 *  the window is hiding something.
 *
 *  In maximized-tile mode the dock renders as a flush left-edge sidebar
 *  with opaque background, full canvas height, separator on the right.
 *  In tiled mode the dock floats over the canvas — the same opaque
 *  surface, rounded with a drop shadow, so canvas tiles don't bleed
 *  through.
 *
 *  Always on screen — it is the primary navigator. At zero terminals
 *  it collapses to its header alone, whose `+` button is the
 *  mouse-driven path to the first terminal on the empty canvas (#1202);
 *  the welcome card advertises the shortcut but carries no clickable
 *  affordance. App.tsx mounts it (desktop only) inside the empty-state
 *  canvas as well as the populated one. */

import { persistedPref } from "../../persistedPref";
import { activeArm, type TerminalId } from "kolu-common/surface";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { createSharedRoot } from "../../createSharedRoot";
import { isPlatformModifier } from "../../input/keyboard";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import LiveActivityDot from "../../terminal/LiveActivityDot";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { useTerminalActivity } from "../../terminal/useTerminalActivity";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useTileStore } from "../../tile/useTileStore";
import {
  DOCK_CARDS_GUTTER_CLASS,
  DOCK_CARDS_GUTTER_NEG_CLASS,
  DOCK_CARDS_SUBGRID_LEFT_RESTORE,
  DOCK_ROW_BRANCH_COL,
  DOCK_ROW_GRID,
  RAIL_WIDTH_PX,
} from "../../ui/chromeSpacing";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "../../ui/Icons";
import { useViewPosture } from "../useViewPosture";
import { chipInitials } from "./chipInitials";
import type { DockRowBucket } from "./dockRowRanking";
import type { DockGroup, DockTree } from "./dockTree";
import { HiddenFooter } from "./HiddenFooter";
import RecencyCell from "./RecencyCell";
import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { createDockRowData, PrPip, SubCountCell } from "./RowPips";
import { pipVariant } from "./pipVariant";
import { rowSubline } from "./rowSubline";
import { useDockOrder } from "./useDockOrder";

export type DockMode = "rail" | "cards";

// Rail width is shared with the right-panel rail via
// `RAIL_WIDTH_PX` in `ui/chromeSpacing.ts` so the two collapsed
// surfaces stay visually paired across the canvas axis.
const CARDS_WIDTH_PX = 288;

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
// discovery modifier in their head. The signal + four window listeners
// live inside a `createSharedRoot` so they participate in the same
// reactive-owner lifecycle as the other module-scope singletons (no
// orphan listeners running outside an owner, tearable down in tests).
const useModHeld = createSharedRoot(() => {
  const [modHeld, setModHeld] = createSignal(false);
  if (typeof window !== "undefined") {
    const refresh = (e: KeyboardEvent) => setModHeld(isPlatformModifier(e));
    const clear = () => setModHeld(false);
    window.addEventListener("keydown", refresh);
    window.addEventListener("keyup", refresh);
    // Tab-away can drop the keyup that would otherwise reset state; the
    // hint would visibly stick to "mod held" until the user re-focused
    // and pressed the modifier again. Blur + visibility-change reset.
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
  }
  return modHeld;
});

/** Two-state mode persisted per-device. `"cards"` is the default — the
 *  dock surfaces real context first, ambient compression on opt-in. */
export const [dockMode, setDockMode] = persistedPref<DockMode>({
  name: "kolu-dock-mode",
  fallback: "cards",
  parse: (raw) => {
    if (raw === "rail" || raw === "cards") return raw;
    throw new Error(`unrecognized dock mode: ${raw}`);
  },
});

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

  return (
    <aside
      data-testid="dock"
      data-mode={dockMode()}
      data-maximized={posture.mode() === "maximized" ? "" : undefined}
      class="flex flex-col select-none overflow-hidden bg-surface-1"
      classList={{
        // Tiled: absolute float inside the canvas; positions over
        // tiles rather than reflowing them. `top-12` (48 px) sits
        // 4 px below the 44 px chrome bar, so the dock card lines up
        // with the right panel (also `top-12`) along a single
        // horizontal axis. Opaque background (see base class) so
        // canvas tiles don't bleed through the seams between rows
        // or behind the rounded corners.
        "absolute z-30 top-12 left-4 rounded-2xl shadow-2xl shadow-black/40":
          posture.mode() === "tiled",
        "max-h-[calc(100vh-14rem)]": posture.mode() === "tiled",
        // Maximized: real left-panel flex sibling of the canvas. The
        // canvas takes the remaining space via `flex-1` next to us
        // (see TerminalCanvas). Full canvas height comes from the
        // parent flex container (`stretch` is the default
        // `align-items`); a right-edge separator reads as a hard
        // panel boundary rather than a floating card.
        "relative shrink-0 h-full border-r border-edge":
          posture.mode() === "maximized",
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
          <For each={props.tree.groups}>
            {(group) => (
              <>
                <RailSectionMark color={group.color} name={group.name} />
                <For each={group.rows}>
                  {(row) => (
                    <RailChip
                      id={row.id}
                      pip={row.pip}
                      flatIndex={flatIndexOf().get(row.id) ?? -1}
                    />
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
      </div>
      {/* Footer carries the activity-window control + "N hidden by …
       *  window" disclosure. It governs which rows the window parks, so
       *  it only earns its place once there is something to park or
       *  show: at true zero (no visible rows AND nothing parked — the
       *  empty-canvas Dock) it would read a meaningless "0 hidden by …
       *  window". The all-parked case (no visible rows but
       *  `parkedCount > 0`) still needs it — that is exactly when
       *  "show all" is the way back. In rail mode the footer hands off
       *  to its chip-only layout (the 44px rail can't hold the
       *  sentence), driven by the `rail` prop below. */}
      <Show when={props.tree.hasContent}>
        <HiddenFooter
          parkedCount={props.tree.parkedCount}
          rail={props.mode === "rail"}
        />
      </Show>
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
      class="flex items-center gap-1 py-1 border-b border-edge/40 shrink-0"
      classList={{
        "px-1 flex-col": railLayout(),
        "pl-1 pr-3": !railLayout(),
      }}
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
  // Section is the grid container. Four columns (the `DOCK_ROW_GRID`
  // template): indicator · branch · sub-count · time. The leading
  // indicator column is a fixed 18px reserved track (not `auto`) holding
  // the merged `StatePip` — R-activity-merge collapsed the old leading
  // pair (a 12px live-activity track + a separate state-pip track) into
  // this one column, the live dot now folded into the pip's green ring —
  // so the indicator never shifts as its axes flip and pips stay aligned
  // across rows whether or not each is streaming. PR pip is NOT a grid
  // column — it lives inline on line 2 (left of the subline text),
  // anchored to the branch column's left edge so its X stays consistent
  // across every section. Branch is `minmax(0,1fr)` so it stretches and
  // truncates; sub-count and time are `auto`, so an empty sub-count
  // column collapses to 0 and gives its width back to the branch. Each
  // DockRow is a subgrid item that inherits these columns, keeping the
  // icons aligned vertically across rows in one section.
  <section
    data-testid="dock-section"
    data-repo={props.group.name}
    style={{ "--repo-color": props.group.color }}
    class={`dock-cards-section grid ${DOCK_ROW_GRID} gap-x-2 pl-3 ${DOCK_CARDS_GUTTER_CLASS}`}
  >
    {/* Header is a sticky band tinted with the repo colour (see
     *  `.dock-cards-section-header`), riding above the repo-colour
     *  spine the section's left border draws — so a `KOLU` /
     *  `NIXOS-CONFIG` label reads as a coloured section break that
     *  stays pinned while its rows scroll, not a faint label that
     *  blends in and slides away. The name carries the repo colour
     *  too; count stays neutral. Header text and row content both sit
     *  at `pl-3` (12 px) from the dock's outer edge, so the row's
     *  leading status indicator aligns with the repo name — the repo
     *  spine + tinted header band carry the grouping (R-activity-merge
     *  reclaimed the old `pl-6` row indent). */}
    <div
      data-testid="dock-section-header"
      class={`dock-cards-section-header col-span-full flex items-center gap-2 -ml-3 ${DOCK_CARDS_GUTTER_NEG_CLASS} pl-3 pr-3 py-1.5 border-y border-edge/30`}
    >
      <span
        data-testid="dock-section-name"
        class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
        style={{ color: "var(--repo-color)" }}
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
          pip={row.pip}
          flatIndex={props.flatIndexOf.get(row.id) ?? -1}
        />
      )}
    </For>
  </section>
);

/** A row in cards mode — two lines:
 *
 *    Line 1: `indicator · branch · sub-count · time`
 *    Line 2: `[PR pip] subline`  (branch col → end)
 *
 *  A single leading status indicator (`StatePip`) folds the old
 *  activity/agent glyphs into one column; the branch column starts at
 *  col 2 (`DOCK_ROW_BRANCH_COL = col-start-2`). The PR pip rides on
 *  line 2 at the leftmost X (anchored to the branch column's left edge,
 *  col 2) so PR icons align across every section. Sub-count cell
 *  is empty when the row has none, collapsing the column back into
 *  branch width. Active row gets a quiet highlight (`bg-accent/15` +
 *  3 px accent left stripe) but identical geometry, so the dock
 *  doesn't reflow on activation.
 *
 *  Touch variant lives in `DockList.tsx`'s `DockListRow`.
 *  The two are intentionally separate — touch-target sizing,
 *  pointer-down gesture interception (Corvu drawer drag-to-dismiss),
 *  and the desktop-only `Cmd+N` shortcut hint are real divergence
 *  axes that a `BaseRow` extraction would have to expose as props.
 *  Both reviewers agreed: keep them separate, link via this comment.
 *  Update both files when row geometry changes. */
const DockRow: Component<{
  id: TerminalId;
  /** ORDER bucket — drives `data-bucket` (used by ordering tests / styling). */
  bucket: DockRowBucket;
  /** PIP bucket — drives the `StatePip` colour, decoupled from order so the row
   *  pip reads identically to the tile title's pip (both `agentPaintClass`). */
  pip: DockRowBucket;
  /** Position in the dock-wide flat row order. `< 9` qualifies the row
   *  for a `Cmd+(flatIndex+1)` shortcut hint while the platform
   *  modifier is held. */
  flatIndex: number;
}> = (props) => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const activity = useTerminalActivity();
  const combined = createDockRowData(props.id);
  // Active-tile highlight follows the TILE registry (so a focused sleeping tile
  // reads as the active row in PR 2); unread is terminal-attention, stays on
  // the terminal store.
  const active = () => tileStore.activeId() === props.id;
  const unread = () => store.isUnread(props.id);
  const modHeld = useModHeld();
  const showShortcutHint = () => modHeld() && props.flatIndex < 9;
  return (
    <Show when={combined()}>
      {(c) => (
        // Row is `<div role="button">` rather than `<button>` so the
        // `<a>` PR pip on line 2 stays valid HTML. Nested interactive
        // elements (`<a>` inside `<button>`) produce unreliable
        // keyboard / screen-reader behaviour; the div+role pattern
        // keeps the row activatable via mouse, Enter, and Space
        // without that nesting. Biome's a11y rule wants a native
        // `<button>` here, but that's exactly what we can't use —
        // the PR pip must remain a real link (Cmd-click, right-click
        // context menu) and HTML forbids `<a>` inside `<button>`.
        // biome-ignore lint/a11y/useSemanticElements: see comment above — native button would nest invalid interactive HTML
        <div
          role="button"
          tabIndex={0}
          data-testid="dock-row"
          data-terminal-id={props.id}
          data-bucket={props.bucket}
          data-agent-state={activeArm(c().meta)?.agent?.state}
          data-active={active() ? "" : undefined}
          data-unread={unread() ? "" : undefined}
          data-sub-count={c().info.subCount > 0 ? c().info.subCount : undefined}
          onClick={() => tileStore.activate(props.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              tileStore.activate(props.id);
            }
          }}
          class={`relative w-full grid grid-cols-subgrid col-span-full items-center py-1.5 ${DOCK_CARDS_SUBGRID_LEFT_RESTORE} ${DOCK_CARDS_GUTTER_NEG_CLASS} ${DOCK_CARDS_GUTTER_CLASS} border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent text-left cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 hover:bg-surface-2/40 data-[active]:bg-accent/15 data-[active]:border-l-accent`}
          title="Jump to this terminal"
        >
          {/* One merged status indicator — the agent-state CORE
           *  (`pipVariant`), wrapped by the green live RING when the
           *  terminal is moving bytes and the amber unread corner BADGE
           *  when a fired alert is unopened. The old standalone ActivityPip
           *  column is gone (its dot is now the ring), reclaiming the
           *  dead left margin. `row-span-2 self-center` centres it across
           *  both row lines rather than pinning it to line 1. */}
          <span class="row-span-2 flex self-center">
            <StatePip
              variant={pipVariant(props.pip)}
              live={activity.isLive(props.id)}
              alert={unread()}
              alertLabel="unread alert"
              class={DOCK_ROW_PIP_BOX}
            />
          </span>
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
          <SubCountCell subCount={c().info.subCount} />
          {/* Recency cell — "Xs ago". Shared with the touch drawer; the
           *  no-reflow width contract lives in RecencyCell. The live signal
           *  rides the leading StatePip's ring, not here. */}
          <RecencyCell
            lastActivityAt={c().meta.lastActivityAt}
            textSize="text-[0.6rem]"
          />
          <Show when={showShortcutHint()}>
            <span
              data-testid="dock-row-shortcut-hint"
              class="absolute top-0.5 left-0.5 inline-flex items-center justify-center h-3.5 min-w-3.5 px-1 rounded bg-accent text-surface-1 font-mono text-[0.55rem] font-bold tabular-nums pointer-events-none"
              aria-hidden="true"
            >
              {props.flatIndex + 1}
            </span>
          </Show>
          {/* Second line — flex row spanning the branch column → end.
           *  Leads with the PR pip (left edge anchored to the branch
           *  column's left, so PR icons align across every section)
           *  followed by the subline text (agent summary / state, or
           *  foreground process title, or an invisible placeholder
           *  keeping the row two-line tall). */}
          <div
            class={`${DOCK_ROW_BRANCH_COL} col-end-[-1] flex items-center gap-1.5 min-w-0`}
          >
            <PrPip meta={c().meta} />
            <Show
              when={rowSubline(c().meta)}
              fallback={
                <span
                  aria-hidden="true"
                  class="font-mono text-[0.65rem] leading-tight invisible"
                >
                  &nbsp;
                </span>
              }
            >
              {(line) => (
                <span
                  data-testid={
                    activeArm(c().meta)?.agent
                      ? "dock-agent-subline"
                      : "dock-quiet-foreground"
                  }
                  class="font-mono text-[0.65rem] leading-tight text-fg-2 truncate min-w-0"
                  title={line()}
                >
                  {line()}
                </span>
              )}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
};

/** Repo divider strip rendered between rail sections. A 24 × 2 px
 *  tinted bar carrying the same `info.repoColor` the cards-mode
 *  section header uses — so the two modes share one repo-identity
 *  vocabulary even at the 44 px rail width. */
const RailSectionMark: Component<{ color: string; name: string }> = (props) => (
  <div
    aria-hidden="true"
    data-testid="dock-rail-section"
    data-repo={props.name}
    class="dock-rail-section-mark"
    style={{ "--repo-color": props.color }}
    title={props.name}
  />
);

/** Rail-mode chip — 32 px tile carrying two-glyph initials (repo
 *  letter + intent lead grapheme or branch letter). Repo color tints the bg and the
 *  ring; the PAINT bucket animates the ring (breath for `awaiting`,
 *  spin-glow for `working`, flat for `idle`/`none`); active wears an
 *  accent halo; unread shows an alert badge top-right. The border tint and
 *  glow read `pip` (the PAINT bucket) — the SAME fold the cards-mode row pip
 *  and the tile title glow through — so a fresh `waiting` agent keeps its
 *  lingering `awaiting` glow in the rail exactly as it does in cards mode and
 *  on its tile title, instead of going dark because the ORDER bucket ranks it
 *  `idle`. The `pip` comes from the same `RankedDockRow` the cards-mode row pip
 *  reads, so the two modes can never disagree on which terminal glows. */
const RailChip: Component<{
  id: TerminalId;
  /** PAINT bucket — drives the chip border tint and the state glow, identical
   *  to the cards-mode row pip and the tile-title glow (all `agentPaintClass`).
   *  The rail carries no ORDER bucket because, unlike cards mode, it exposes no
   *  ordering hook through `data-bucket` — the attribute is a pure paint/styling
   *  selector here. */
  pip: DockRowBucket;
  flatIndex: number;
}> = (props) => {
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const combined = createDockRowData(props.id);
  // Active-tile highlight follows the TILE registry (so a focused sleeping tile
  // reads as the active row in PR 2); unread is terminal-attention, stays on
  // the terminal store.
  const active = () => tileStore.activeId() === props.id;
  const unread = () => store.isUnread(props.id);
  const activity = useTerminalActivity();
  const modHeld = useModHeld();
  const showShortcutHint = () => modHeld() && props.flatIndex < 9;
  return (
    <Show when={combined()}>
      {(c) => {
        const labels = () => chipInitials(c().meta, c().info);
        return (
          <button
            type="button"
            data-testid="dock-rail"
            data-terminal-id={props.id}
            data-bucket={props.pip}
            data-agent-state={activeArm(c().meta)?.agent?.state}
            data-active={active() ? "" : undefined}
            data-unread={unread() ? "" : undefined}
            data-sub-count={
              c().info.subCount > 0 ? c().info.subCount : undefined
            }
            onClick={() => tileStore.activate(props.id)}
            class="dock-rail-chip"
            style={{ "--repo-color": c().info.repoColor }}
            title={chipTooltip(c().info, props.pip)}
            aria-label={chipTooltip(c().info, props.pip)}
          >
            <Show when={showShortcutHint()}>
              <span
                data-testid="dock-row-shortcut-hint"
                class="dock-rail-chip-hint"
                aria-hidden="true"
              >
                {props.flatIndex + 1}
              </span>
            </Show>
            <span class="dock-rail-chip-text" aria-hidden="true">
              {labels().repo}
              <span
                class="dock-rail-chip-sub"
                data-glyph={labels().subIsGlyph ? "" : undefined}
              >
                {labels().sub}
              </span>
            </span>
            {/* The glyph-only rail has no timestamp cell to swap, so the live
             *  dot rides as a corner overlay. It sits BOTTOM-right to stay clear
             *  of the three already-claimed corners: the unread badge
             *  (`.dock-rail-chip[data-unread]::after`, top-right) and the
             *  shortcut hint (`.dock-rail-chip-hint`, top-left) — an unread+live
             *  chip would otherwise paint both pips in the same top-right corner,
             *  making each signal ambiguous. The agent-state glow below tracks an
             *  AGENT's thinking/waiting; this dot is the orthogonal "moving bytes
             *  right now" signal (a compile, a `tail -f`, any non-agent shell) —
             *  without it, a live non-agent terminal is indistinguishable from an
             *  idle one in the rail. */}
            <Show when={activity.isLive(props.id)}>
              <span class="pointer-events-none absolute -bottom-1 -right-1">
                <LiveActivityDot />
              </span>
            </Show>
            {/* Agent-state glow on its own child so it animates opacity/transform
             *  (compositor) rather than repainting the chip's box-shadow every
             *  frame — see #1308. Gated on the PAINT bucket (`pip`), not the order
             *  bucket, so a fresh `waiting` agent keeps its lingering glow here as
             *  it does in cards mode and on its tile title. Only the two paint
             *  buckets render it; the CSS in index.css picks breath (awaiting) vs
             *  orbit (working). */}
            <Show when={props.pip === "awaiting" || props.pip === "working"}>
              <div class="dock-rail-chip-glow" aria-hidden="true" />
            </Show>
          </button>
        );
      }}
    </Show>
  );
};

function chipTooltip(info: TerminalDisplayInfo, bucket: DockRowBucket): string {
  return `${info.key.group} · ${info.key.label} · ${bucket}`;
}

export default Dock;
