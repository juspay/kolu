import { Schema } from "effect";

const TCP_PORT_MIN = 1;
const TCP_PORT_MAX = 65535;

export const TcpPortSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(TCP_PORT_MIN),
  Schema.isLessThanOrEqualTo(TCP_PORT_MAX),
);

/** The same rule as {@link TcpPortSchema}, as a plain predicate. */
export function isTcpPort(port: number): boolean {
  return Number.isInteger(port) && port >= TCP_PORT_MIN && port <= TCP_PORT_MAX;
}

/** WHERE a listening socket is bound, reduced to the three cases that take
 *  genuinely different action — never to a boolean.
 *
 *   - `any` — `0.0.0.0` / `::` / the v4-mapped `::ffff:0.0.0.0`. It answers on
 *     every interface of the host that owns it, so it needs no door at all when
 *     that host is the one serving the UI.
 *   - `loopback` — `127.0.0.0/8` / `::1` / a v4-mapped loopback. Invisible from
 *     any other machine (loopback never leaves the box), and forwardable: BOTH
 *     of `@kolu/port-forward`'s mechanisms connect to `127.0.0.1` on the far
 *     side, so this is exactly the address they can reach.
 *   - `interface` — one specific non-loopback address (`192.168.1.5`, a tailnet
 *     `fd7a:…`). It already answers on THAT interface without a door, and NO
 *     door can reach it: a relay or an `ssh -L` would dial the far side's
 *     loopback, where nothing is listening. */
export const PortScopeSchema = Schema.Literals([
  "any",
  "loopback",
  "interface",
]);
export type PortScope = typeof PortScopeSchema.Type;

/** WHICH IP family a socket is bound on — `127.0.0.1` and `::1` are both
 *  loopback, and they are NOT the same address.
 *
 *  A v4-MAPPED bind (`::ffff:127.0.0.1`) reads as `v4`: the socket is AF_INET6,
 *  but the address it carries is a v4 one and a v4 dial reaches it. The family
 *  here is the family of the ADDRESS, which is what a dial needs — not the family
 *  of the socket, which it does not. */
export const PortFamilySchema = Schema.Literals(["v4", "v6"]);
export type PortFamily = typeof PortFamilySchema.Type;

/** The family to dial when one port has binds in both — v4, because a v4 dial
 *  reaches a v4 listener and a dual-stack one, while a v6 dial reaches neither
 *  of a v4-only pair. Total and order-independent, like {@link widerScope}. */
export function preferredFamily(a: PortFamily, b: PortFamily): PortFamily {
  return a === "v4" || b === "v4" ? "v4" : "v6";
}

const SCOPE_RANK: Record<PortScope, number> = {
  any: 2,
  loopback: 1,
  interface: 0,
};

/** The most reachable of two binds of the same port. Total and order-independent
 *  — the property {@link foldPorts} rests on. */
export function widerScope(a: PortScope, b: PortScope): PortScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** The longest command line a {@link PortInfo} carries, in characters. */
export const PORT_COMMAND_MAX_CHARS = 512;

/** The command line a listener's process is shown by: its argv joined by spaces,
 *  cut at {@link PORT_COMMAND_MAX_CHARS} with a trailing `…`.
 *
 *  An EMPTY argv is shown by `name`. */
export function portCommand(argv: readonly string[], name: string): string {
  const joined = argv.length === 0 ? name : argv.join(" ");
  return joined.length <= PORT_COMMAND_MAX_CHARS
    ? joined
    : `${joined.slice(0, PORT_COMMAND_MAX_CHARS - 1)}…`;
}

/** WHERE one listening TCP socket is bound — the port, and the two facts a
 *  consumer acts on ({@link PortScope}, {@link PortFamily}). */
export const PortBindSchema = Schema.Struct({
  /** The TCP port the socket is listening on. */
  port: TcpPortSchema,
  /** Where it is bound — see {@link PortScopeSchema}. */
  scope: PortScopeSchema,
  /** Which IP family it is bound on — see {@link PortFamilySchema}. */
  family: PortFamilySchema,
});
export type PortBind = typeof PortBindSchema.Type;

/** One listening TCP port and the program holding it — "what is this thing
 *  serving?". */
export const PortInfoSchema = Schema.Struct({
  // The bind's own field schemas, in the PERSISTED key order — `port` first,
  // `scope`/`family` last. Spreading `PortBindSchema.fields` up front would
  // reorder the encoded keys of every stored snapshot (schemaByteCompat pins it).
  port: PortBindSchema.fields.port,
  /** The PROGRAM holding the listener (`node`, `workerd`, …), for a glanceable
   *  "who is this?" beside the number — `argv[0]`'s basename on linux, the
   *  executable path's basename on darwin. Deliberately not linux's `comm`: that
   *  is the THREAD name, which Node overwrites, so a plain `node` dev server
   *  would read `MainThread`. */
  name: Schema.String,
  /** The full command line of that program — see {@link portCommand}. Folded
   *  TOGETHER with `name` (see {@link foldPorts}), so the two always describe
   *  the same process. */
  command: Schema.String,
  scope: PortBindSchema.fields.scope,
  family: PortBindSchema.fields.family,
});
export type PortInfo = typeof PortInfoSchema.Type;

/** Collapse listening sockets into the one row per PORT that a reader wants —
 *  sorted by port, deduplicated, with `scope` folded to the widest bind. */
export function foldPorts(rows: readonly PortInfo[]): PortInfo[] {
  return foldByPort(rows, (prior, row) => {
    const rowFirst =
      row.name < prior.name ||
      (row.name === prior.name && row.command < prior.command);
    const owner = rowFirst ? row : prior;
    return {
      port: prior.port,
      name: owner.name,
      command: owner.command,
      ...mergeBind(prior, row),
    };
  });
}

/** {@link foldPorts} for bare binds — one row per port, the widest bind, sorted. */
export function foldBinds(rows: readonly PortBind[]): PortBind[] {
  return foldByPort(rows, (prior, row) => ({
    port: prior.port,
    ...mergeBind(prior, row),
  }));
}

function foldByPort<T extends { readonly port: number }>(
  rows: readonly T[],
  merge: (prior: T, row: T) => T,
): T[] {
  const byPort = new Map<number, T>();
  for (const row of rows) {
    const prior = byPort.get(row.port);
    byPort.set(row.port, prior === undefined ? row : merge(prior, row));
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function mergeBind(
  prior: { readonly scope: PortScope; readonly family: PortFamily },
  row: { readonly scope: PortScope; readonly family: PortFamily },
): { scope: PortScope; family: PortFamily } {
  const scope = widerScope(prior.scope, row.scope);
  const family =
    scope !== prior.scope
      ? row.family
      : row.scope === scope
        ? preferredFamily(prior.family, row.family)
        : prior.family;
  return { scope, family };
}

const PORT_INFO_KEYS = Object.keys(PortInfoSchema.fields) as (keyof PortInfo)[];

/** Are two port LISTS the same fact? The dedup gate a scanner applies BEFORE a
 *  sample reaches its consumer. Order-sensitive by design: every producer sorts
 *  by port. */
export function samePortList(
  a: readonly PortInfo[],
  b: readonly PortInfo[],
): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]!;
      return PORT_INFO_KEYS.every((k) => p[k] === q[k]);
    })
  );
}
