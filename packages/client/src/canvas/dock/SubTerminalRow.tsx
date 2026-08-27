/** kolu's wiring for `@kolu/solid-dockrow`'s split row — the indented entry a
 *  split terminal gets beneath the row for its real parent.
 *
 *  Everything visible about the row is the package's (the indent step, the `└`,
 *  the pip, the label, the shared `[data-dock-row]` contract). What is HERE is
 *  what only this app can answer: the terminal store, the attention mirror the
 *  pip binds off, and which tile is active. One component serves desktop and
 *  touch because the row has no shortcut hint, PR link, or drawer gesture of its
 *  own — only its tap padding differs.
 *
 *  A split has no display identity of its own (`getDisplayInfo` is keyed on
 *  top-level tiles), so its label falls back to the cwd basename rather than a
 *  branch — the same reason the needs-you strip carries a tile beside its
 *  blocked row. */

import { activeArm } from "@kolu/padi-client/surface";
import { DockSubRow } from "@kolu/solid-dockrow";
import type { DockRowSurface } from "@kolu/solid-dockrow/rowValues";
import { cwdBasename } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { annotationLine } from "../../intent/text";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import { renderRowLabel } from "./renderRowLabel";
import type { RankedDockRow } from "./dockRowRanking";

export const SubTerminalRow: Component<{
  row: RankedDockRow["subRows"][number];
  onSelect: (id: TerminalId) => void;
  surface: DockRowSurface;
}> = (props) => {
  const store = useTerminalStore();
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
        return (
          <DockSubRow
            id={props.row.id}
            parentId={parentId}
            depth={props.row.depth}
            surface={props.surface}
            pip={pip()}
            bucket={props.row.bucket}
            agentState={activeArm(m())?.agent?.state}
            active={isActiveRow(props.row.id)}
            label={annotationLine(m().intent, cwdBasename(m().cwd))}
            renderLabel={renderRowLabel}
            onSelect={() => props.onSelect(props.row.id)}
            // The Corvu drawer's drag-to-dismiss would otherwise claim the tap
            // (a no-op in the rail, load-bearing in the phone drawer).
            onPointerDown={
              props.surface === "touch"
                ? (event) => event.stopPropagation()
                : undefined
            }
            testId="dock-sub-row"
            title="Jump to this split"
          />
        );
      }}
    </Show>
  );
};
