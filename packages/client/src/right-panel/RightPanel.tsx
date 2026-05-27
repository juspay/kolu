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
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { ChevronRightIcon } from "../ui/Icons";
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

  return (
    <aside
      data-testid="right-panel"
      data-maximized={props.shell && posture.maximized() ? "" : undefined}
      class="flex flex-col min-w-0 overflow-hidden bg-surface-0"
      classList={{
        // No shell (mobile): fill the drawer body. The drawer already
        // provides the floating surface.
        "h-full": !props.shell,
        // Shell + tiled: absolute float on the right edge of the
        // canvas — mirror of the Dock's tiled chrome (`Dock.tsx`
        // line 160) on the opposite side. The dock uses
        // `max-h-[calc(100vh-22rem)]` because its content (chip rail
        // or repo cards) is naturally short; the right panel's
        // content is much taller (Inspector + Code with file tree +
        // editor), so we constrain via `bottom-4` to take the full
        // vertical extent of the canvas instead.
        "absolute z-30 top-20 right-4 bottom-4 rounded-2xl shadow-2xl shadow-black/40":
          props.shell && !posture.maximized(),
        // Shell + maximized: real right-panel flex sibling of the
        // canvas — mirror of the Dock's maximized chrome (`Dock.tsx`
        // line 169). A left-edge separator reads as a hard panel
        // boundary rather than a floating card.
        "relative shrink-0 h-full border-l border-edge":
          props.shell && posture.maximized(),
      }}
      style={
        props.shell
          ? {
              // Collapsed → 0 width so `right-panel.feature`'s
              // `boundingClientRect().width <= 1` assertion passes and
              // the panel stops consuming flex space in maximized
              // mode. The DOM stays mounted so `CodeTab`'s selectedPath
              // signal + Pierre's tree expansion survive collapse
              // (#818). Width comes from the persisted `panelSize`
              // fraction × the parent's width.
              width: props.visible ? `${rightPanel.panelSize() * 100}%` : "0px",
            }
          : undefined
      }
      aria-hidden={!props.visible}
    >
      {/* Resize handle — thin strip on the panel's outer-left edge.
       *  Custom pointer-event drag (no Corvu Resizable in the new
       *  Dock-mirror structure). Only rendered when the shell is
       *  active and the panel is visible, since there's nothing to
       *  resize on the mobile drawer (`shell=false`) or when
       *  collapsed (`visible=false` → width=0). */}
      <Show when={props.shell && props.visible}>
        <div
          data-testid="right-panel-handle"
          class="absolute top-0 left-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
          onPointerDown={onHandlePointerDown}
        />
      </Show>
      {/* Tab bar */}
      <div class="flex items-center h-8 shrink-0 bg-surface-1 border-b border-edge">
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
        <div class="flex items-center gap-0.5 pr-1">
          <button
            type="button"
            class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:text-fg-2 hover:bg-surface-0/50`}
            onClick={props.onToggle}
            aria-label="Collapse panel"
          >
            <ChevronRightIcon class="w-3.5 h-3.5" />
          </button>
        </div>
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
                    <CodeTab terminalId={props.terminalId} meta={props.meta} />
                  ))
                  .exhaustive()}
              </div>
            );
          }}
        </For>
      </div>
    </aside>
  );
};

export default RightPanel;
