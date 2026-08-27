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
 *     repo-tinted dock surface (cards spine, sticky header band + name
 *     colour, rail chip bg+ring, rail divider) reads the same `--repo-color`
 *     custom property, so the shared socket is a structural fact, not
 *     a comment. (Canvas tiles' `--card-color` / `--aura-c` are a
 *     separate module; converging them onto `--repo-color` is future
 *     work, not done here.)
 *  2. **cards** (default) — rows grouped by repo. Each repo is a
 *     **card**: continuous repo-colored **spine** (5 px) down the left
 *     edge, monogram tile + uppercase name in a repo-tinted **sticky**
 *     header, air between sections so fleets of 8+ repos stay scannable.
 *     The header pins to the scrollport top until the next repo's header
 *     pushes it off — so a row's repo is legible at a glance and survives
 *     the scroll. Rows below stack as `indicator · branch · pips · time`.
 *     The leading **status indicator** (`StatePip`) folds identity ·
 *     paint · motion · unread into one glyph (agent brand mark, state
 *     colour, spin/glow while active, amber corner badge when unopened)
 *     — so one glance reads who is driving and whether they need you.
 *     Agent kind is not labeled in text here — it lives on the terminal
 *     title bar where there's room. PR pip is a link to the PR with the
 *     live checks verdict in its tooltip; nested terminals appear as indented
 *     sub-entries beneath their parent. The active row gets a quiet
 *     highlight (`bg-surface-2` + accent left-edge stripe matching
 *     `--dock-edge-stripe-w`); row geometry stays constant so the dock
 *     never reflows when the active terminal changes. Pip columns share
 *     a CSS subgrid across each section so a column whose rows all lack
 *     a pip collapses to 0 width and gives that space back to the branch
 *     label.
 *
 *  The activity-window picker (`24h`/`12h`/`All`) is a hard filter, not
 *  a dim: rows past the window disappear from the dock entirely. It lives
 *  inside `HiddenFooter` at the bottom of the dock, in a `Filters` group
 *  beside its sibling the ☾ sleeping filter, so cause and effect share
 *  one zone — and the same strip offers a combined "N hidden · show all"
 *  disclosure that clears both filters whenever either is hiding rows.
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
import { activeArm } from "@kolu/padi-client/surface";

import { DockRow as DockRowView, DockSection } from "@kolu/solid-dockrow";
import type { DockRowBucket } from "@kolu/solid-dockrow/rowValues";
import { AttentionTriplet } from "@kolu/solid-statepip";
import { cwdBasename } from "@kolu/terminal-vocab/terminalKey";
import { createElementSize } from "@solid-primitives/resize-observer";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { match } from "ts-pattern";
import { createSharedRoot } from "../../createSharedRoot";
import { ACTIONS } from "../../input/actions";
import { isPlatformModifier } from "../../input/keyboard";
import { annotationLine } from "../../intent/text";
import { intentLeadGlyph } from "../../intent/text";
import { persistedPref } from "../../persistedPref";
import LiveActivityDot from "../../terminal/LiveActivityDot";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { useStatePip } from "../../terminal/statePipBind";
import { useTileStore } from "../../tile/useTileStore";
import { RAIL_WIDTH_PX } from "../../ui/chromeSpacing";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "../../ui/Icons";
import { nextAfter } from "../../ui/nextAfter";
import RepoMonogram from "../../ui/RepoMonogram";
import { encActiveHost } from "../../wire";
import { useViewPosture } from "../useViewPosture";
import { capturePointerGesture } from "../viewport/capturePointerGesture";
import { chipInitials } from "./chipInitials";
import { DockShortcutHint } from "./DockShortcutHint";
import {
  CARDS_WIDTH_PX,
  clampDockCardsWidth,
  dockCardsWidth,
  effectiveDockCardsWidth,
  setDockCardsWidth,
} from "./dockCardsWidth";
import { useDockRowBag } from "./useDockRowBag";
import { createDockRowData } from "./dockRowData";
import type { DockGroup, DockTree } from "./dockTree";
import { HiddenFooter } from "./HiddenFooter";
import { NeedsYouStrip } from "./NeedsYouStrip";
import { SubTerminalRow } from "./SubTerminalRow";
import { useDockFocus } from "./useDockFocus";
import { useDockOrder } from "./useDockOrder";
import { useSectionAttention } from "./useSectionAttention";

