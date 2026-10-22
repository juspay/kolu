/** kolu's wiring for a SPLIT terminal's row in the Dock.
 *
 *  A split renders the same `@kolu/solid-dockrow` two-line row its parent does —
 *  same indicator, same annotation, same status words, same recency, same model
 *  tag — with two facts of its own: it hangs under a parent (so it carries
 *  `parentId` + `depth` from the pane tree it was ranked out of, and the row
 *  draws the `└` and steps its text block in), and it has no display identity.
 *  That second one is why this module still assembles its own props instead of
 *  reusing `useDockRowBag`: `getDisplayInfo`
 *  is keyed on TOP-LEVEL tiles, so a split has no repo key, no branch and no
 *  annotation ink — its label is the cwd basename and its PR is nothing (the
 *  parent's row above already badges the repo's).
 *
 *  One component serves desktop and touch: only the tap padding differs, which
 *  the surface token already carries. */

import { DockRow } from "@kolu/solid-dockrow";
import {
  dockRowFacts,
  type DockRowSurface,
} from "@kolu/solid-dockrow/rowValues";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import { createDockRowData, dockRowLabel } from "./dockRowData";
import type { RankedDockRow } from "./dockRowRanking";
import { renderRowLabel } from "./renderRowLabel";
import { useRowRecency } from "./rowRecency";
import type { DockRowDrag } from "./useDockRowDrag";

export const SubTerminalRow: Component<{
  row: RankedDockRow["subRows"][number];
  /** The TILE this split belongs to. A split has no display identity of its
   *  own — `getDisplayInfo` is keyed on top-level tiles — so its annotation ink
   *  comes from the tile, the same `{tile, blocked}` pairing the needs-you strip
   *  carries. */
  tileId: TerminalId;
  onSelect: (id: TerminalId) => void;
  surface: DockRowSurface;
  /** The row's drag sockets, when the surface HAS a drag context — the desktop
   *  dock's rows are draggable and droppable (nest a split deeper, hand it its
   *  own tile); the touch drawer renders this row bare. Absent is the honest
   *  "this surface has no drag", which is exactly how the package's row treats
   *  a missing `handle`: no grip at all, not a dead one. */
  drag?: DockRowDrag;
}> = (props) => {
  const store = useTerminalStore();
  const rowRecency = useRowRecency();
  const tile = createDockRowData(props.tileId);
  const meta = () => store.getMetadata(props.row.id);
  const unread = () => store.isUnread(props.row.id);
  return (
    <Show when={meta()}>
      {(m) => {
        // Same unconditional binder as DockRow / DockListRow — one fold for
        // "what does this row's leading indicator show", kind never re-gates it.
        // Unread passthrough matters when an agent exits while still unread: the
        // row re-ranks as a shell but the amber badge must survive until the
        // user lands.
        const pip = useStatePip(
          encActiveHost,
          () => props.row.id,
          m,
          unread,
          () => props.row.pip,
        );
        // The same fused read the two-line row uses — `agentState`, the model
        // and the status words come off ONE record, so a split's words and its
        // model cannot come from two different terminals either. The `pr` it
        // also derives is deliberately dropped below (a split badges nothing).
        const facts = createMemo(() => dockRowFacts(m()));
        // The split's OWN recency on both channels. `ts` in the ranking fold IS
        // `rowRecencyAt(meta)` — a split has no wider window than itself, and
        // the tile-wide fold is the parent's line, already rendered above it.
        const recency = createMemo(() =>
          rowRecency(pip(), { window: props.row.ts, own: props.row.ts }),
        );
        return (
          <DockRow
            id={props.row.id}
            surface={props.surface}
            // A function ref, not `props.drag?.ref`: the JSX transform lowers a
            // MEMBER-expression ref to an assignment and cannot read through an
            // optional chain.
            ref={(el) => props.drag?.ref(el)}
            handle={props.drag?.handle}
            drop={props.drag?.drop}
            pip={pip()}
            bucket={props.row.bucket}
            agentState={facts().agentState}
            model={facts().model}
            // The TRUE parent, straight off the pane tree this row was built
            // out of (see `SubDockRow.parentId`) — the dock's nesting and this
            // attribute are one fact, so a row can never render under a parent
            // its own metadata has not caught up with yet.
            parentId={props.row.parentId}
            depth={props.row.depth}
            active={isActiveRow(props.row.id)}
            // A split has no display identity of its own: the shared fold falls
            // back to the working directory's basename (see `dockRowLabel`).
            label={dockRowLabel(m(), undefined)}
            // The tile's branch ink: a split's label is a directory, but it
            // lives in the same worktree as the row above it, and sharing the
            // hue is what keeps the label column reading as one family. Falls
            // back to the dock's quiet ink when the display projection has not
            // arrived (`DockRow` owns that fallback).
            labelColor={tile()?.info.annotationColor}
            renderLabel={renderRowLabel}
            subline={facts().subline}
            pr={null}
            recency={recency()}
            onSelect={() => props.onSelect(props.row.id)}
            // The Corvu drawer's drag-to-dismiss would otherwise claim the tap
            // (a no-op in the rail, load-bearing in the phone drawer).
            onPointerDown={
              props.surface === "touch"
                ? (event) => event.stopPropagation()
                : undefined
            }
            testIds={{
              row: "dock-sub-row",
              agentSubline: "dock-sub-agent-subline",
              quietSubline: "dock-sub-foreground",
            }}
            title="Jump to this split"
          />
        );
      }}
    </Show>
  );
};
