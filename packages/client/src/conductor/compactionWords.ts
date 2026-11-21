import type { ConductorCompactionRow } from "kolu-common/conductor";
import { tokens } from "./tokens";

export function compactionHeadline(row: ConductorCompactionRow): string {
  const at = row.at === null ? "" : ` at ${tokens(row.at)}`;
  switch (row.state) {
    case "running":
      return `compacting${at}`;
    case "done":
      return `compacted${at}`;
    case "failed":
      return "could not compact";
  }
}

export const COMPACTING = "compacting the conversation";

export function compactionSentence(
  row: ConductorCompactionRow,
  agent: string,
): string | null {
  switch (row.state) {
    case "running":
      return null;
    case "done":
      return `${agent} replaced the conversation above with this summary. ${
        row.rules === "sent"
          ? "The rules and your memory were sent again."
          : "The rules and your memory go out again with the next message."
      }`;
    case "failed":
      return row.error === null
        ? `${agent} tried to compact this conversation and could not.`
        : `${agent} tried to compact this conversation and could not: ${row.error.replace(/[.!?]$/u, "")}.`;
  }
}
