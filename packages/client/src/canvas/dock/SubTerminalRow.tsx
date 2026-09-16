/** kolu's wiring for a SPLIT terminal's row in the Dock.
 *
 *  A split renders the same `@kolu/solid-dockrow` two-line row its parent does —
 *  same indicator, same annotation, same status words, same recency, same model
 *  tag — with two facts of its own: it hangs under a parent (so it carries
 *  `parentId` + `depth`, and the row draws the `└` and steps its text block in),
 *  and it has no display identity. That second one is why this module still
 *  assembles its own props instead of reusing `useDockRowBag`: `getDisplayInfo`
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
import { cwdBasename } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import { annotationLine } from "../../intent/text";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import type { RankedDockRow } from "./dockRowRanking";
import { renderRowLabel } from "./renderRowLabel";
import { useRowRecency } from "./rowRecency";

export const SubTerminalRow: Component<{
  row: RankedDockRow["subRows"][number];
  onSelect: (id: TerminalId) => void;
  surface: DockRowSurface;
}> = (props) => {
  const store = useTerminalStore();
  const rowRecency = useRowRecency();
  const meta = () => store.getMetadata(props.row.id);
  const unread = () => store.isUnread(props.row.id);
  return (
    <Show when={meta()}>
      {(m) => {
        const parentId = m().parentId;
        if (!parentId) {
          throw new Error(
            `SubTerminalRow: ${props.row.id} has no parent terminal`,
          );
        }
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
            pip={pip()}
            bucket={props.row.bucket}
            agentState={facts().agentState}
            model={facts().model}
            parentId={parentId}
            depth={props.row.depth}
            active={isActiveRow(props.row.id)}
            label={annotationLine(m().intent, cwdBasename(m().cwd))}
            // No ink: a split's label is a directory, not a branch, and it has
            // no display identity of its own to colour.
            labelColor={undefined}
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
