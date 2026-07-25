/**
 * Which terminal is serving a forwarded port — the join that turns a forward row
 * into a link back to the agent that started the thing.
 *
 * A row names a port and a door; the question a user actually has on seeing one
 * is "what IS this?". The scanner already answered it — it attributed the port to
 * a process subtree — so this is a lookup rather than a new fact, and it stays a
 * pure function so the two rules it carries can be pinned without a DOM.
 *
 * Both rules are inherited from PRT1 and both were bugs first:
 *
 *  - **The unit is the TILE, not the pane.** A dev server almost always runs in a
 *    split, so the port belongs to the split's own subtree — and a link to the
 *    split's id points at a pane rather than at the tile the user can see.
 *  - **`unknown` is not `[]`.** A terminal whose scan has never landed cannot
 *    answer; reading its silence as "does not serve this" is the same collapse
 *    the `known`/`unknown` two-way exists to prevent.
 */

import {
  knownPorts,
  type TerminalId,
  type TerminalPorts,
} from "kolu-common/surface";
import { terminalKey, type TerminalLocation } from "kolu-common/terminalKey";

/** What this join needs from one terminal — deliberately not a `TerminalMetadata`:
 *  the caller has that and this needs three fields, so the seam stays testable
 *  with object literals rather than whole fixtures. */
export interface ServingCandidate {
  id: TerminalId;
  /** The tile this pane belongs to, or `null` when it IS the tile. */
  parentId: TerminalId | null;
  ports: TerminalPorts;
}

/** The TILE serving `port`, or `undefined` when nothing does.
 *
 *  First match wins, and the determinism matters more than the choice: two
 *  programs on one port is a legitimate configuration and a fork-inherited
 *  socket shows up in several subtrees, so any answer is honest — but a
 *  different answer each render would move the link under the pointer. */
export function terminalServingPort(opts: {
  port: number;
  terminals: readonly ServingCandidate[];
}): TerminalId | undefined {
  for (const candidate of opts.terminals) {
    // `knownPorts` is the ONE place "we never looked" reads as no ports, and
    // going through it here is what keeps a blind terminal from being searched
    // as though it had answered.
    if (knownPorts(candidate.ports).some((p) => p.port === opts.port)) {
      return candidate.parentId ?? candidate.id;
    }
  }
  return undefined;
}

/** What a forward row CALLS the terminal it found — and therefore what the link
 *  back to it reads as.
 *
 *  `terminalKey` is the repo's one identity-and-display projection: the tile
 *  pill, the restore card, the palette row and this link all have to name the
 *  same terminal the same way, and being the same projection is the only way
 *  they stay that way. A positional "Terminal 3" would not do — the row's whole
 *  job is to answer "go WHERE?", and a position answers it with a coordinate. */
export function servingTerminalName(loc: TerminalLocation): string {
  const key = terminalKey(loc);
  // Non-git: `group` is the cwd BASENAME and `label` the shortened path, so
  // `group/label` would read "scratch/~/scratch". The label alone is the name.
  return loc.git ? `${key.group}/${key.label}` : key.label;
}
