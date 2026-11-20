import type { TerminalMetadata } from "@kolu/padi-client/vocab";
import type { DockRowProps } from "@kolu/solid-dockrow";
import { dockRowFacts } from "@kolu/solid-dockrow/rowValues";
import type { TerminalId } from "kolu-common/surface";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { type Accessor, createMemo } from "solid-js";
import WorkMark from "../../conductor/WorkMark";
import { useStatePip } from "../../terminal/statePipBind";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import { dockRowLabel } from "./dockRowData";
import { type DockRowBucket, rowRecencyAt } from "./dockRowRanking";
import { renderRowLabel } from "./renderRowLabel";
import { useRowRecency } from "./rowRecency";

export type SharedDockRowProps = Pick<
  DockRowProps,
  | "id"
  | "pip"
  | "bucket"
  | "agentState"
  | "model"
  | "active"
  | "label"
  | "labelColor"
  | "renderLabel"
  | "subline"
  | "pr"
  | "recency"
>;

export function useDockRowBag(): (input: {
  id: TerminalId;
  combined: Accessor<{ info: TerminalDisplayInfo; meta: TerminalMetadata }>;
  bucket: Accessor<DockRowBucket>;
  pipBucket: Accessor<DockRowBucket>;
  recencyAt: Accessor<number | null>;
}) => SharedDockRowProps {
  const store = useTerminalStore();
  const rowRecency = useRowRecency();
  return (input) => {
    const pip = useStatePip(
      encActiveHost,
      () => input.id,
      () => input.combined().meta,
      () => store.isUnread(input.id),
      input.pipBucket,
    );
    const facts = createMemo(() => dockRowFacts(input.combined().meta));
    const recency = createMemo(() =>
      rowRecency(pip(), {
        window: input.recencyAt(),
        own: rowRecencyAt(input.combined().meta),
      }),
    );
    return {
      id: input.id,
      get pip() {
        return pip();
      },
      get bucket() {
        return input.bucket();
      },
      get agentState() {
        return facts().agentState;
      },
      get model() {
        return facts().model;
      },
      get active() {
        return isActiveRow(input.id);
      },
      get label() {
        const c = input.combined();
        return dockRowLabel(c.meta, c.info);
      },
      get labelColor() {
        return input.combined().info.annotationColor;
      },
      renderLabel: (markdown) => (
        <span class="flex min-w-0 items-center gap-1.5">
          <span data-testid="dock-row-name" class="min-w-0 truncate">
            {renderRowLabel(markdown)}
          </span>
          <WorkMark terminal={fleetTerminalRef(encActiveHost(), input.id)} />
        </span>
      ),
      get subline() {
        return facts().subline;
      },
      get pr() {
        return facts().pr;
      },
      get recency() {
        return recency();
      },
    };
  };
}
