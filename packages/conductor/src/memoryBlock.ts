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

/** THE MESSAGE "Bring over from Claude Code" sends, in the person's name:
 *  where the engine kept its own memory (its own package's sentence), and
 *  what to propose from it. kolu itself never opens those files. */
export function bringOverMessage(hint: string): string {
  return [
    "Bring over what you remembered in Claude Code's own memory.",
    hint,
    "Read the index and each file it lists. For each fact that is still true and useful beyond one piece of work, call `memory_propose`: merge the ones that overlap, propose twenty at most, and name the file it came from in `why`. Nothing is remembered until I approve it, so do not ask me about them.",
    "Then say in one sentence how many you proposed and how many you left.",
  ].join(" ");
}
