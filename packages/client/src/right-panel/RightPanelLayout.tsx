/** RightPanelLayout — picks the host that surfaces the right panel.
 *
 *  Two hosts, one content subtree:
 *  - Desktop (`DesktopHost`): `@corvu/resizable` horizontal split owns
 *    width and visibility (collapsed → `sizes=[1,0]`). On top of that
 *    split, the right `Resizable.Panel` mirrors the dock's posture
 *    pairing via classList — in maximized mode it sits in the flex flow
 *    as a flush right sidebar with a hard separator; in tiled mode it
 *    floats over the canvas grid as a rounded card while the canvas
 *    `Resizable.Panel` claims the full container width. Keeping the
 *    Resizable shell across both postures preserves master's stable
 *    interaction surface (xterm-link click handling depends on the
 *    flush-mounted sibling layout) — only the visual chrome flips.
 *  - Mobile (`MobileDrawerHost`): `@corvu/drawer side="bottom"`. Visibility
 *    is the session-local `useRightPanel.drawerOpen()` signal — dismissing
 *    the drawer on a phone is not the same volatility as toggling the
 *    desktop chrome preference (see `useRightPanel.ts` header).
 *
 *  Each host owns its own response to `pendingOpen` (the producer signal
 *  seeded by `openInCodeTab`): desktop calls `expandPanel`, mobile calls
 *  `setDrawerOpen(true)`. Splitting into sibling components makes
 *  `isMobile()` the *only* platform-dispatch site, instead of leaking it
 *  into a `createEffect(on(pendingOpen, …))` body where SolidJS would also
 *  track it implicitly as a reactive read.
 *
 *  Selection, mode, and tab kind share `useRightPanel` across hosts — a
 *  phone session that ends on `foo.html` reopens on desktop with
 *  `foo.html` already selected. */

import Drawer from "@corvu/drawer";
import Resizable from "@corvu/resizable";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, createEffect, type JSX, on, Show } from "solid-js";
import {
  POSTURED_MAXIMIZED_FLUSH,
  POSTURED_TILED_FLOAT,
} from "../canvas/posturedSurfaceChrome";
import { useViewPosture } from "../canvas/useViewPosture";
import { capturePointerGesture } from "../canvas/viewport/capturePointerGesture";
import { isMobile } from "../useMobile";
import { pendingOpen } from "./openInCodeTab";
import RightPanel from "./RightPanel";
import { useRightPanel } from "./useRightPanel";

type HostProps = {
  children: JSX.Element;
  /** Active terminal id. Used by the Code tab's iframe-preview path to
   *  build the per-terminal file-serving URL. */
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
  /** Extra class on the content wrapper (e.g. "flex flex-col" for Focus mode). */
  contentClass?: string;
};

