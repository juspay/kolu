/**
 * The fleet IDENTITY GRAMMAR — `<encodedHostKey>/<terminalId>` — and the ONE
 * parser every reader of a fleet reference goes through.
 *
 * The stdio face serves one padi, so a terminal id is identity enough. The
 * fleet face serves every host kolu-server mirrors, so the host travels WITH
 * the id: a bare id on the fleet wire is ambiguous the moment two hosts are up,
 * and "ambiguous terminal id" is not a failure anything downstream can report —
 * it reads as a terminal that is simply not there.
 *
 * **Parse at the LAST `/`.** An encoded host key is `local` or
 * `remote:<target>`, and a target may contain a `/` (`ssh://box/3`, a socket
 * path); a terminal id is a UUID and never does. So the separator is the last
 * one, not the first, and the split is written here ONCE — a hand-rolled
 * `ref.split("/")` elsewhere is a remote host silently becoming a host called
 * `remote:ssh:` with a terminal called `/box/3`.
 *
 * The parser REFUSES rather than guessing: a string with no `/` is not a fleet
 * reference, and answering one with `{ host: <the whole thing> }` would send a
 * bare id to whichever host sorted first.
 *
 * **A LEAF with no imports at all.** The grammar is the one piece of this
 * package a non-MCP consumer needs: `@kolu/acp-harness` reads a fleet reference
 * out of a tool call and must not grow an edge to the MCP SDK, to padi-client,
 * or to effect to do it — its manifest is deliberately the ACP SDK and
 * `kolu-common`. So the refusal here is a named `Error` subclass rather than
 * `@kolu/surface-mcp`'s `ToolFailure`, and the WIRE schema built on this grammar
 * lives one file over in `./refSchema.ts`, where effect is allowed. Reached as
 * `kolu-mcp/fleetRef`.
 */

/** The one separator between a host key and a terminal id. */
export const FLEET_REF_SEPARATOR = "/";

/** A fleet reference, split. `host` is the ENCODED host key (`local`,
 *  `remote:<target>`) — opaque to this package, which never decodes one: it is
 *  the key kolu-server's host map is keyed by, and a string compare is the only
 *  thing a projection needs from it. */
export interface FleetTerminalRef {
  readonly host: string;
  readonly id: string;
}

/** Print a reference. The one writer, beside the one reader. */
export function fleetTerminalRef(host: string, id: string): string {
  return `${host}${FLEET_REF_SEPARATOR}${id}`;
}

/** The grammar as a PREDICATE-shaped read: the split, or `null` when the string
 *  is not a reference at all. Separate from {@link parseFleetTerminalRef} so a
 *  schema check can ask the question without a throw, and so the two can never
 *  answer it differently. */
export function splitFleetTerminalRef(ref: string): FleetTerminalRef | null {
  const at = ref.lastIndexOf(FLEET_REF_SEPARATOR);
  // `at <= 0` covers both "no separator" and a leading one (an empty host key
  // is not a host); a trailing one leaves no id to address.
  if (at <= 0 || at === ref.length - 1) return null;
  return { host: ref.slice(0, at), id: ref.slice(at + 1) };
}

/** The refusal sentence — one spelling, so the schema's decode issue and the
 *  parser's throw teach the same grammar. */
export const notAFleetRef = (ref: string): string =>
  `${JSON.stringify(ref)} is not a fleet terminal reference. On this face a terminal is addressed as <host>/<id> — a host key from the \`hosts\` resource, a slash, and the terminal id (e.g. "local/3f1c…"). Read \`surface://collections/terminals\` for the live set.`;

/** A string that is not a reference reached a reader that needs one. Its own
 *  class so a caller can tell "the agent spelled an id wrong" from a transport
 *  failure, which is the distinction a bare `Error` here used to cost. */
export class FleetRefMalformed extends Error {
  readonly ref: string;
  constructor(ref: string) {
    super(notAFleetRef(ref));
    this.name = "FleetRefMalformed";
    this.ref = ref;
  }
}

/** Split a reference, or THROW naming the grammar. */
export function parseFleetTerminalRef(ref: string): FleetTerminalRef {
  const split = splitFleetTerminalRef(ref);
  if (split === null) throw new FleetRefMalformed(ref);
  return split;
}
