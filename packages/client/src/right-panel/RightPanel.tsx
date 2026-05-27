/** RightPanel — right panel shell with tabbed navigation.
 *  Routes between Inspector and Code tabs via the DU view exposed by
 *  `useRightPanel().activeTab()`. */

import type {
  RightPanelTabKind,
  TerminalId,
  TerminalMetadata,
} from "kolu-common/surface";
import { type Component, createEffect, For, on, Show } from "solid-js";
import { match } from "ts-pattern";
import { useViewPosture } from "../canvas/useViewPosture";
import { CHROME_ICON_BUTTON_CLASS, RAIL_WIDTH_PX } from "../ui/chromeSpacing";
import { ChevronDownIcon } from "../ui/Icons";
import { ACTIVE_TERMINAL_ACCENT } from "./activeTerminalAccent";
import CodeTab from "./CodeTab";
import MetadataInspector from "./MetadataInspector";
import { pendingOpen } from "./openInCodeTab";
import { useRightPanel } from "./useRightPanel";

/** Ordered tab kinds shown in the tab bar. Adding a new kind to the
 *  discriminated union requires a corresponding entry here AND in
 *  `TAB_LABEL` below — both are typed `Record<RightPanelTabKind, …>` and
 *  fail-compile on missing keys. The body renderer further down dispatches
 *  via `match(kind).exhaustive()`, which also fails-compile on a missing
 *  variant — so adding a new kind is a three-place change that the
 *  compiler enforces end-to-end. */
const TAB_KINDS: readonly RightPanelTabKind[] = ["inspector", "code"] as const;

const TAB_LABEL: Record<RightPanelTabKind, string> = {
  inspector: "Inspector",
  code: "Code",
};

