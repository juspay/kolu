/** Second-line content for a dock row.
 *
 *  Every dock row reserves a sub-line under the branch label so row
 *  height stays uniform across agent / plain-shell rows (no reflow on
 *  activation). What that sub-line carries depends on the row:
 *
 *    - agent row → `agent.summary` if the SDK gave one, else the
 *      live state label (`Thinking`, `Awaiting input`, …). Either
 *      way the user gets a meaningful "what is it doing right now"
 *      cue without unfolding the tile.
 *    - plain-shell row with a foreground → the foreground process
 *      title (`nix build`, `vim file.ts`, `~/code/kolu`).
 *    - plain-shell row with nothing to say → empty string, rendered
 *      by callers as an invisible placeholder so the row still claims
 *      its second line of vertical space.
 *
 *  Shared by `Dock` (desktop) and `DockList` (the touch list behind the
 *  phone drawer and the compact rail) — both have the same two-line
 *  geometry and the same content rules. */

import type { TerminalMetadata } from "kolu-common/surface";
import { stateLabels } from "../../ui/agentDisplay";

export function rowSubline(meta: TerminalMetadata): string {
  if (meta.agent) {
    return meta.agent.summary ?? stateLabels[meta.agent.state];
  }
  return meta.foreground?.title ?? meta.foreground?.name ?? "";
}
