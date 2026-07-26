/**
 * What a listening port IS, and the two operations that define what a SET of them
 * means. The browser-safe half of `@kolu/port-scan` — zod and nothing else, no
 * `node:` imports — so a client that only renders ports can import it without
 * dragging the reader (and its child processes) into a bundle.
 *
 * It lives here rather than in a consumer's vocabulary because both ends of the
 * wire depend on the same algebra for the same reason over different inputs: the
 * scanner folds one subtree's raw sockets, a client folds several already-folded
 * panes into one tile. Written twice it was the same rule twice, with one copy
 * tested.
 */

import { z } from "zod";

/** What a TCP port IS — the one range every schema and every hand-check in the
 *  repo means by "a port".
 *
 *  Port 0 is the kernel's "any", never a server you can point at, so the floor is
 *  1 rather than 0. Declared here because this is the OS-vocabulary leaf that
 *  already owns what a port is, and because the rule was being spelled
 *  independently at eight sites that had already drifted (`port <= 0` in one,
 *  `port < 1` in another, `.min(1)` in a third). A range restated is a range that
 *  will disagree with itself. */
export const TcpPortSchema = z.number().int().min(1).max(65535);

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
 *     loopback, where nothing is listening.
 *
 *  This started life as `wildcard: boolean` and was reshaped in PRT2, once the
 *  forward manager became a second consumer. The boolean's `false` arm covered
 *  the last two cases together, and they want OPPOSITE handling — one is the
 *  case a forward exists for, the other is the case no forward can serve. A
 *  boolean therefore had kolu opening a door to nowhere and handing the user a
 *  refused connection.
 *
 *  It is a bind OBSERVATION, not a reachability verdict: whether a port answers
 *  for a given VIEWER additionally needs to know whose host it is on, which the
 *  scanner cannot know. That join is `portReach` in kolu's own vocabulary. */
export const PortScopeSchema = z.enum(["any", "loopback", "interface"]);
export type PortScope = z.infer<typeof PortScopeSchema>;

/** WHICH IP family a socket is bound on — `127.0.0.1` and `::1` are both
 *  loopback, and they are NOT the same address.
 *
 *  Carried because a forward has to DIAL one of them, and dialling the wrong one
 *  fails in the worst available way: the door opens, and every connection through
 *  it is refused at the far end. That is not hypothetical — it is what PRT2
 *  shipped. A dev server on `[::1]:5173` (vite and several Node versions bind v6
 *  loopback by default) was forwarded to `127.0.0.1:5173`, where nothing was
 *  listening, so the tunnel came up healthy and served nothing at all.
 *
 *  It is a separate field from {@link PortScopeSchema} rather than four scope
 *  values because the two answer different questions and only one of them is a
 *  reachability judgment: `scope` decides WHETHER a door is needed, `family`
 *  decides WHAT it dials. Folding them would put `loopback-v4` and `loopback-v6`
 *  into the ordering that `widerScope` defines, where neither is wider.
 *
 *  A v4-MAPPED bind (`::ffff:127.0.0.1`) reads as `v4`: the socket is AF_INET6,
 *  but the address it carries is a v4 one and a v4 dial reaches it. The family
 *  here is the family of the ADDRESS, which is what a dial needs — not the family
 *  of the socket, which it does not. */
export const PortFamilySchema = z.enum(["v4", "v6"]);
export type PortFamily = z.infer<typeof PortFamilySchema>;

/** The family to dial when one port has binds in both — v4, because a v4 dial
 *  reaches a v4 listener and a dual-stack one, while a v6 dial reaches neither
 *  of a v4-only pair. Total and order-independent, like {@link widerScope}. */
export function preferredFamily(a: PortFamily, b: PortFamily): PortFamily {
  return a === "v4" || b === "v4" ? "v4" : "v6";
}

/** How USEFUL each scope is to kolu, most-useful first — the fold's ordering
 *  when one port has several binds (see {@link foldPorts}).
 *
 *  The ranking is about what kolu can DO with the bind, not about how many
 *  machines could reach it unaided — and those two orders disagree on exactly
 *  one pair. An `interface` bind reaches more of the network than a loopback
 *  one, but it is the single scope NO mechanism serves: both the relay and
 *  `ssh -L` dial the far side's LOOPBACK. So a server bound to both
 *  `192.168.1.5:5173` and `127.0.0.1:5173` has a door — through the loopback
 *  bind — and ranking `interface` higher would fold that port to the one scope
 *  whose row says "no forward can reach it".
 *
 *  `any` still subsumes both: it needs no door at all on the kolu host. */
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

/** One listening TCP port inside a process subtree — "what is this thing
 *  serving?".
 *
 *  Three fields, and deliberately not a fourth: the raw BIND ADDRESS is reduced
 *  to the {@link PortScope} a consumer acts on. Carrying the address itself
 *  would invite every render site to re-derive that classification (and to
 *  disagree about `::ffff:0.0.0.0`), which is the bug the single judge exists to
 *  prevent.
 *
 *  No pid either: a fork-inherited listening socket belongs to several pids at
 *  once, so a pid here would name an arbitrary one of them. Attribution is to
 *  the SUBTREE, which is the question a caller asks. */