const RightPanel: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  onToggle: () => void;
  themeName?: string;
  onThemeClick?: () => void;
  /** Whether this `RightPanel` instance is visible to the user. The host
   *  decides — desktop reads `collapsed()`, mobile reads `drawerOpen()`.
   *  Threading the signal keeps `RightPanel` a pure presenter and lets
   *  `aria-hidden` track actual visibility on both surfaces. */
  visible: boolean;
  /** Apply the posture-aware shell that mirrors the Dock (floating
   *  card in tiled mode, flush right sidebar in maximized mode).
   *  Desktop passes `true`; mobile passes `false` since the drawer
   *  itself is already a floating surface and an inner card-on-card
   *  would double up the chrome. */
  shell: boolean;
}> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();

  const showKind = (kind: RightPanelTabKind) =>
    kind === "inspector" ? rightPanel.showInspector() : rightPanel.showCode();

  // Producer arrivals (terminal `path:line` taps, comments-tray jumps)
  // uncollapse the panel — registered here (inside the same owner
  // scope as the rendered panel) rather than in `App.tsx` because the
  // App-root version silently dropped subsequent `pendingOpen` fires
  // in this layout. Mobile's drawer-open equivalent stays in
  // `RightPanelLayout`. The shell guard mirrors the mobile branch's
  // semantics — when this `RightPanel` is the desktop instance the
  // shell wraps the floating card, so an expand is the right
  // response; the mobile drawer instance never has `shell=true`.
  createEffect(
    on(
      pendingOpen,
      (req) => {
        if (!req || !props.shell) return;
        if (rightPanel.collapsed()) rightPanel.expandPanel();
      },
      { defer: true },
    ),
  );

  // Custom resize: pointer-event drag on a thin strip at the panel's
  // outer-left edge. Width is stored as a fraction of the parent's
  // width so the persisted preference survives viewport resize.
  function onHandlePointerDown(e: PointerEvent) {
    if (!props.shell) return;
    e.preventDefault();
    const panelEl = (e.currentTarget as HTMLElement).parentElement;
    const parentEl = panelEl?.parentElement;
    if (!parentEl) return;
    const parentWidth = parentEl.getBoundingClientRect().width;
    if (parentWidth === 0) return;
    const startX = e.clientX;
    const startSize = rightPanel.panelSize();
    const onMove = (ev: PointerEvent) => {
      // Dragging *leftward* makes the panel wider (it grows toward
      // the canvas).
      const delta = (startX - ev.clientX) / parentWidth;
      const MIN = 0.1;
      const MAX = 0.7;
      const next = Math.max(MIN, Math.min(MAX, startSize + delta));
      rightPanel.setPanelSize(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** Desktop visibility — collapsed swaps the visible body from the
   *  tab content to the 44 px rail and back. Both bodies stay mounted
   *  when the shell is active (display-toggled, not Show-toggled), so
   *  CodeTab's selectedPath signal and Pierre's tree expansion survive
   *  collapse round-trips (#818). The drawer instance (`shell=false`)
   *  always shows its tab content — the drawer host owns visibility
   *  itself, and there's no rail concept on mobile.
   *
   *  `display: none` on parts WITHIN this component is safe; #986's
   *  warning specifically calls out a `display: none` wrapper AROUND
   *  the inner `RightPanel`, not the inner subtrees. */
  const contentClass = () =>
    !props.shell || props.visible
      ? "flex flex-col h-full min-w-0 overflow-hidden bg-surface-0"
      : "hidden";
  const railClass = () =>
    props.shell && !props.visible
      ? "flex flex-col items-center pt-2 h-full bg-surface-1"
      : "hidden";

  /** Width of the shell aside. Collapsed in shell mode → 44 px rail;
   *  expanded → persisted `panelSize` fraction × parent width; no shell
   *  (mobile drawer) → undefined (`<aside>` fills the drawer body via
   *  `h-full`, no explicit width). */
  const shellWidth = () => {
    if (!props.shell) return undefined;
    return props.visible
      ? `${rightPanel.panelSize() * 100}%`
      : `${RAIL_WIDTH_PX}px`;
  };

  return (
    // Outer `<aside>` is positioning + width only: NO `flex flex-col`
    // and NO `bg-surface-0` on the shell base — #986 documents these
    // as xterm.js link-decoration interaction triggers (the second
    // `path:line` click after a manual collapse can silently stop
    // firing `openInCodeTab` when the collapsed shell carries either
    // pattern). The inner `<div>` carries the visual chrome instead.
    <aside
      data-testid="right-panel"
      data-maximized={
        props.shell && posture.mode() === "maximized" ? "" : undefined
      }
      data-collapsed={props.shell && !props.visible ? "" : undefined}
      classList={{
        // No shell (mobile): fill the drawer body. The drawer already
        // provides the floating surface.
        "h-full block": !props.shell,
        // Shell + tiled + expanded: absolute float on the right edge
        // of the canvas — mirror of the Dock's tiled chrome
        // (`Dock.tsx`) on the opposite side. `top-12` (48 px) clears
        // the 44 px chrome bar by 4 px and lines up with the dock's
        // anchor; `bottom-4` lets the floating card extend to most of
        // the canvas height (Inspector + Code with file tree are tall).
        "absolute z-30 top-12 right-4 bottom-4 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden":
          props.shell && posture.mode() === "tiled" && props.visible,
        // Everything else with a shell renders as a real right-panel
        // flex sibling of the canvas with a left-edge separator:
        //  - Tiled + collapsed: 44 px rail (NOT absolute — #986
        //    documents `position: absolute` on the collapsed shell as
        //    an xterm.js link-decoration interaction trigger). The
        //    canvas's `flex-1` gives back the 44 px the rail consumes.
        //  - Maximized + expanded: mirror of the Dock's maximized
        //    chrome on the opposite side. A hard panel boundary, not
        //    a floating card.
        //  - Maximized + collapsed: 44 px rail flex sibling using the
        //    same left-edge separator as the expanded sibling.
        "relative shrink-0 h-full border-l border-edge overflow-hidden":
          props.shell &&
          (posture.mode() === "maximized" ||
            (posture.mode() === "tiled" && !props.visible)),
      }}
      style={shellWidth() ? { width: shellWidth() } : undefined}
      aria-hidden={!props.visible}
    >
      {/* Resize handle — thin strip on the panel's outer-left edge.
       *  Hit zone widened to 12 px via `before:-left-1.5 before:w-3`
       *  so the pointer target isn't a 1 px sliver; `z-50` lifts it
       *  above the maximized canvas tile's `z-40` (#986). Only
       *  rendered when the shell is active and the panel is expanded
       *  — nothing to resize on the mobile drawer (`shell=false`) or
       *  on the collapsed 44 px rail (`visible=false`). */}
      <Show when={props.shell && props.visible}>
        <div
          data-testid="right-panel-handle"
          title="Resize inspector panel"
          class="absolute inset-y-0 left-0 w-0 z-50 before:absolute before:inset-y-0 before:-left-1.5 before:w-3 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
          onPointerDown={onHandlePointerDown}
        />
      </Show>

      {/* Collapsed rail body — narrow chevron-only column. The
       *  `ChevronDownIcon` rotated 90° clockwise points LEFT (toward
       *  the canvas), mirroring the dock-rail's `-rotate-90` chevron
       *  which points RIGHT (also toward the canvas) across the
       *  vertical canvas axis. Always mounted (display-toggled via
       *  `railClass()`) so the parent layout doesn't shift on
       *  expand/collapse. */}
      <div class={railClass()}>
        <button
          type="button"
          data-testid="right-panel-rail-expand"
          class="flex items-center justify-center w-7 h-7 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => rightPanel.expandPanel()}
          aria-label="Expand inspector"
          title="Expand inspector"
        >
          <span class="inline-flex rotate-90">
            <ChevronDownIcon class="w-3.5 h-3.5" />
          </span>
        </button>
      </div>

      {/* Tab content — always mounted (display-toggled via
       *  `contentClass()`) so `CodeTab`'s selectedPath signal and
       *  Pierre's tree expansion survive collapse round-trips (#818).
       *  The visibility flip is a class swap on this wrapper, not a
       *  wrapper-around-RightPanel `display: none`, which #986 calls
       *  out as an xterm.js link-decoration interaction trigger. */}
      <div class={contentClass()}>
        {/* Tab bar — chevron on the canvas-facing edge (top-left),
         *  mirroring the dock header's top-right chevron across the
         *  vertical canvas axis. `ChevronDownIcon` rotated
         *  `-rotate-90` (CCW) points RIGHT, indicating the collapse
         *  direction (toward the right edge of the viewport). */}
        <div class="flex items-center h-8 shrink-0 bg-surface-1 border-b border-edge">
          <Show when={props.shell}>
            <div class="flex items-center gap-0.5 pl-1">
              <button
                type="button"
                class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:text-fg-2 hover:bg-surface-0/50`}
                onClick={props.onToggle}
                aria-label="Collapse panel"
              >
                <span class="inline-flex -rotate-90">
                  <ChevronDownIcon class="w-3.5 h-3.5" />
                </span>
              </button>
            </div>
          </Show>
          <For each={TAB_KINDS}>
            {(kind) => {
              const isActive = () => rightPanel.activeTab().kind === kind;
              return (
                <button
                  type="button"
                  data-testid={`right-panel-tab-${kind}`}
                  data-active={isActive()}
                  class={`h-full px-3 text-xs cursor-pointer transition-colors ${
                    isActive()
                      ? "font-medium text-fg-2 bg-surface-0 border-b-2"
                      : "text-fg-3/50 hover:text-fg-2 hover:bg-surface-0/50 border-b-2 border-transparent"
                  }`}
                  style={{
                    "border-bottom-color": isActive()
                      ? ACTIVE_TERMINAL_ACCENT
                      : undefined,
                  }}
                  onClick={() => showKind(kind)}
                >
                  {TAB_LABEL[kind]}
                </button>
              );
            }}
          </For>
          <div class="flex-1" />
          {/* Mobile drawer keeps its own dismiss chevron at the
           *  top-right of the tab bar, distinct from the desktop
           *  canvas-facing chevron above. */}
          <Show when={!props.shell}>
            <div class="flex items-center gap-0.5 pr-1">
              <button
                type="button"
                class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:text-fg-2 hover:bg-surface-0/50`}
                onClick={props.onToggle}
                aria-label="Collapse panel"
              >
                <span class="inline-flex -rotate-90">
                  <ChevronDownIcon class="w-3.5 h-3.5" />
                </span>
              </button>
            </div>
          </Show>
        </div>
        {/* Both tabs are always rendered; the inactive one is display:none.
         *  Mounting both keeps each tab's local state (CodeTab's selected file,
         *  Pierre's tree expansion, scroll position) alive across tab switches
         *  — wrapping a single `match(...).exhaustive()` over `activeTab()`
         *  would unmount the inactive sibling and discard that state. The
         *  shape below iterates `TAB_KINDS` (already compile-exhaustive over
         *  RightPanelTabKind via the `Record<RightPanelTabKind, …>` typings
         *  on TAB_LABEL) so both bodies mount once, then `match(kind)` picks
         *  which component to render per slot — exhaustive *and* both-mounted. */}
        <div class="flex-1 min-h-0 overflow-hidden">
          <For each={TAB_KINDS}>
            {(kind) => {
              const isActive = () => rightPanel.activeTab().kind === kind;
              return (
                <div
                  class={isActive() ? "h-full" : "hidden"}
                  aria-hidden={!isActive()}
                >
                  {match(kind)
                    .with("inspector", () => (
                      <MetadataInspector
                        meta={props.meta}
                        themeName={props.themeName}
                        onThemeClick={props.onThemeClick}
                      />
                    ))
                    .with("code", () => (
                      <CodeTab
                        terminalId={props.terminalId}
                        meta={props.meta}
                      />
                    ))
                    .exhaustive()}
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </aside>
  );
};

export default RightPanel;
