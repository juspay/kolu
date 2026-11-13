/** A WATCHED ENTRY's two halves — the browser's reader of the fleet identity
 *  grammar `<encodedHostKey>/<terminalId>`.
 *
 *  `ConductorState.watched` is membership ONLY (refs, in add order); every live
 *  fact about those terminals — the name, the agent, what it is doing — is read
 *  from the host's own `terminals` collection, which is keyed by the two halves
 *  separately. So the panel has to split, and the split has exactly one rule:
 *
 *  **Cut at the LAST `/`.** An encoded host key is `local` or `remote:<target>`
 *  and a target may itself contain a `/` (`ssh://box/3`, a socket path); a
 *  terminal id is a UUID and never does. The rule, and the reason, are
 *  `@kolu/kolu-mcp`'s `fleetRef.ts` — the grammar's one authority, which the
 *  Conductor's wire refs are printed by. The client cannot import it (the
 *  browser bundle does not depend on the MCP package), so this is the SECOND
 *  reader of that grammar and it is written to be obviously the same rule;
 *  both halves are then VALIDATED here, which the grammar leaf deliberately
 *  does not do: a ref the browser cannot resolve is still drawn (so a person
 *  can remove it), and that is only possible if the parse answers rather than
 *  throws. */

import { isEncodedHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { isTerminalId } from "@kolu/terminal-vocab/terminalId";

/** A watched ref, split into the two keys the fleet index is read by. */
export interface WatchedRef {
  readonly host: string;
  readonly id: TerminalId;
}

/** Split a watched ref, or `null` when it is not one this browser can resolve
 *  — no separator, a host key that is not canonical, or an id that is not a
 *  terminal id. The panel draws such an entry anyway, saying so, because the
 *  one thing a person must be able to do with an entry kolu cannot resolve is
 *  take it off the list. */
export function splitWatchedRef(ref: string): WatchedRef | null {
  const at = ref.lastIndexOf("/");
  if (at <= 0 || at === ref.length - 1) return null;
  const host = ref.slice(0, at);
  const id = ref.slice(at + 1);
  if (!isEncodedHostKey(host) || !isTerminalId(id)) return null;
  return { host, id };
}