export const PortInfoSchema = z.object({
  /** The TCP port the socket is listening on. */
  port: TcpPortSchema,
  /** The PROGRAM holding the listener (`node`, `workerd`, …), for a glanceable
   *  "who is this?" beside the number — `argv[0]`'s basename on linux, the
   *  executable path's basename on darwin. Deliberately not linux's `comm`: that
   *  is the THREAD name, which Node overwrites, so a plain `node` dev server
   *  would read `MainThread`. */
  name: z.string(),
  /** Where it is bound — see {@link PortScopeSchema}. */
  scope: PortScopeSchema,
  /** Which IP family it is bound on — see {@link PortFamilySchema}. */
  family: PortFamilySchema,
});
export type PortInfo = z.infer<typeof PortInfoSchema>;

/** Collapse listening sockets into the one row per PORT that a reader wants —
 *  sorted by port, deduplicated, with `scope` folded to the widest bind.
 *
 *  This is part of what `PortInfo` MEANS, which is why it lives beside the type
 *  rather than in either consumer. The scanner folds one subtree's raw sockets (a
 *  fork-inherited listener is held by several pids; a dual-stack server appears in
 *  both socket tables; a server bound to `0.0.0.0` AND a specific address
 *  contributes two rows). A client folds several PANES of an already-folded set
 *  into one tile.
 *
 *  `scope` folds by {@link widerScope} rather than first-wins because the
 *  question a reader asks is "how reachable is this port?", and the widest of its
 *  binds is the answer — one any-address bind makes the whole port answer
 *  everywhere, whatever else it is also bound to.
 *
 *  The whole fold is a function of the observed SET, never of the order it was
 *  observed in — that is one property, and BOTH the sort and the name rule serve
 *  it, because {@link samePortList} reads the array order AND the name. So the
 *  name is the lexicographically smallest of the candidates rather than
 *  first-wins: two programs on one port (`127.0.0.1:8080` and `192.168.1.5:8080`
 *  — a legitimate configuration) would otherwise alternate names with the
 *  scanner's pid-iteration order, which on linux descends from `readdir("/proc")`
 *  and is no stable function of the state, and every flip would publish a "change"
 *  through the fold, the registry, the wire and into a store write, forever.
 *  Naming either program is honest; naming a DIFFERENT one each pass is not. */
export function foldPorts(rows: readonly PortInfo[]): PortInfo[] {
  const byPort = new Map<number, PortInfo>();
  for (const row of rows) {
    const prior = byPort.get(row.port);
    if (prior === undefined) {
      byPort.set(row.port, { ...row });
      continue;
    }
    // Scope and family fold TOGETHER, because the family is a property OF a
    // bind rather than of the port. Folded independently they can come from
    // different rows: `192.168.1.5:5173` (v4) beside `[::1]:5173` (v6) folds to
    // scope=loopback — right, the doorable bind wins — and family=v4, so the
    // door dials 127.0.0.1 where nothing listens. It opens, reports success and
    // serves nothing, which is the exact failure `family` was added to stop.
    //
    // So: the winning scope decides, and the family is read off the rows that
    // hold that scope. Within one scope the v4 preference still applies.
    const scope = widerScope(prior.scope, row.scope);
    if (scope !== prior.scope) prior.family = row.family;
    else if (row.scope === scope) {
      prior.family = preferredFamily(prior.family, row.family);
    }
    prior.scope = scope;
    if (row.name < prior.name) prior.name = row.name;
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

/** The comparison keys, READ OFF the schema so a new `PortInfo` field is covered
 *  with no second edit here — the `PERSISTED_SNAPSHOT_KEYS` mechanism
 *  (`padi/src/terminalEndpoint/local.ts`), which exists because a hand-listed
 *  field set silently stops seeing the field you just added. Here the cost of that
 *  drift is invisible by construction: this is a DEDUP gate, so a field it does not
 *  compare is a field whose changes are swallowed, with nothing anywhere to report
 *  why the chip never updated. */
const PORT_INFO_KEYS = Object.keys(PortInfoSchema.shape) as (keyof PortInfo)[];

/** Are two port LISTS the same fact? The dedup gate a scanner applies BEFORE a
 *  sample reaches its consumer: an unchanged scan must emit nothing, or a
 *  seconds-cadence ticker would publish a fresh array — and a fresh reference
 *  through the whole reactive chain — on every pass forever. A client that has
 *  already collapsed a union (a tile fold) needs the same comparison as a
 *  SolidJS memo `equals` gate.
 *
 *  Order-sensitive by design: every producer sorts by port, so equal content in a
 *  different order cannot occur and treating it as a change would be honest
 *  anyway. Hand-written rather than `isDeepStrictEqual` so this stays browser-safe
 *  — but over `PORT_INFO_KEYS`, not a hand-listed triple, so the field set is the
 *  schema's and not a convention. */
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
