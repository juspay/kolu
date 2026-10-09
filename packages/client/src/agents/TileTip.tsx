/** The tip inside a tile's terminal body: what to do next in THIS terminal —
 *  `cd` into a repo, launch an agent, try a skill at the agent's first prompt.
 *  The choice and its anchor are `terminalTip`'s; this component feeds it the
 *  terminal's facts and how the pane is drawn, and paints its answer as ghost
 *  text in the terminal's own font: on the prompt line after the cursor, or
 *  top-right. Nothing is remembered: the tip is there while its state holds and
 *  it can be seen, and gone otherwise. Only a live terminal has one, and only
 *  where the ambient tips show at all (`showsAmbientTips`).
 *
 *  It never takes input (`pointer-events: none`) and never changes the grid:
 *  it is painted over the pane, below the find bar. */

import { activeArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, type Component, createMemo, Show } from "solid-js";
import { showsAmbientTips } from "../capabilities";
import type { PaneGrid, PaneView } from "../terminal/paneView";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { PLUGIN_SKILLS } from "./pluginSkills";
import {
  quiet,
  type TerminalTip,
  type TipAnchor,
  terminalTip,
} from "./terminalTip";
import { agentDistroListing } from "./useAgentDistro";

/** Below the find bar (`z-10`) and the scroll-to-bottom button. */
const Z_TILE_TIP = 5;

/** Same answer: same tip, same words, same place. Any two quiets are the same:
 *  nothing renders. */
function sameTip(a: TerminalTip, b: TerminalTip): boolean {
  switch (a.kind) {
    case "tip":
      return (
        b.kind === "tip" &&
        a.id === b.id &&
        a.text === b.text &&
        a.anchor === b.anchor
      );
    case "quiet":
      return b.kind === "quiet";
    default:
      throw new Error(`sameTip: unhandled kind ${a satisfies never}`);
  }
}

/** Empty cells from one cell right of the cursor to the grid's right edge. */
function promptCells(grid: PaneGrid | null): number | null {
  if (grid === null || grid.cursor === null) return null;
  return Math.max(0, grid.cols - grid.cursor.col - 1);
}

/** Where the tip paints within the pane, in layout px: a box one row tall. */
function box(
  grid: PaneGrid,
  anchor: TipAnchor,
): { left: number; top: number; width: number; align: "left" | "right" } {
  switch (anchor) {
    case "prompt": {
      // The fold only answers `prompt` with the cursor in view.
      const cursor = grid.cursor;
      if (cursor === null)
        throw new Error("TileTip: a prompt tip with no cursor in view");
      return {
        left: grid.originX + (cursor.col + 1) * grid.cellW,
        top: grid.originY + cursor.row * grid.cellH,
        width: (grid.cols - cursor.col - 1) * grid.cellW,
        align: "left",
      };
    }
    case "top-right":
      // Inset one cell from the top and right edges.
      return {
        left: grid.originX + grid.cellW,
        top: grid.originY + grid.cellH,
        width: (grid.cols - 2) * grid.cellW,
        align: "right",
      };
    default:
      throw new Error(`TileTip: unhandled anchor ${anchor satisfies never}`);
  }
}

const TileTip: Component<{
  id: TerminalId;
  /** How the pane is drawn (the terminal builds it; see `trackPaneView`). */
  view: PaneView;
  /** The terminal's find bar is open. */
  findOpen: Accessor<boolean>;
  /** The terminal's font, so the tip reads as part of the screen. */
  fontFamily: string;
  fontSize: Accessor<number>;
  /** The theme's muted foreground (its `brightBlack`). */
  color: Accessor<string>;
}> = (props) => {
  const store = useTerminalStore();

  const answer = createMemo(
    (): TerminalTip => {
      if (!showsAmbientTips()) return quiet("tips are not shown here");
      const m = activeArm(store.getMetadata(props.id));
      if (m === undefined) return quiet("not a live terminal");
      const grid = props.view.grid();
      return terminalTip({
        place: {
          active: store.activeId() === props.id,
          onScreen: props.view.onScreen(),
          cellPx: grid === null ? null : grid.cellH * props.view.scale(),
          findOpen: props.findOpen(),
          promptCells: promptCells(grid),
        },
        git: m.git,
        foreground: m.foreground,
        agent: m.agent,
        promptedAt: m.promptedAt,
        agents: m.agents,
        listing: agentDistroListing(),
        skills: PLUGIN_SKILLS,
      });
    },
    quiet("not computed yet"),
    { equals: sameTip },
  );

  const shown = () => {
    const a = answer();
    const grid = props.view.grid();
    return a.kind === "tip" && grid !== null ? { tip: a, grid } : undefined;
  };

  return (
    <Show when={shown()}>
      {(s) => {
        const b = () => box(s().grid, s().tip.anchor);
        return (
          <div
            data-testid="tile-tip"
            data-tip-id={s().tip.id}
            data-tip-anchor={s().tip.anchor}
            role="status"
            class="absolute pointer-events-none select-none overflow-hidden text-ellipsis whitespace-pre"
            style={{
              "z-index": Z_TILE_TIP,
              left: `${b().left}px`,
              top: `${b().top}px`,
              width: `${b().width}px`,
              height: `${s().grid.cellH}px`,
              "line-height": `${s().grid.cellH}px`,
              "text-align": b().align,
              "font-family": props.fontFamily,
              "font-size": `${props.fontSize()}px`,
              color: props.color(),
            }}
          >
            {s().tip.text}
          </div>
        );
      }}
    </Show>
  );
};

export default TileTip;
