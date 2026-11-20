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
 *  is not a reference at all. NOT a throwing parser, and there is deliberately
 *  no throwing twin: every reader of a reference — the wire decoder, each
 *  lifted tool, the harness reading a tool call back — is holding a string an
 *  AGENT spelled, and an agent's mistake is data to answer rather than a
 *  control-flow fault to unwind. */
export function splitFleetTerminalRef(ref: string): FleetTerminalRef | null {
  const at = ref.lastIndexOf(FLEET_REF_SEPARATOR);
  if (at <= 0 || at === ref.length - 1) return null;
  return { host: ref.slice(0, at), id: ref.slice(at + 1) };
}

export const notAFleetRef = (ref: string): string =>
  `${JSON.stringify(ref)} is not a fleet terminal reference. On this face a terminal is addressed as <host>/<id> — a host key from the \`hosts\` resource, a slash, and the terminal id (e.g. "local/3f1c…"). Read \`surface://collections/terminals\` for the live set.`;
