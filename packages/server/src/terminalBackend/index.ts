/**
 * Single dispatch point for "which backend handles this terminal".
 *
 * The resolver consolidates the only place in the server that
 * pattern-matches on `location.kind`. Every consumer downstream
 * (router, surface, terminal lifecycle) calls
 * `getTerminalBackendFor(location)` and then talks to the returned
 * backend object — never asking "is this local or remote?" itself.
 *
 * R-1 has only the local variant. R-2 will add `{ kind: "remote",
 * host: string }` and an inner branch on `host` that resolves to a
 * `RemoteTerminalBackend` per `HostSession`. R-2's
 * `getTerminalBackendForCreate({ parentId, location })` resolver lives
 * next to this one once it's written — sub-terminal inheritance reads
 * the parent's `meta.location` rather than trusting the create input,
 * which is the single place that needs to know "where do new
 * terminals end up".
 */

import type {
  TerminalBackend,
  TerminalLocation,
} from "kolu-common/terminalBackend";
import { localTerminalBackend } from "./local.ts";

export function getTerminalBackendFor(
  _location: TerminalLocation,
): TerminalBackend {
  return localTerminalBackend;
}
