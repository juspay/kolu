/** CompanionTile — a welded canvas-peer panel attached to an anchor tile.
 *
 *  Renders one of `CompanionRef`'s kinds (code / inspector) inside a
 *  tile-shaped surface positioned by the anchor's effective bbox plus a
 *  side offset. Companions are not draggable and have no canvas
 *  coordinates of their own; the only direct interaction is resizing the
 *  seam between the anchor and the companion.
 *
 *  Phase 1 hard-codes the East side; the perpendicular dimension matches
 *  the anchor's height. The four-side layout machinery is in `types.ts`
 *  and `useCompanion.ts` for Phase 3 to fill in. */

import type { CodeTabView, TerminalMetadata } from "kolu-common/surface";
import { type Component, Match, Switch } from "solid-js";
import type { TileTheme } from "../canvas/CanvasTile";
import {
  tileChromeButton,
  tileFgTier,
  tileTitleBarBg,
  tileTitleBarBorder,
} from "../canvas/tileChrome";
import type { TileLayout } from "../canvas/TileLayout";
import CodeView from "../right-panel/CodeTab";
import MetadataInspector from "../right-panel/MetadataInspector";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import type { CompanionRef, Side } from "./types";

const COMPANION_LABEL: Record<CompanionRef["kind"], string> = {
  code: "Code",
  inspector: "Inspector",
};

const CompanionTile: Component<{
  anchorId: string;
  anchorLayout: TileLayout;
  side: Side;
  size: number;
  ref: CompanionRef;
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
  onClose: () => void;
  onSizeChange: (size: number) => void;
  /** Update the ref in place — used when the Code companion's sub-mode
   *  switches (browse / local / branch). Companion-store call site lives
   *  in TerminalCanvas; this prop is the renderer's only mutation seam. */
  onRefChange: (ref: CompanionRef) => void;
  /** Inherit the anchor's tile theme so the companion reads as the same
   *  surface, not a foreign panel. */
  theme: TileTheme;
  /** Anchor's repo accent — paints the companion's outer border so the
   *  weld reads as one structural unit per repo (#850 logic). */
  repoColor: string;
  /** Whether the anchor is the active tile. Mirrors the anchor's
   *  elevation (shadow + ring) so the welded pair reads as one unit. */
  active: boolean;
  /** Used to scale screen-space resize deltas into canvas-space. */
  zoom: () => number;
  /** When the anchor is maximized, the companion docks beside it as part
   *  of the maximized footprint — no absolute coordinates, no resize. */
  maximized?: boolean;
}> = (props) => {
  // E-side only in Phase 1: companion sits to the right of the anchor.
  const positionStyle = () => {
    if (props.maximized) return {};
    return {
      left: `${props.anchorLayout.x + props.anchorLayout.w}px`,
      top: `${props.anchorLayout.y}px`,
      width: `${props.size}px`,
      height: `${props.anchorLayout.h}px`,
    } as const;
  };

  function startSeamResize(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startSize = props.size;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      // Rightward delta grows the companion (anchor visually shrinks
      // because the canvas keeps the anchor's bbox fixed and the
      // companion just widens). Sign convention: rightward = grow.
      const dx = (ev.clientX - startX) / props.zoom();
      const next = Math.max(200, startSize + dx);
      props.onSizeChange(next);
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  const handleCodeModeChange = (mode: CodeTabView) => {
    props.onRefChange({ kind: "code", mode });
  };

  return (
    <div
      data-testid="companion-tile"
      data-companion-anchor={props.anchorId}
      data-companion-kind={props.ref.kind}
      data-companion-side={props.side}
      class="flex flex-col overflow-hidden border transition-shadow duration-200"
      classList={{
        absolute: !props.maximized,
        "rounded-xl": !props.maximized,
        "shadow-xl": props.active && !props.maximized,
      }}
      style={{
        ...positionStyle(),
        "background-color": props.theme.bg,
        "border-color": props.repoColor,
        "z-index": props.active ? 10 : 1,
        "box-shadow": props.active
          ? "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px var(--color-accent)"
          : "0 2px 8px rgba(0,0,0,0.2)",
      }}
    >
      {/* Title bar — same visual language as CanvasTile so the weld
       *  reads as a continuation. No drag activator: companions don't
       *  move on their own. */}
      <div
        data-testid="companion-titlebar"
        class="flex items-center gap-2 px-3 py-1.5 shrink-0 select-none text-[11px]"
        style={{
          "background-color": tileTitleBarBg(props.theme),
          "border-bottom": `1px solid ${tileTitleBarBorder(props.theme)}`,
          "--color-fg": tileFgTier(props.theme, 1),
          "--color-fg-2": tileFgTier(props.theme, 2),
          "--color-fg-3": tileFgTier(props.theme, 3),
        }}
      >
        <span class="font-medium" style={{ color: tileFgTier(props.theme, 1) }}>
          {COMPANION_LABEL[props.ref.kind]}
        </span>
        <div class="flex-1" />
        <button
          type="button"
          data-testid="companion-close"
          class={`${CHROME_ICON_BUTTON_CLASS} pointer-events-auto text-sm`}
          style={{ color: tileChromeButton(props.theme) }}
          onClick={props.onClose}
          title="Close companion"
        >
          ×
        </button>
      </div>

      {/* Body — discriminate on the ref kind. New kinds are added here
       *  as exhaustive Match arms so adding a CompanionRef variant
       *  fails compilation until the renderer is updated. */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <Switch>
          <Match when={props.ref.kind === "inspector"}>
            <MetadataInspector
              meta={props.meta}
              themeName={props.themeName}
              onThemeClick={props.onThemeClick}
            />
          </Match>
          <Match when={props.ref.kind === "code" ? props.ref : null}>
            {(codeRef) => (
              <CodeView
                meta={props.meta}
                mode={(codeRef() as { kind: "code"; mode: CodeTabView }).mode}
                onModeChange={handleCodeModeChange}
              />
            )}
          </Match>
        </Switch>
      </div>

      {/* Seam handle — a 4px-wide hit zone on the West edge that the user
       *  drags to resize the companion. Cursor change is the affordance.
       *  The handle straddles the seam (`-left-1`) so neither the anchor
       *  nor the companion gets a visible inset. */}
      <div
        data-testid="companion-seam"
        class="absolute inset-y-0 -left-1 w-2 cursor-col-resize hover:bg-accent/30 transition-colors"
        onPointerDown={startSeamResize}
      />
    </div>
  );
};

export default CompanionTile;
