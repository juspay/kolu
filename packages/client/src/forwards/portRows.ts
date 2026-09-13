/**
 * The rows of the ports section — in two groups, "from this terminal" and
 * "elsewhere on this host" — joined to the forwards kolu holds.
 *
 * There used to be two titled groups that were a mistake: a PORTS group and a
 * FORWARDED PORTS group rendered a forwarded port twice. They merged into one
 * list, and that stays true — every port is still ONE row, carrying its door.
 * The two groups here answer a different question, and each port lands in
 * exactly one of them.
 *
 * **From this terminal** is what the tile serves: every port its panes' process
 * subtrees hold, plus every server whose URL a pane PRINTED that is listening
 * somewhere else on the host. The second kind is the reason the host-wide scan
 * exists — `odu web-daemon`, anything under `setsid`, reparents to init and
 * leaves the subtree while it keeps serving the URL the terminal printed. The
 * printed URL is an entry point, never a fact: the row exists because the HOST
 * reading positively holds the port, and the print only says which tile it
 * belongs with.
 *
 * **Elsewhere on this host** is the rest of what has a story:
 *  - every listener a readable (same-user) program holds — the user's own servers;
 *  - an unclaimed socket (another user's) only when a terminal printed its URL or
 *    a door already points at it — a system daemon otherwise has no business here;
 *  - every door with nothing behind it (`orphan`) — a ⌘K forward, or one whose
 *    listener died before the reap. A forward is a fact about the HOST, and an
 *    open door must stay somewhere it can be cancelled from.
 *
 * kolu's OWN relay listeners are left out: a door is shown as the row it serves,
 * and its local listener appearing as a second row would be the double rendering
 * the merge removed.
 *
 * A pure join, so the grouping and ordering are testable without a DOM.
 */

import {
  type HostListeners,
  type KoluForward,
  listenerAt,
  type PortInfo,
  type UnclaimedPort,
} from "kolu-common/surface";

/** Why a row is in the group it is in. */
export type PortOrigin =
  /** In one of this tile's process subtrees. */
  | "subtree"
  /** Printed by this tile, served by a process outside its subtrees. */
  | "printed"
  /** On the host, with a story, and not this tile's. */
  | "host";

/** One row of the section.
 *
 *  `port` — a listener a readable program holds, with its door if it has one.
 *  `unclaimed` — a listener whose owner is not visible to the scanner.
 *  `orphan` — a door on this host with no listener behind it (yet, or ever).
 *
 *  A discriminated union rather than a `PortInfo` with optional fields, because
 *  the arms genuinely differ in what they can show: an unclaimed row has a bind
 *  but no program, an orphan has neither. A shared shape would be half-empty on
 *  two arms and a render site would have to guess which. */
export type PortRow =
  | {
      kind: "port";
      /** The arm-independent KEY the list is rendered and `data-port`-tagged by
       *  — carried because the orphan arm has no `info` to project it from. */
      port: number;
      info: PortInfo;
      origin: PortOrigin;
      forward: KoluForward | undefined;
    }
  | {
      kind: "unclaimed";
      port: number;
      bind: UnclaimedPort;
      origin: Exclude<PortOrigin, "subtree">;
      forward: KoluForward | undefined;
    }
  | { kind: "orphan"; port: number; forward: KoluForward };

export interface PortGroups {
  /** What this terminal serves — its subtrees' ports and the servers it printed. */
  here: PortRow[];
  /** The rest of the host that has a story, then the doors with nothing behind them. */
  elsewhere: PortRow[];
}

/** Group what the tile and the host serve, joined to what kolu has opened. */
export function portGroups(opts: {
  /** The tile's subtree ports, already folded across its panes. */
  tilePorts: readonly PortInfo[];
  /** The host's listeners — `unknown` leaves only the subtree rows and doors. */
  host: HostListeners;
  /** Ports whose URLs this tile's panes printed. */
  printedHere: ReadonlySet<number>;
  /** Ports whose URLs any terminal on this host printed. */
  printedOnHost: ReadonlySet<number>;
  /** The doors on the inspected terminal's host. ALREADY host-scoped by the
   *  caller (`forwardsForHost`), so this function does not re-filter. */
  forwards: readonly KoluForward[];
  /** kolu's own relay listeners on this host — every door's LOCAL port when the
   *  host is the kolu server's own, and empty otherwise. */
  doorPorts: ReadonlySet<number>;
}): PortGroups {
  const doorOf = new Map(opts.forwards.map((f) => [f.remotePort, f]));
  const taken = new Set<number>();
  const byPort = (a: PortRow, b: PortRow) => a.port - b.port;

  // ── From this terminal ────────────────────────────────────────────────
  const here: PortRow[] = opts.tilePorts.map((info) => {
    taken.add(info.port);
    return {
      kind: "port",
      port: info.port,
      info,
      origin: "subtree",
      forward: doorOf.get(info.port),
    };
  });
  for (const port of opts.printedHere) {
    if (taken.has(port) || opts.doorPorts.has(port)) continue;
    const at = listenerAt(opts.host, port);
    if (at.kind === "claimed") {
      here.push({
        kind: "port",
        port,
        info: at.info,
        origin: "printed",
        forward: doorOf.get(port),
      });
      taken.add(port);
    } else if (at.kind === "unclaimed") {
      here.push({
        kind: "unclaimed",
        port,
        bind: at.bind,
        origin: "printed",
        forward: doorOf.get(port),
      });
      taken.add(port);
    }
    // `absent` / `unknown`: the print promised a server the host does not
    // (or cannot be seen to) hold. No row — the printed-URL card is where that
    // promise is discussed, and a row here would be a chip made from text.
  }
  here.sort(byPort);

  // ── Elsewhere on this host ────────────────────────────────────────────
  const elsewhere: PortRow[] = [];
  if (opts.host.status === "known") {
    for (const info of opts.host.claimed) {
      if (taken.has(info.port) || opts.doorPorts.has(info.port)) continue;
      elsewhere.push({
        kind: "port",
        port: info.port,
        info,
        origin: "host",
        forward: doorOf.get(info.port),
      });
      taken.add(info.port);
    }
    if (opts.host.unclaimed.status === "known") {
      for (const bind of opts.host.unclaimed.list) {
        if (taken.has(bind.port) || opts.doorPorts.has(bind.port)) continue;
        const forward = doorOf.get(bind.port);
        if (forward === undefined && !opts.printedOnHost.has(bind.port)) {
          continue;
        }
        elsewhere.push({
          kind: "unclaimed",
          port: bind.port,
          bind,
          origin: "host",
          forward,
        });
        taken.add(bind.port);
      }
    }
  }
  elsewhere.sort(byPort);

  // Every door with no listener behind it, AFTER every listener: the section's
  // subject is what is serving; a door onto nothing is the footnote.
  const orphans = opts.forwards
    .filter((f) => !taken.has(f.remotePort))
    .sort((a, b) => a.remotePort - b.remotePort)
    .map(
      (forward): PortRow => ({
        kind: "orphan",
        port: forward.remotePort,
        forward,
      }),
    );

  return { here, elsewhere: [...elsewhere, ...orphans] };
}
