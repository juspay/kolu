/** RightPanelLayout — wraps a content area with a right panel that can be
 *  pinned (docked via Resizable) or unpinned (overlay with backdrop).
 *  Encapsulates the pin/unpin layout decision so callers don't duplicate it.
 *  On mobile viewports the right panel is disabled entirely — there's no
 *  toggle icon and the screen is too narrow for a useful side panel. */

import { type Component, type JSX, Show } from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import Resizable from "@corvu/resizable";
import RightPanel from "./RightPanel";
import { useRightPanel } from "./useRightPanel";
import { isMobile } from "../useMobile";
import type { TerminalMetadata } from "kolu-common";
import {
  TILE_BORDER_RADIUS_CLASS,
  FLOATING_SURFACE_SHADOW,
} from "../canvas/tileChrome";

const RightPanelLayout: Component<{
  children: JSX.Element;
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
  /** Extra class on the content wrapper (e.g. "flex flex-col" for Focus mode). */
  contentClass?: string;
}> = (props) => {
  const rightPanel = useRightPanel();
  const rightPanelProps = () => ({
    meta: props.meta,
    onToggle: rightPanel.togglePanel,
    themeName: props.themeName,
    onThemeClick: props.onThemeClick,
  });

  /** Whether the right panel should render (desktop only, not collapsed). */
  const showPanel = () => !isMobile() && !rightPanel.collapsed();

  return (
    <Show
      when={!isMobile() && rightPanel.pinned()}
      fallback={
        <div
          class={`flex-1 min-h-0 min-w-0 flex overflow-hidden relative ${props.contentClass ?? ""}`}
        >
          {props.children}
          {/* Overlay right panel — desktop + unpinned + expanded only */}
          <Show when={showPanel()}>
            <OverlayPanel
              onDismiss={() => rightPanel.collapsePanel()}
              rightPanelProps={rightPanelProps()}
            />
          </Show>
        </div>
      }
    >
      {/* Pinned: always render Resizable (even when collapsed — sizes=[1,0]).
       *  This keeps the handle in the DOM for e2e tests and allows the user
       *  to drag-expand without toggling via the button. */}
      <div class="flex-1 min-h-0 min-w-0 flex overflow-hidden">
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
          <Show when={!rightPanel.collapsed()}>
            <Resizable.Handle
              data-testid="right-panel-handle"
              class="shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors"
              aria-label="Resize inspector panel"
            />
          </Show>
          <Resizable.Panel
            as="div"
            class="min-w-0 min-h-0 overflow-hidden"
            minSize={0}
          >
            <Show when={!rightPanel.collapsed()}>
              <RightPanel {...rightPanelProps()} />
            </Show>
          </Resizable.Panel>
        </Resizable>
      </div>
    </Show>
  );
};

/** Overlay panel — separated so makeEventListener gets its own reactive owner
 *  (created by the parent Show). Escape dismisses the overlay. */
const OverlayPanel: Component<{
  onDismiss: () => void;
  rightPanelProps: {
    meta: TerminalMetadata | null;
    onToggle: () => void;
    themeName?: string;
    onThemeClick?: () => void;
  };
}> = (props) => {
  // Capture phase — intercept Escape before xterm's textarea handler swallows it
  makeEventListener(
    document,
    "keydown",
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onDismiss();
      }
    },
    { capture: true },
  );

  return (
    <>
      <div
        data-testid="right-panel-backdrop"
        class="absolute inset-0 bg-black/20 z-20"
        onClick={props.onDismiss}
      />
      {/* Overlay panel echoes canvas-tile chrome: rounded + the same
       *  shadow profile an active tile uses. Both visuals live in
       *  `canvas/tileChrome.ts` so a depth or radius tweak flows to
       *  both surfaces. The ml/my/mr inset gives the rounded corners
       *  breathing room from the viewport edges so they read as a
       *  floating window, not a sheet butting into the chrome. */}
      <div
        class={`absolute top-0 right-0 bottom-0 z-30 w-80 lg:w-96 my-2 mr-2 ${TILE_BORDER_RADIUS_CLASS} overflow-hidden`}
        style={{
          "max-width": "50%",
          "box-shadow": FLOATING_SURFACE_SHADOW,
        }}
      >
        <RightPanel {...props.rightPanelProps} />
      </div>
    </>
  );
};

export default RightPanelLayout;
