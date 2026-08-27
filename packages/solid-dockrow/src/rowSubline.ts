/** Second-line content for a dock row — the STATUS WORDS.
 *
 *  Every dock row reserves a sub-line under the annotation label so row height
 *  stays uniform across agent / plain-shell rows (no reflow on activation).
 *  What that sub-line carries depends on the row:
 *
 *    - agent row → `agent.summary` if the SDK gave one, else the live state
 *      label (`Thinking`, `Awaiting input`, …). Either way the user gets a
 *      meaningful "what is it doing right now" cue without unfolding the tile.
 *    - plain-shell row with a foreground → the foreground process title
 *      (`nix build`, `vim file.ts`, `~/code/kolu`).
 *    - plain-shell row with nothing to say → the empty string, rendered as an
 *      invisible placeholder so the row still claims its second line.
 *
 *  `fromAgent` rides ALONGSIDE the text rather than being re-tested at each
 *  call site, because it is what decides the needs-you hook (`data-dock-subline`
 *  — only an AGENT line speaks needs-you; a quiet foreground does not) and the
 *  row's subline test id. Two answers derived from one read, returned together,
 *  so a surface cannot pair one row's words with another row's verdict. */

import { activeArm, type TerminalMetadata } from "@kolu/padi-client/vocab";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";

/** The live-state words shown when an agent gave no summary of its own. */
export const stateLabels: Record<AgentInfo["state"], string> = {
  thinking: "Thinking",
  tool_use: "Running tools",
  waiting: "Waiting for input",
  awaiting_user: "Awaiting input",
  running_background: "Running in background",
};

export type RowSubline = {
  /** The words. `""` means "nothing to say" — render the invisible placeholder. */
  text: string;
  /** Are these an AGENT's words (rather than a foreground process title)? */
  fromAgent: boolean;
};

export function rowSubline(meta: TerminalMetadata): RowSubline {
  const arm = activeArm(meta);
  if (!arm) return { text: "", fromAgent: false }; // sleeping: no live overlay
  if (arm.agent) {
    return {
      text: arm.agent.summary ?? stateLabels[arm.agent.state],
      fromAgent: true,
    };
  }
  return {
    text: arm.foreground?.title ?? arm.foreground?.name ?? "",
    fromAgent: false,
  };
}
