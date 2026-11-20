import type { RecencyAt, RowRecency } from "@kolu/solid-dockrow/rowValues";
import { rowRecency } from "@kolu/solid-dockrow/rowValues";
import { getClockNow } from "../../time/clock";

export function useRowRecency(): (
  pip: { asking: boolean; active: boolean },
  at: RecencyAt,
) => RowRecency {
  const counting = getClockNow();
  return (pip, at) => rowRecency(pip, at, { counting, glancing: Date.now });
}
