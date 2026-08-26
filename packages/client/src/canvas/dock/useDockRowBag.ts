/** The nine props a dock row takes that BOTH kolu surfaces answer identically —
 *  assembled once.
 *
 *  `Dock.tsx` and `DockList.tsx` are one component now, but their CALL SITES had
 *  become the new copy: the same `useStatePip` block and the same nine prop
 *  bindings, byte for byte, in two files with nothing holding them together.
 *  That is the duplication the extraction set out to kill, moved rather than
 *  removed — and this file exists because a comment in `Dock.tsx` claimed
 *  otherwise ("there is now nothing to keep in step") while the copy sat twenty
 *  lines below it.
 *
 *  What is assembled here is exactly what the two surfaces agree on. What stays
 *  at each call site is what they genuinely differ by: the surface token, the
 *  landing verb (`tileStore.activate` centres the tile on the canvas; the drawer
 *  focuses silently and dismisses itself), the e2e handles, the desktop-only ⌘N
 *  overlay, and the touch-only pointer trap. Those are five real differences and
 *  they read as five, instead of hiding among nine agreements.
 *
 *  Three of the nine come from `dockRowFacts` — the row package's own fused read
 *  of one terminal record — so a row's words and its PR cannot come from two
 *  different terminals. */

import { dockRowFacts } from "@kolu/solid-dockrow/rowValues";
import type { DockRowProps } from "@kolu/solid-dockrow";
import type { TerminalId } from "kolu-common/surface";
import { annotationLine } from "../../intent/text";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import { type DockRowBucket, rowRecencyAt } from "./dockRowRanking";
import { renderRowLabel } from "./renderRowLabel";
import { useRowRecency } from "./rowRecency";

/** The subset of `DockRowProps` both surfaces answer the same way. */
export type SharedDockRowProps = Pick<
  DockRowProps,
  | "id"
  | "pip"
  | "bucket"
  | "agentState"
  | "active"
  | "label"
  | "labelColor"
  | "renderLabel"
  | "subline"
  | "pr"
  | "recency"
>;

/** Build the shared half of a row's props. Call from a component body — it
 *  reads the terminal store, the attention mirror and the tile registry, and
 *  owns the `useStatePip` memo so neither call site spells it. */
export function useDockRowBag(): (input: {
  id: TerminalId;
  /** The live record and its slow display projection, already paired. */
  combined: { info: TerminalDisplayInfo; meta: TerminalMetadata };
  /** The ORDER bucket — `data-bucket`. */
  bucket: DockRowBucket;
  /** The PIP bucket the dock's ranking pass already computed. */
  pipBucket: DockRowBucket;
  /** Newest activity in the whole tile, including its splits. */
  recencyAt: number | null;
}) => SharedDockRowProps {
  const store = useTerminalStore();
  const rowRecency = useRowRecency();
  return (input) => {
    const unread = () => store.isUnread(input.id);
    const pip = useStatePip(
      encActiveHost,
      () => input.id,
      () => input.combined.meta,
      unread,
      () => input.pipBucket,
    );
    const facts = dockRowFacts(input.combined.meta);
    return {
      id: input.id,
      pip: pip(),
      bucket: input.bucket,
      agentState: facts.agentState,
      active: isActiveRow(input.id),
      label: annotationLine(
        input.combined.meta.intent,
        input.combined.info.key.label,
      ),
      labelColor: input.combined.info.annotationColor,
      renderLabel: renderRowLabel,
      subline: facts.subline,
      pr: facts.pr,
      recency: rowRecency(
        pip(),
        input.recencyAt,
        rowRecencyAt(input.combined.meta),
      ),
    };
  };
}
