import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { elapsedSince } from "../time/duration";
import { toolLabel } from "./toolCard";

const DETAIL_LIMIT = 72;

function headline(text: string): string | null {
  const first = text.split("\n")[0]?.trim() ?? "";
  if (first === "") return null;
  return first.length <= DETAIL_LIMIT
    ? first
    : `${first.slice(0, DETAIL_LIMIT - 1).trimEnd()}…`;
}

const TURN_OPENERS: Partial<Record<ConductorRow["kind"], true>> = {
  user: true,
  wake: true,
  divider: true,
};

function rowsOfTurnInFlight(
  rows: readonly ConductorRow[],
): readonly ConductorRow[] {
  const opener = rows.findLastIndex((row) => TURN_OPENERS[row.kind] === true);
  return rows.slice(opener + 1);
}

export function conductorDoing(rows: readonly ConductorRow[]): string | null {
  const turn = rowsOfTurnInFlight(rows);
  let said: string | null = null;
  for (let i = turn.length - 1; i >= 0; i--) {
    const row = turn[i];
    if (row === undefined) continue;
    if (
      row.kind === "tool" &&
      row.asksThroughForm !== true &&
      (row.status === "pending" || row.status === "in_progress")
    ) {
      return toolLabel(row);
    }
    if (row.kind === "agent" && said === null) said = headline(row.text);
  }
  return said;
}

export function statusDetail(
  phase: ConductorState["phase"],
  rows: readonly ConductorRow[],
): string | null {
  return phase === "working" ? conductorDoing(rows) : null;
}

export function statusSince(
  phase: ConductorState["phase"],
  busySince: string | null,
  nowMs: number,
): string | null {
  if (phase !== "working" && phase !== "asking") return null;
  return busySince === null ? null : elapsedSince(busySince, nowMs);
}
