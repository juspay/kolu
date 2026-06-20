/** Project a sleeping record into the `{ meta, info }` a dock row reads — the
 *  SAME shape a live terminal yields, so a sleeping tile flows through the same
 *  rank → group → render pipeline (no separate "Sleeping" section, the wart the
 *  re-plan killed).
 *
 *  The meta is the record's top `SavedTerminal` with the three live fields
 *  (`pr` · `agent` · `foreground`) at their resting "nothing live" values. The
 *  display info reuses `buildTerminalDisplayInfos` over the single record, so
 *  the row groups under its repo and gets a key exactly like a live tile.
 *
 *  Colour is computed standalone (one record), so the GROUP colour the section
 *  paints — which `buildDockTree` takes from the group's first row — stays the
 *  live colour when a live sibling shares the repo; only a sleeping-only repo's
 *  swatch is self-assigned. This deliberately leaves the live terminals' colour
 *  assignment (canvas + dock) untouched, rather than widening it to tiles and
 *  shifting every live hue whenever something sleeps. */

import type {
  SleepingTerminal,
  TerminalId,
  TerminalMetadata,
} from "kolu-common/surface";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "../../terminal/terminalDisplay";

export type DockRowData = {
  meta: TerminalMetadata;
  info: TerminalDisplayInfo;
};

/** The resting "nothing live" values a slept terminal's three live fields
 *  (`pr` · `agent` · `foreground`) take — a sleeping tile has no PTY, so no
 *  resolved PR, agent, or foreground process. `prValue({kind:"pending"})` is
 *  null, so the PR pip renders nothing; the agent/foreground sublines stay
 *  empty. The inverse forward strip lives behind `terminals.ts`'s
 *  `toSavedTerminal`; this is the single home for "what nothing-live looks
 *  like", so the live/persisted split round-trips through two named sites. */
export const RESTING_LIVE_FIELDS = {
  pr: { kind: "pending" as const },
  agent: null,
  foreground: null,
} satisfies Pick<TerminalMetadata, "pr" | "agent" | "foreground">;

export function sleepingDockRowData(
  record: SleepingTerminal,
): DockRowData | undefined {
  const top = record.terminals.find((t) => !t.parentId) ?? record.terminals[0];
  if (!top) return undefined;
  const { id: _id, ...persisted } = top;
  const meta: TerminalMetadata = {
    ...persisted,
    ...RESTING_LIVE_FIELDS,
  };
  const tileId = record.id as TerminalId;
  const subIds = record.terminals
    .filter((t) => t.parentId === record.id)
    .map((t) => t.id as TerminalId);
  const info = buildTerminalDisplayInfos(
    [tileId],
    () => meta,
    () => subIds,
  ).get(tileId);
  return info ? { meta, info } : undefined;
}
