import { Key } from "@solid-primitives/keyed";

import { activeArm } from "@kolu/padi-client/surface";
import { DockNeedsYouRow, DockNeedsYouStrip } from "@kolu/solid-dockrow";
import type { NeedsYouDensity } from "@kolu/solid-dockrow/rowValues";
import { DASH, type TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import { renderRowLabel } from "./renderRowLabel";
import { createDockRowData, dockRowLabel } from "./dockRowData";
import { rowRecencyAt } from "./dockRowRanking";
import type { DockNeedsYouEntry } from "./dockTree";
import { useRowRecency } from "./rowRecency";

export type { NeedsYouDensity };

const NeedsYouEntryRow: Component<{
  entry: DockNeedsYouEntry;
  density: NeedsYouDensity;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const tileData = createDockRowData(props.entry.tile.id);
  const blockedMeta = () => store.getMetadata(props.entry.blocked.id);
  const unread = () => store.isUnread(props.entry.blocked.id);
  const combined = createMemo(() => {
    const tile = tileData();
    const blocked = blockedMeta();
    return tile && blocked ? { tile, blocked } : null;
  });
  const rowRecency = useRowRecency();
  return (
    <Show when={combined()}>
      {(c) => {
        const pip = useStatePip(
          encActiveHost,
          () => props.entry.blocked.id,
          () => c().blocked,
          unread,
          () => props.entry.blocked.pip,
        );
        const recency = createMemo(() =>
          rowRecency(pip(), {
            window: props.entry.tile.ts,
            own: rowRecencyAt(c().blocked),
          }),
        );
        const title = () => {
          const where = `${c().tile.info.key.group} · ${c().tile.info.key.label}`;
          const hidden = props.entry.hiddenByFilter
            ? " (hidden by the dock filters)"
            : "";
          if (props.density !== "icon") {
            return `${where} — waiting on you${hidden}`;
          }
          const r = recency();
          const d = r.mode === "hidden" ? "" : r.text;
          const wait = d && d !== DASH ? ` for ${d}` : "";
          return `${where} — waiting on you${wait}${hidden}`;
        };
        return (
          <DockNeedsYouRow
            id={props.entry.blocked.id}
            tileId={props.entry.tile.id}
            density={props.density}
            pip={pip()}
            bucket={props.entry.blocked.bucket}
            agentState={activeArm(c().blocked)?.agent?.state}
            active={isActiveRow(props.entry.blocked.id)}
            label={dockRowLabel(c().tile.meta, c().tile.info)}
            labelColor={c().tile.info.annotationColor}
            renderLabel={renderRowLabel}
            recency={recency()}
            title={title()}
            hiddenByFilter={props.entry.hiddenByFilter}
            onSelect={() => props.onSelect(props.entry.blocked.id)}
            testId="dock-needs-you-entry"
          />
        );
      }}
    </Show>
  );
};

export const NeedsYouStrip: Component<{
  entries: readonly DockNeedsYouEntry[];
  density: NeedsYouDensity;
  onSelect: (id: TerminalId) => void;
}> = (props) => (
  <Show when={props.entries.length > 0}>
    <DockNeedsYouStrip density={props.density} testId="dock-needs-you-strip">
      <Key each={props.entries} by={(entry) => entry.blocked.id}>
        {(entry) => (
          <NeedsYouEntryRow
            entry={entry()}
            density={props.density}
            onSelect={props.onSelect}
          />
        )}
      </Key>
    </DockNeedsYouStrip>
  </Show>
);
