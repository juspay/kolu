/** A MEMBER TERMINAL's two halves — the browser's reading of the fleet
 *  identity grammar `<encodedHostKey>/<terminalId>`.
 *
 *  A work's members carry membership ONLY (the ref, the role, when it joined);
 *  every live fact about those terminals — the name, the agent, what it is
 *  doing — is read from the host's own `terminals` collection, which is keyed
 *  by the two halves separately. So the column has to split, and the split
 *  itself is NOT written here: `kolu-mcp/fleetRef` is the grammar's one
 *  authority — the leaf the Conductor's wire refs are printed by, with no
 *  imports at all precisely so a bundle that must not take the MCP SDK (this
 *  one, and `@kolu/acp-harness` before it) can still read a reference. The
 *  rule that matters is the LAST `/` (a remote host key carries its own; a
 *  terminal id never does), and a second spelling of it in the browser is a
 *  remote host silently becoming a host called `remote:ssh:`.
 *
 *  What is this module's own is the VALIDATION on top, which the grammar leaf
 *  deliberately does not do: a ref the browser cannot resolve is still drawn,
 *  saying so in its own words, and that is only possible if the parse answers
 *  rather than throws. */

import { isEncodedHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { isTerminalId } from "@kolu/terminal-vocab/terminalId";
import { splitFleetTerminalRef } from "kolu-mcp/fleetRef";

/** A member's ref, split into the two keys the fleet index is read by. */
export interface MemberRef {
  readonly host: string;
  readonly id: TerminalId;
}

/** Split a member's ref, or `null` when it is not one this browser can
 *  resolve — not a reference at all, a host key that is not canonical, or an
 *  id that is not a terminal id. The column draws such a member anyway,
 *  saying so, because a work records who joined it whether or not this
 *  browser can reach them. */
export function splitMemberRef(ref: string): MemberRef | null {
  const split = splitFleetTerminalRef(ref);
  if (split === null) return null;
  if (!isEncodedHostKey(split.host) || !isTerminalId(split.id)) return null;
  return { host: split.host, id: split.id };
}
