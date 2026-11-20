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
  tileId: TerminalId;
  onSelect: (id: TerminalId) => void;
  surface: DockRowSurface;
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
        const pip = useStatePip(
          encActiveHost,
          () => props.row.id,
          m,
          unread,
          () => props.row.pip,
        );
        const facts = createMemo(() => dockRowFacts(m()));
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
            parentId={props.row.parentId}
            depth={props.row.depth}
            active={isActiveRow(props.row.id)}
            label={dockRowLabel(m(), undefined)}
            labelColor={tile()?.info.annotationColor}
            renderLabel={renderRowLabel}
            subline={facts().subline}
            pr={null}
            recency={recency()}
            onSelect={() => props.onSelect(props.row.id)}
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