const DesktopHost: Component<HostProps> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  // Ref on the outer wrapper — read on tiled-mode pointerdown to
  // convert pixel deltas to the persisted `panelSize` fraction. The
  // Resizable shell owns this conversion in maximized mode; tiled mode
  // can't reuse its `Resizable.Handle` because the floating panel is
  // lifted out of flex flow (the handle would visually land at the
  // canvas's right edge, not the floating card's left edge).
  let layoutEl: HTMLDivElement | undefined;
  let abortTiledResize: AbortController | null = null;

  // Producer arrivals (terminal `path:line` taps, comments-tray jumps)
  // uncollapse the side panel — visibility used to live inside
  // `openCodeAt`, but moving it here keeps the hook platform-free.
  createEffect(
    on(
      pendingOpen,
      (req) => {
        if (!req) return;
        if (rightPanel.collapsed()) rightPanel.expandPanel();
      },
      { defer: true },
    ),
  );

  const onTiledResizeStart = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (!layoutEl) return;
    const cw = layoutEl.getBoundingClientRect().width;
    if (cw <= 0) return;
    const startX = e.clientX;
    const startSize = rightPanel.panelSize();
    abortTiledResize?.abort();
    abortTiledResize = new AbortController();
    capturePointerGesture(
      {
        onMove: (ev) => {
          // Pointer moves left → delta positive → panel grows. Matches the
          // tiled card's anchor (`right-4`): pulling the left edge leftward
          // widens the card while its right edge stays pinned.
          const delta = (startX - ev.clientX) / cw;
          rightPanel.setPanelSize(startSize + delta);
        },
        onEnd: () => {
          abortTiledResize = null;
        },
      },
      abortTiledResize,
    );
  };

  return (
    <div
      ref={(el) => {
        layoutEl = el;
      }}
      class="flex-1 min-h-0 min-w-0 flex overflow-hidden relative"
    >
      <Resizable
        orientation="horizontal"
        sizes={
          rightPanel.collapsed()
            ? [1, 0]
            : [1 - rightPanel.panelSize(), rightPanel.panelSize()]
        }
        onSizesChange={(sizes) => {
          if (sizes[1] !== undefined) rightPanel.setPanelSize(sizes[1]);
        }}
        class="flex-1 min-h-0 overflow-hidden"
      >
        <Resizable.Panel
          as="div"
          class={`min-w-0 min-h-0 flex ${props.contentClass ?? ""}`}
          minSize={0.3}
        >
          {props.children}
        </Resizable.Panel>
        {/* Resizable.Handle drives drag in maximized mode (the flex
         *  split where it visually lands between canvas and panel). In
         *  tiled mode the floating card is absolutely positioned, so
         *  the Resizable's flex-flow handle would land at the canvas's
         *  right edge instead of the card's left edge — tiled mode
         *  gets its own pointer handle anchored to the panel's left
         *  edge below. Same `data-testid="right-panel-handle"` so the
         *  attached-handle e2e assertion finds whichever is mounted. */}
        <Show when={!rightPanel.collapsed() && posture.maximized()}>
          <Resizable.Handle
            data-testid="right-panel-handle"
            class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
            aria-label="Resize inspector panel"
          />
        </Show>
        <Resizable.Panel
          as="div"
          data-testid="right-panel-shell"
          data-maximized={posture.maximized() ? "" : undefined}
          data-collapsed={rightPanel.collapsed() ? "" : undefined}
          class="min-w-0 min-h-0 overflow-hidden"
          classList={{
            // Tiled + expanded: lift the panel out of flex flow as a
            // floating rounded card over the canvas grid, anchored
            // top-right. Mirrors the dock's tiled-mode treatment on the
            // opposite edge — both surfaces share `POSTURED_TILED_FLOAT`
            // so a chrome-bar height change ripples through one
            // constant. Vertical extent diverges intentionally: the
            // dock uses `max-h-[calc(100vh-22rem)]` (shrink-to-content
            // for finite row lists), the panel uses `bottom-4` because
            // the Code tab's file tree benefits from every pixel.
            [`${POSTURED_TILED_FLOAT} right-4 bottom-4`]:
              !posture.maximized() && !rightPanel.collapsed(),
            // Maximized + expanded: flush right sidebar with a hard
            // left separator. Canvas reflows into the remaining width
            // via Resizable's flex split.
            [`${POSTURED_MAXIMIZED_FLUSH} border-l border-edge`]:
              posture.maximized() && !rightPanel.collapsed(),
          }}
          // Tiled mode lifts the panel out of flex flow, so its flex-basis
          // (which Resizable manages) no longer drives the visible width.
          // Re-derive an explicit pixel-percentage width from `panelSize`
          // so the floating card still reflects the persisted fraction.
          style={
            !posture.maximized() && !rightPanel.collapsed()
              ? { width: `${rightPanel.panelSize() * 100}%` }
              : undefined
          }
          minSize={0}
        >
          {/* Tiled-mode drag handle — anchored to the floating card's
           *  left edge with a `cursor-col-resize` hit zone that extends
           *  slightly outside the card so the pointer target isn't
           *  flush with the rounded corner. Writes through to the
           *  same `setPanelSize` Resizable's `onSizesChange` does. */}
          <Show when={!posture.maximized() && !rightPanel.collapsed()}>
            <div
              data-testid="right-panel-handle"
              title="Resize inspector panel"
              class="absolute top-0 bottom-0 left-0 w-1.5 z-10 cursor-col-resize hover:bg-accent/30 transition-colors"
              onPointerDown={onTiledResizeStart}
            />
          </Show>
          {/* Render unconditionally so CodeTab's selectedPath signal and
           *  Pierre's tree expansion survive collapse — Resizable already
           *  shrinks this panel to zero width via sizes=[1,0] above. An
           *  inner <Show> would unmount and discard that state. */}
          <RightPanel
            terminalId={props.terminalId}
            meta={props.meta}
            onToggle={rightPanel.togglePanel}
            themeName={props.themeName}
            onThemeClick={props.onThemeClick}
            visible={!rightPanel.collapsed()}
          />
        </Resizable.Panel>
      </Resizable>
    </div>
  );
};

const MobileDrawerHost: Component<HostProps> = (props) => {
  const rightPanel = useRightPanel();

  // Producer arrivals open the drawer. Setter is idempotent so repeated
  // taps on the same `path:line` don't fire spurious open transitions.
  createEffect(
    on(
      pendingOpen,
      (req) => {
        if (!req) return;
        rightPanel.setDrawerOpen(true);
      },
      { defer: true },
    ),
  );

  return (
    <>
      <div
        class={`flex-1 min-h-0 min-w-0 flex overflow-hidden ${props.contentClass ?? ""}`}
      >
        {props.children}
      </div>
      <Drawer
        side="bottom"
        open={rightPanel.drawerOpen()}
        onOpenChange={rightPanel.setDrawerOpen}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            data-testid="right-panel-drawer-backdrop"
            class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
          />
          <Drawer.Content class="fixed bottom-0 left-0 right-0 z-50 bg-surface-0 border-t border-edge shadow-xl h-[85vh] flex flex-col rounded-t-lg overflow-hidden">
            <div class="flex justify-center py-1.5 shrink-0" aria-hidden="true">
              <span class="w-10 h-1 rounded-full bg-fg-3/40" />
            </div>
            <div class="flex-1 min-h-0 overflow-hidden">
              <RightPanel
                terminalId={props.terminalId}
                meta={props.meta}
                onToggle={() => rightPanel.setDrawerOpen(false)}
                themeName={props.themeName}
                onThemeClick={props.onThemeClick}
                visible={rightPanel.drawerOpen()}
              />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  );
};

const RightPanelLayout: Component<HostProps> = (props) => {
  // The single platform-dispatch site. Each branch is its own component
  // so reactive ownership (effects, derived signals) sits inside the
  // active host only — switching viewports tears down the inactive
  // host's effects cleanly.
  return (
    <Show when={!isMobile()} fallback={<MobileDrawerHost {...props} />}>
      <DesktopHost {...props} />
    </Show>
  );
};

export default RightPanelLayout;
