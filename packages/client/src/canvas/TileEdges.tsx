/** The tree, drawn. One SVG overlay behind the tiles that renders a curve from
 *  every parent tile to each of its children.
 *
 *  These edges are not decoration — they are the only place the canvas states
 *  the relationship that used to be implied by containment ("this terminal is a
 *  pane inside that one"). Now that a child is a first-class tile beside its
 *  parent, the arrow is what says whose it is.
 *
 *  Drawn in SCREEN space (`canvasToScreen`) rather than under a scaled
 *  transform, so the stroke stays one pixel and never turns into a hairline at
 *  low zoom. The overlay is inert (`pointer-events: none`) and sits below the
 *  tiles, so it can never intercept a drag, a click, or a wheel gesture. */

import { type Component, For } from "solid-js";
import { Z_CANVAS_EDGES } from "../ui/stackLayers";
import type { TileLayout } from "./TileLayout";
import { canvasToScreen } from "./viewport/coordinates";

export interface TileEdge {
  /** Stable key — the child's id (a child has exactly one parent). */
  id: string;
  from: TileLayout;
  to: TileLayout;
  /** Identity colour of the child's repo, matching its tile border. */
  color: string;
}

const TileEdges: Component<{
  edges: readonly TileEdge[];
  panX: () => number;
  panY: () => number;
  zoom: () => number;
}> = (props) => {
  /** Anchor on a box's mid-height, at the edge facing the other box: normally
   *  parent-right → child-left, but a child dragged to the LEFT of its parent
   *  gets the mirrored anchors so the curve never doubles back through the
   *  tiles it connects. */
  const path = (from: TileLayout, to: TileLayout): string => {
    const toRight = to.x >= from.x;
    const a = canvasToScreen(
      toRight ? from.x + from.w : from.x,
      from.y + from.h / 2,
      props.panX(),
      props.panY(),
      props.zoom(),
    );
    const b = canvasToScreen(
      toRight ? to.x : to.x + to.w,
      to.y + to.h / 2,
      props.panX(),
      props.panY(),
      props.zoom(),
    );
    // Horizontal control points: the curve leaves and enters sideways, so it
    // reads as "flows out of this tile into that one" rather than a straight
    // line across unrelated tiles.
    const bend = Math.max(24, Math.abs(b.x - a.x) / 2);
    const c1 = toRight ? a.x + bend : a.x - bend;
    const c2 = toRight ? b.x - bend : b.x + bend;
    return `M ${a.x} ${a.y} C ${c1} ${a.y}, ${c2} ${b.y}, ${b.x} ${b.y}`;
  };

  return (
    <svg
      class="absolute inset-0 w-full h-full pointer-events-none"
      style={{ "z-index": Z_CANVAS_EDGES }}
      data-testid="tile-edges"
      aria-hidden="true"
    >
      <title>Terminal tree connections</title>
      <For each={props.edges}>
        {(edge) => (
          <path
            data-edge={edge.id}
            d={path(edge.from, edge.to)}
            fill="none"
            stroke={edge.color}
            stroke-width="1.5"
            stroke-opacity="0.55"
          />
        )}
      </For>
    </svg>
  );
};

export default TileEdges;
