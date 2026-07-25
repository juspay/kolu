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

/** One listening TCP port inside a process subtree — "what is this thing
 *  serving?".
 *
 *  Three fields, and deliberately not a fourth: the BIND ADDRESS is reduced to
 *  the one bit a consumer acts on (`wildcard`). What a chip has to decide is
 *  "does this already answer on the name in the address bar, or does it need a
 *  forward?", and only the any-address bind answers yes — carrying the raw
 *  address would invite every render site to re-derive that judgment (and to
 *  disagree about `::ffff:0.0.0.0`).
 *
 *  No pid either: a fork-inherited listening socket belongs to several pids at
 *  once, so a pid here would name an arbitrary one of them. Attribution is to
 *  the SUBTREE, which is the question a caller asks. */
export const PortInfoSchema = z.object({
  /** The TCP port the socket is listening on. */
  port: z.number().int().min(1).max(65535),
  /** The PROGRAM holding the listener (`node`, `workerd`, …), for a glanceable
   *  "who is this?" beside the number — `argv[0]`'s basename on linux, the
   *  executable path's basename on darwin. Deliberately not linux's `comm`: that
   *  is the THREAD name, which Node overwrites, so a plain `node` dev server
   *  would read `MainThread`. */
  name: z.string(),
  /** True when the socket is bound to the ANY address (`0.0.0.0` / `::`, and the
   *  v4-mapped `::ffff:0.0.0.0`), so it already answers on every interface of the
   *  host that owns it — including the name in the viewer's address bar when that
   *  host is the one serving the UI. False for a loopback-only (or
   *  single-interface) bind, which is invisible from another machine and needs a
   *  forward. */
  wildcard: z.boolean(),
});
export type PortInfo = z.infer<typeof PortInfoSchema>;

/** Collapse listening sockets into the one row per PORT that a reader wants —
 *  sorted by port, deduplicated, with `wildcard` folded by OR.
 *
 *  This is part of what `PortInfo` MEANS, which is why it lives beside the type
 *  rather than in either consumer. The scanner folds one subtree's raw sockets (a
 *  fork-inherited listener is held by several pids; a dual-stack server appears in
 *  both socket tables; a server bound to `0.0.0.0` AND a specific address
 *  contributes two rows). A client folds several PANES of an already-folded set
 *  into one tile.
 *
 *  `wildcard` folds with OR rather than first-wins because the question a reader
 *  asks is "is this reachable from another machine as-is?", and one any-address
 *  bind is enough to make the answer yes.
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
    if (row.wildcard) prior.wildcard = true;
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