export type DockMode = "rail" | "cards";

// Cards-mode width (default + resize bounds + the persisted per-device
// pref) lives in its own leaf module so the pure clamp is testable
// without the whole Dock graph. Rail width is shared with the
// right-panel rail via `RAIL_WIDTH_PX` in `ui/chromeSpacing.ts` so the
// two collapsed surfaces stay visually paired across the canvas axis.

/** Fixed width for the non-resizable dock surfaces: the rail (always) and the
 *  tiled cards float (which keeps its default width). The maximized cards
 *  sidebar is the ONE resizable case and is sized by `effectiveDockWidth` in the
 *  component, not here — so a tiled float can never inherit a maximized resize. */
function dockWidth(mode: DockMode): number {
  return mode === "rail" ? RAIL_WIDTH_PX : CARDS_WIDTH_PX;
}

// Holding the platform modifier (Cmd on macOS, Ctrl elsewhere) reveals
// numeric hints over the first nine dock rows so the user can see what
// `Cmd+1..9` will target. Same modifier as the shortcut itself — the
// hint and the chord that fires it share one key, so users learn the
// mapping by holding-then-pressing without re-mapping a separate
// discovery modifier in their head. The signal + four window listeners
// live inside a `createSharedRoot`, so they are attached ONCE (not
// per-mount) and are APP-LIFETIME: the dock is always-mounted core
// chrome, the mod-hint is always wanted, and the shared root's disposer
// is discarded by design — so these listeners are never removed (no
// `onCleanup`, which would never run here), exactly like the clock and
// stale-ticker intervals. The browser reclaims them on page teardown.
// HOST-SCOPING: host-INDEPENDENT by design — a global browser modifier-held fact,
// not tied to any host's terminal data.
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
  /** Opens the command palette host-scoped (Terminals › active host) —
   *  invoked by the dock's search-icon button. */
  onOpenWorkspaceSearch: () => void;
  onCreate: () => void;
}> = (props) => {
  const tree = useDockOrder();
  const posture = useViewPosture();

  // Width of the flex host the maximized dock shares with the canvas — its own
  // parent. `effectiveDockWidth` caps the rendered width to it so a stored-wide
  // dock can't squeeze the canvas to zero and clip its own handle off-screen
  // (the right-panel split can shrink this host well below the 560px ceiling).
  // Resolved in `onMount`, NOT the `ref` callback: Solid runs `ref` before the
  // element is inserted, so `parentElement` is still null there — reading it then
  // would leave the host unmeasured and the cap silently inert.
  let asideEl!: HTMLElement;
  const [hostEl, setHostEl] = createSignal<HTMLElement | null>(null);
  onMount(() => setHostEl(asideEl.parentElement));
  const hostSize = createElementSize(hostEl);

  /** The one resizable dock surface: the maximized cards sidebar. Named once so
   *  the width computation and the resize-handle gate stay provably
   *  co-extensive — a handle can't render on a dock that isn't host-capped, nor
   *  vice versa. */
  const isResizableDock = (): boolean =>
    posture.mode() === "maximized" && dockMode() === "cards";

  // Live drag-in-progress width — NOT persisted. Every `pointermove` during a
  // drag would otherwise call `setDockCardsWidth`, which writes straight
  // through to `localStorage` on each call (no debounce in `persistedPref` /
  // `makePersisted` — see `dockCardsWidth.ts`), a synchronous disk write at
  // 60-120×/s for the drag's duration. Mirrors `CanvasTile`'s resize gesture
  // (`TerminalCanvas.tsx`): `onMove` only updates this local signal, and the
  // stored preference is written exactly once, in `onEnd`.
  const [dragWidth, setDragWidth] = createSignal<number | null>(null);

  /** Rendered width for the maximized cards sidebar — the in-progress drag
   *  width while dragging, else the stored preference; both capped to the
   *  live host width (handle stays reachable). Other postures use the plain
   *  `dockWidth`. */
  const effectiveDockWidth = (): number =>
    isResizableDock()
      ? effectiveDockCardsWidth(
          dragWidth() ?? dockCardsWidth(),
          hostSize.width ?? 0,
        )
      : dockWidth(dockMode());

  // Drag-to-resize the maximized cards dock — mirrors the right panel's
  // handle. A fresh `AbortController` per gesture; `capturePointerGesture`
  // (shared with tile resize / canvas pan) wires window pointermove/up+cancel
  // and auto-unwires on release. The drag starts from the RENDERED width (not
  // the raw stored value) so a host-capped dock doesn't jump on grab.
  let abortDockResize: AbortController | null = null;
  function startDockResize(e: PointerEvent) {
    // Primary button only — a right/middle-button drag on the edge shouldn't
    // resize (and would fight the context menu / pan).
    if (e.button !== 0) return;
    // A resize is already in flight — ignore further pointerdowns rather than
    // abort-and-replace, so a second touch/pen (which also reports button 0)
    // can't hijack the active gesture from the pointer that owns it.
    if (abortDockResize) return;
    e.preventDefault();
    const startX = e.clientX;
    // Delta rides the RENDERED width (so a host-capped dock doesn't jump on
    // grab).
    const startWidth = effectiveDockWidth();
    // No prior gesture to abort — the `if (abortDockResize) return` guard above
    // already established it's null.
    abortDockResize = new AbortController();
    capturePointerGesture(
      {
        onMove: (ev) =>
          setDragWidth(clampDockCardsWidth(startWidth + (ev.clientX - startX))),
        onEnd: () => {
          // Commit exactly once. `dragWidth` stays null on a pointerdown with
          // no motion (a bare click on the handle) — skip the write, same as
          // CanvasTile's "no motion — skip commit" resize path.
          const width = dragWidth();
          if (width !== null) setDockCardsWidth(width);
          setDragWidth(null);
          abortDockResize = null;
        },
        onCancel: () => {
          // The stored preference was never touched during the drag, so
          // reverting is just dropping the local drag width — the render
          // falls back to `dockCardsWidth()`, untouched since before the drag.
          setDragWidth(null);
          abortDockResize = null;
        },
      },
      abortDockResize,
      // Bind to the initiating pointer so a second touch/pen can't drive or end
      // this resize.
      e.pointerId,
    );
  }
  // The dock is app-lifetime chrome, so this rarely fires — but a disposal
  // mid-drag must abort the in-flight gesture rather than leak window listeners.
  onCleanup(() => abortDockResize?.abort());

  return (
    <aside
      data-testid="dock"
      ref={asideEl}
      data-mode={dockMode()}
      data-maximized={posture.mode() === "maximized" ? "" : undefined}
      class="flex flex-col select-none overflow-hidden bg-surface-1"
      classList={{
        // Tiled: absolute float inside the canvas; positions over
        // tiles rather than reflowing them. `top-6` keeps a small
        // gutter below the (now borderless) chrome so the dock reads as
        // a canvas tool without floating conspicuously low. Opaque
        // background (see base class) so canvas tiles don't bleed
        // through the seams between rows or behind the rounded corners.
        "absolute z-30 top-6 left-4 rounded-2xl shadow-2xl shadow-black/40":
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
      style={{ width: `${effectiveDockWidth()}px` }}
    >
      <RailOrCards
        mode={dockMode()}
        tree={tree()}
        onCreate={props.onCreate}
        onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
      />
      {/* Right-edge resize handle — only in the maximized cards sidebar,
       *  where the dock is a real flex sibling of the canvas (the request:
       *  resize it "just like the right panel"). Rail is a fixed chip strip
       *  and the tiled float is a card, so neither offers the handle.
       *  Invisible until hover; the col-resize cursor is the affordance —
       *  a plain interactive div, matching the canvas tile resize handles
       *  (CanvasTile) rather than a `role="separator"` widget (that path is
       *  Corvu's, which owns its own keyboard/aria contract; a hand-rolled
       *  separator would need a focusable aria-value range this drag has
       *  no keyboard step for). Double-click resets to the default width.
       *  `w-1.5` stays inside the aside's `overflow-hidden`, so no clipped
       *  pseudo hit-area. */}
      <Show when={isResizableDock()}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only resize affordance, same as CanvasTile's edge/corner handles — the cursor is the affordance, keyboard resize isn't offered for this drag */}
        <div
          data-testid="dock-resize-handle"
          class="absolute inset-y-0 right-0 z-40 w-1.5 cursor-col-resize hover:bg-accent/30 transition-colors"
          title="Drag to resize · double-click to reset"
          onPointerDown={startDockResize}
          onDblClick={() => setDockCardsWidth(CARDS_WIDTH_PX)}
        />
      </Show>
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
  // The DESKTOP landing verb for the needs-you strip: split-aware, and it
  // composes canvas centering. The touch surfaces pass their own (see
  // `NeedsYouStrip`), which are split-aware too.
  const dockFocus = useDockFocus();
  // Pre-built `id → flat position` map. RepoSection used to compute
  // each row's flat index via `findIndex` over `flatShortcutRows`, costing
  // O(rows²) per render. The map is rebuilt only when the tree
  // changes (one O(n) pass) and every row reads its position in O(1).
  const flatIndexOf = createMemo(
    () => new Map(props.tree.flatShortcutRows.map((r, i) => [r.id, i])),
  );
  return (
    <div class="flex flex-col w-full min-h-0">
      <DockHeader
        mode={props.mode}
        onCreate={props.onCreate}
        onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
      />
      {/* Pinned ABOVE the scrollport, not inside it: a blocked agent you have
       *  to scroll to find is the defect this replaces, not a milder form of
       *  it. Renders nothing when nothing is blocked. */}
      <NeedsYouStrip
        entries={props.tree.needsYou}
        density={props.mode === "rail" ? "icon" : "full"}
        // `useDockFocus`, NOT `tileStore.activate` — the same landing verb the
        // section-header asking capsule and `SubTerminalRow` use. The strip
        // hands it the BLOCKED id, which for a split-blocked tile is a split
        // id, and `activate` → `focusMainTerminal` cannot focus one (it throws
        // on a split, and otherwise lands on the parent's main pane). This verb
        // resolves a split to its tab and still centres the canvas.
        onSelect={dockFocus}
      />
      <div class="flex flex-col overflow-y-auto overflow-x-hidden scrollbar-none flex-1 min-h-0">
        <Show
          when={props.mode === "rail"}
          fallback={
            <div class="flex flex-col gap-2.5 p-2">
              <For each={props.tree.groups}>
                {(group) => (
                  <RepoSection group={group} flatIndexOf={flatIndexOf()} />
                )}
              </For>
            </div>
          }
        >
          <For each={props.tree.groups}>
            {(group) => (
              <>
                <RailSectionMark color={group.color} name={group.name} />
                <For each={group.railEntries}>
                  {(entry) =>
                    match(entry)
                      .with({ kind: "top" }, ({ row }) => (
                        <RailChip
                          id={row.id}
                          pip={row.pip}
                          flatIndex={flatIndexOf().get(row.id) ?? -1}
                        />
                      ))
                      .with({ kind: "split" }, ({ row }) => (
                        <RailSubChip row={row} repoColor={group.color} />
                      ))
                      .exhaustive()
                  }
                </For>
              </>
            )}
          </For>
        </Show>
      </div>
      {/* Footer carries the dock's `Filters` group (activity window + ☾
       *  sleeping) and their combined "N hidden · show all" disclosure. It
       *  only earns its place once there's something to filter or show: at
       *  true zero (no visible rows, nothing parked, nothing sleeping —
       *  the empty-canvas Dock) it would be a filter row over nothing. The
       *  all-hidden case (no visible rows but parked/sleeping rows exist)
       *  still needs it — that is exactly when "show all" is the way back.
       *  In rail mode the footer hands off to its chip-only stacked layout
       *  (the 44px rail can't hold the label or sentence), driven by the
       *  `rail` prop below. */}
      <Show when={props.tree.hasContent}>
        <HiddenFooter
          hiddenCount={props.tree.hiddenCount}
          sleepingCount={props.tree.sleepingCount}
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
        aria-label={ACTIONS.createTerminal.label}
        title={ACTIONS.createTerminal.label}
      >
        <PlusIcon class="w-3.5 h-3.5 transition-transform duration-200 group-hover/new:rotate-90" />
      </button>
      <button
        type="button"
        data-testid="dock-search"
        onClick={props.onOpenWorkspaceSearch}
        class="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="Search terminals on this host"
        title="Search terminals on this host"
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

/** Repo section — monogram tile + uppercase name + bare row tally +
 *  attention triplet over the group's rows. Always rendered, even for
 *  single-repo workspaces — a consistent structure beats a degenerate-case
 *  collapse. Paint lives in `.dock-cards-section*`, now shipped by
 *  `@kolu/solid-dockrow/dockrow.css` with the rows it wraps. */
const RepoSection: Component<{
  group: DockGroup;
  /** Pre-built `id → flat position` lookup so each row's `Cmd+N` hint
   *  index is an O(1) read instead of an O(rows) `findIndex` scan per
   *  row per render. Built once per tree update by `RailOrCards`. */
  flatIndexOf: ReadonlyMap<TerminalId, number>;
}> = (props) => {
  const store = useTerminalStore();
  const focus = useDockFocus();
  // The header's attention summary — the SAME triplet, on the SAME activity
  // predicate, the host tab renders.
  const attn = useSectionAttention(() => props.group);
  // Capsule click = navigate to the next terminal IN THE SET THE CAPSULE
  // COUNTED, cycling past the active one — the same never-dismiss law as the
  // host pill (violet clears only when the agent stops waiting; amber clears
  // because activating the terminal marks it read). It walks the counted ids
  // rather than re-filtering the visible rows: the count deliberately includes
  // rows the activity window parked, which was exactly the case the old click
  // could not reach — a capsule reading "1" that did nothing.
  const jumpTo = (ids: readonly TerminalId[]) => {
    const next = nextAfter(ids, store.focusedTerminalId());
    if (next === undefined) return;
    focus(next);
  };
  // Section is the grid container. Three columns (the `DOCK_ROW_GRID`
  // template): indicator · branch · time. The leading
  // indicator column is a fixed 20px reserved track holding `StatePip`
  // so the indicator never shifts as its axes flip and pips stay
  // aligned across rows. PR pip is NOT a grid column — it lives inline
  // on line 2 (left of the subline text), anchored to the branch
  // column's left edge so its X stays consistent across every section.
  // Branch is `minmax(0,1fr)` so it stretches and truncates; time is `auto`.
  // Each DockRow is a subgrid
  // item that inherits these columns, keeping the icons aligned
  // vertically across rows in one section.
  return (
    <DockSection
      surface="desktop"
      testId="dock-section"
      repo={props.group.name}
      repoColor={props.group.color}
      headerTestId="dock-section-header"
      header={
        <>
          {/* Sticky repo header — monogram + uppercase name + bare tally +
           *  attention triplet (styles in `@kolu/solid-dockrow/dockrow.css`). The tally
           *  deliberately BARE text, not a capsule: the capsule silhouette is
           *  reserved for actionable attention counts, so a number in a pill
           *  always means "act on this" (fucknotif — the old count capsule
           *  read as six decoy notification badges). Monogram is the shared
           *  `<RepoMonogram />` atom — same paint as palette / restore. */}
          <RepoMonogram
            group={props.group.name}
            color={props.group.color}
            data-testid="dock-section-monogram"
          />
          <span
            data-testid="dock-section-name"
            class="dock-cards-section-name font-mono text-[0.7rem] font-extrabold uppercase tracking-[0.1em] truncate min-w-0"
            title={props.group.name}
          >
            {props.group.name}
          </span>
          <span
            class="dock-cards-section-count font-mono text-[0.6rem]"
            title={`${props.group.railEntries.length} terminals`}
          >
            {props.group.railEntries.length}
          </span>
          <AttentionTriplet
            active={attn().activeIds.length}
            asking={attn().askingIds.length}
            unseen={attn().unseenIds.length}
            sizeClass="min-w-4 px-1 h-4"
            scopeLabel={props.group.name}
            onAsking={() => jumpTo(attn().askingIds)}
            onUnseen={() => jumpTo(attn().unseenIds)}
            class="ml-auto"
          />
        </>
      }
    >
      <For each={props.group.topRows}>
        {(row) => (
          <>
            <DockRow
              id={row.id}
              bucket={row.bucket}
              pip={row.pip}
              recencyAt={row.ts}
              flatIndex={props.flatIndexOf.get(row.id) ?? -1}
            />
            <For each={row.subRows}>
              {(sub) => (
                <SubTerminalRow row={sub} surface="desktop" onSelect={focus} />
              )}
            </For>
          </>
        )}
      </For>
    </DockSection>
  );
};

/** kolu's desktop wiring for `@kolu/solid-dockrow`'s two-line row.
 *
 *  The row itself — pip, annotation, status words, recency, PR badge, stripe,
 *  wash — is the package's. What is HERE is what only this app can answer: the
 *  terminal store and its display projection, the attention mirror the pip binds
 *  off, which tile is active, and the desktop-only ⌘N hint that rides over the
 *  row while the platform modifier is held.
 *
 *  The touch counterpart lives in `DockList.tsx` and hands the SAME component a
 *  `touch` density. They used to be two hand-kept copies of the markup, linked
 *  by a comment reading "Update both files when row geometry changes"; there is
 *  now nothing to keep in step. */
const DockRow: Component<{
  id: TerminalId;
  /** ORDER bucket — drives `data-bucket` (used by ordering tests / styling). */
  bucket: DockRowBucket;
  /** PIP bucket — drives the `StatePip` colour, decoupled from order so the row
   *  pip reads identically to the tile title's pip (both `agentPaintClass`). */
  pip: DockRowBucket;
  /** Newest activity in the whole tile, including its splits. */
  recencyAt: number | null;
  /** Position in the dock-wide flat row order. `< 9` qualifies the row
   *  for a `Cmd+(flatIndex+1)` shortcut hint while the platform
   *  modifier is held. */
  flatIndex: number;
}> = (props) => {
  const tileStore = useTileStore();
  const combined = createDockRowData(props.id);
  const modHeld = useModHeld();
  const rowBag = useDockRowBag();
  return (
    <Show when={combined()}>
      {(c) => {
        // ONCE per row, not in the spread — the bag mints this row's StatePip
        // memo, and a memo re-created on every prop read either accumulates on
        // this owner or freezes the row at first paint. See `useDockRowBag`.
        const bag = rowBag({
          id: props.id,
          combined: c,
          bucket: () => props.bucket,
          pipBucket: () => props.pip,
          recencyAt: () => props.recencyAt,
        });
        return (
          <DockRowView
            {...bag}
            surface="desktop"
            onSelect={() => tileStore.activate(props.id)}
            overlay={
              <DockShortcutHint
                flatIndex={props.flatIndex}
                modHeld={modHeld}
                class="absolute top-0.5 left-0.5 inline-flex items-center justify-center h-3.5 min-w-3.5 px-1 rounded bg-accent text-surface-1 font-mono text-[0.55rem] font-bold tabular-nums pointer-events-none"
              />
            }
            testIds={{
              row: "dock-row",
              agentSubline: "dock-agent-subline",
              quietSubline: "dock-quiet-foreground",
            }}
            title="Jump to this terminal"
          />
        );
      }}
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

/** Split entry in the collapsed rail. It shares the parent's repo tint but has
 * no numeric shortcut. Same StatePip fold as cards-mode SubTerminalRow / top-
 * level DockRow — identity, paint, motion, unread — no per-kind re-gate.
 * Exported for the shell-pip contract test (`RailSubChip.test.tsx`), which pins
 * that fold. */
export const RailSubChip: Component<{
  row: Extract<DockGroup["railEntries"][number], { kind: "split" }>["row"];
  repoColor: string;
}> = (props) => {
  const store = useTerminalStore();
  const focus = useDockFocus();
  const meta = () => store.getMetadata(props.row.id);
  const unread = () => store.isUnread(props.row.id);
  return (
    <Show when={meta()}>
      {(m) => {
        const label = () => annotationLine(m().intent, cwdBasename(m().cwd));
        const glyph = () => intentLeadGlyph(label());
        const pip = useStatePip(
          encActiveHost,
          () => props.row.id,
          m,
          unread,
          () => props.row.pip,
        );
        return (
          <button
            type="button"
            data-testid="dock-rail-sub"
            data-terminal-id={props.row.id}
            data-bucket={props.row.pip}
            data-motion={pip().motion}
            data-agent-state={activeArm(m())?.agent?.state}
            data-active={
              store.focusedTerminalId() === props.row.id ? "" : undefined
            }
            data-unread={unread() ? "" : undefined}
            onClick={() => focus(props.row.id)}
            class="dock-rail-chip w-[26px]! h-[26px]! rounded-[7px]! -mt-px"
            style={{ "--repo-color": props.repoColor }}
            title={`Split · ${label()}`}
            aria-label={`Jump to split ${label()}`}
          >
            <span class="dock-rail-chip-text text-[11px]!" aria-hidden="true">
              ↳
              <Show when={glyph()}>
                {(value) => <span class="dock-rail-chip-sub">{value()}</span>}
              </Show>
            </span>
            <Show when={pip().bytesLive}>
              <span class="pointer-events-none absolute -bottom-1 -right-1">
                <LiveActivityDot />
              </span>
            </Show>
            <Show when={pip().motion !== "none"}>
              <div class="dock-rail-chip-glow" aria-hidden="true" />
            </Show>
          </button>
        );
      }}
    </Show>
  );
};

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
  const unread = () => store.isUnread(props.id);
  const modHeld = useModHeld();
  return (
    <Show when={combined()}>
      {(c) => {
        const labels = () => chipInitials(c().meta, c().info);
        // Same hook as cards StatePip — motion/active drive rail glow.
        const pip = useStatePip(
          encActiveHost,
          () => props.id,
          () => c().meta,
          unread,
          () => props.pip,
        );
        return (
          <button
            type="button"
            data-testid="dock-rail"
            data-terminal-id={props.id}
            data-bucket={props.pip}
            data-motion={pip().motion}
            data-agent-state={activeArm(c().meta)?.agent?.state}
            data-active={tileStore.isActiveTile(props.id) ? "" : undefined}
            data-unread={unread() ? "" : undefined}
            onClick={() => tileStore.activate(props.id)}
            class="dock-rail-chip"
            style={{ "--repo-color": c().info.repoColor }}
            title={chipTooltip(c().info, props.pip)}
            aria-label={chipTooltip(c().info, props.pip)}
          >
            <DockShortcutHint
              flatIndex={props.flatIndex}
              modHeld={modHeld}
              class="dock-rail-chip-hint"
            />
            <span class="dock-rail-chip-text" aria-hidden="true">
              {labels().repo}
              <span
                class="dock-rail-chip-sub"
                data-glyph={labels().subIsGlyph ? "" : undefined}
              >
                {labels().sub}
              </span>
            </span>
            {/* Live bytes corner — orthogonal to agent motion glow. */}
            <Show when={pip().bytesLive}>
              <span class="pointer-events-none absolute -bottom-1 -right-1">
                <LiveActivityDot />
              </span>
            </Show>
            {/* Motion glow/spin from useStatePip (same as cards StatePip). */}
            <Show when={pip().motion !== "none"}>
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
