/**
 * WHAT THE CONDUCTOR REMEMBERS, as it is sent — the block that rides below
 * the rules, read at the moment a message goes out.
 *
 * Only an approved entry is a fact here. A proposal still waiting on the
 * human is named by its title alone, under a heading that says it is not
 * remembered.
 */

import { type Memory, proposalTitle } from "kolu-common/conductorMemory";

export const MEMORY_HEADING = "# [kolu] What you remember";

export function memoryBlock(
  memory: Pick<Memory, "entries" | "proposals">,
): string {
  const entries =
    memory.entries.length === 0
      ? ["Nothing yet."]
      : memory.entries.map((entry) =>
          [
            `## ${entry.title}`,
            ...(entry.about === null ? [] : [`About: ${entry.about}`]),
            "",
            entry.body,
          ].join("\n"),
        );
  const waiting =
    memory.proposals.length === 0
      ? []
      : [
          [
            "## Waiting on the human, not remembered",
            ...memory.proposals.map(
              (proposal) => `- ${proposalTitle(memory, proposal)}`,
            ),
          ].join("\n"),
        ];
  return [MEMORY_HEADING, ...entries, ...waiting].join("\n\n");
}
