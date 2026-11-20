/** The words of a compaction row — its one line, and the sentence under it.
 *  Pure, and read by the line itself, the status line and Copy transcript, so
 *  the three cannot say different things about one compaction. */

import type { ConductorCompactionRow } from "kolu-common/conductor";
import { tokens } from "./tokens";

/** `compacted at 201k` — what happened, and at how much context. A row that
 *  began while kolu knew no usage (the first after a restart) has no number. */
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

/** The sentence a settled row says under its line, naming the agent. */
export function compactionSentence(
  row: ConductorCompactionRow,
  agent: string,
): string {
  switch (row.state) {
    case "running":
      return `${agent} is compacting this conversation…`;
    case "done":
      return `${agent} replaced the conversation above with this summary. ${
        row.rules === "sent"
          ? "The rules were sent again."
          : "The rules go out again with the next message."
      }`;
    case "failed":
      return row.error === null
        ? `${agent} tried to compact this conversation and could not.`
        : `${agent} tried to compact this conversation and could not: ${row.error.replace(/[.!?]$/u, "")}.`;
  }
}
