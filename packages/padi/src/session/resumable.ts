import type { SavedTerminal } from "@kolu/padi-client/surface";
import { willResume } from "kolu-agents/vocab";

/** Ids of saved terminals that will resume an agent on restore — host-owned (the
 *  client renders this list and may only subtract from it). An ACTIVE record whose
 *  `restoreTarget` resumes is in; a SLEEPING record is not, because it restores
 *  dormant with no spawn and no resume. */
export function resumableTerminalIds(
  terminals: readonly SavedTerminal[],
): string[] {
  return terminals
    .filter((t) => t.state === "active" && willResume(t.restoreTarget))
    .map((t) => t.id);
}
