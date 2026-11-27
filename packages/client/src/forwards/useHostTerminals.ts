/**
 * The active host's terminals, as the port surfaces ask about them — "which
 * terminal serves this port, and how do I get there?", "what does THIS tile hold
 * and print?" and "which ports did any terminal print?".
 *
 * Every walk of "every pane of every tile" the Ports section and the printed-URL
 * card need lives here, so the sets `portGroups` joins arrive from ONE source
 * over the same store rather than being re-walked at each call site.
 *
 * The link rule is `servingLink` (pure, beside it). What lives here is the SOURCE
 * of the candidates — every pane of every tile in the active host's store — built
 * once per owner as a memo, because both the Ports section and the printed-URL
 * card ask per row / per render.
 *
 * Panes and not tiles, because a dev server almost always runs in a split and the
 * scanner attributes the port to the split's own subtree; `servingLink` folds the
 * answer back to the tile the user can activate.
 */

import { activeArm } from "@kolu/padi-client/surface";
import {
  foldPorts,
  knownPorts,
  type PortInfo,
  type TerminalId,
} from "kolu-common/surface";
import { createMemo } from "solid-js";
import { sameEach, sameItems } from "../conductor/sameItems";
import { printedPortsOf } from "../terminal/printedPorts";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { plainPorts, samePorts } from "./panePorts";
import { foldEach } from "@kolu/surface/solid";
import { type ServingCandidate, servingLink } from "./terminalServingPort";

/** Set equality — the `equals` gate for the printed-port memos, so an unrelated
 *  terminal tick that re-derives the same set does not re-run a join. */
export const sameSet = (
  a: ReadonlySet<number>,
  b: ReadonlySet<number>,
): boolean => a.size === b.size && [...a].every((p) => b.has(p));

/** Element-wise identity for a FILTERED view of keyed rows — the `equals` gate
 *  a memo needs when it selects from a list whose items are already stable.
 *
 *  Beside {@link sameSet} for the same reason. Identity per index, not a deep
 *  compare, so it closes only on a selection of the very same references — in
 *  practice the empty result a quiet host republishes on every pass, or a
 *  filter that picked the same rows out of an unchanged join. The port join
 *  mints fresh row objects on a tick, so a tick that changes a row publishes;
 *  what the gate removes is the equal republish re-checking every row
 *  downstream for nothing. */
export const sameRows = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((row, i) => row === b[i]);

export interface HostTerminals {
  /** The tile serving `port` and the way to it, or `undefined` when no KNOWN
   *  terminal subtree holds it. */
  servingFor: (port: number) => { name: string; jump: () => void } | undefined;
  /** A tile's subtree ports, folded across every pane of it. `knownPorts` is
   *  the ONE place "we never looked" reads as no ports: a pane whose first scan
   *  has not landed contributes nothing rather than asserting it serves nothing.
   *  A plain derivation — a caller that needs identity across equal recomputes
   *  wraps it in a memo with `samePortList`. */
  tilePorts: (tileId: TerminalId) => readonly PortInfo[];
  /** The ports a tile's panes printed a loopback URL for. A plain derivation —
   *  memo it with {@link sameSet} for identity. */
  printedBy: (tileId: TerminalId) => ReadonlySet<number>;
  /** The ports ANY terminal on this host printed — the story an unclaimed
   *  socket needs. */
  printedOnHost: () => ReadonlySet<number>;
}

/** ONE PANE, as the fold's row reads it: which tile holds it, and where in
 *  the server's order it sits. The RECORD half is folded separately, so this
 *  is pure membership. */
interface PaneSlot {
  id: TerminalId;
  /** The tile this pane belongs to, or `null` when it IS the tile. */
  parentId: TerminalId | null;
}

export function useHostTerminals(): HostTerminals {
  const store = useTerminalStore();

  /** EVERY PANE OF EVERY TILE with the tile that holds it — tile, then its
   *  own panes, which is the order every reading below publishes in.
   *
   *  TWO sources for any number of panes: `terminalIds()` is the census's own
   *  plain array and `getTilePaneIds` reads the one splits index whatever tile
   *  it is asked about. The per-pane RECORD reads are folded below, one row
   *  memo each — a single memo that walked the panes and read each one's
   *  record carried four sources a pane (the slot leaf, the projected record,
   *  `state` and `ports`), which Solid's development build judges
   *  `WIDE_SCOPE_DEPS` past 200 sources at about 50 panes. */
  const panes = createMemo<readonly PaneSlot[]>(
    () =>
      store
        .terminalIds()
        .flatMap((tileId) =>
          store
            .getTilePaneIds(tileId)
            .map((id) => ({ id, parentId: id === tileId ? null : tileId })),
        ),
    {
      name: "useHostTerminals.panes",
      equals: sameEach(
        (a: PaneSlot, b: PaneSlot) =>
          a.id === b.id && a.parentId === b.parentId,
      ),
    },
  );

  /** The same panes as bare ids — the key list both folds are keyed by, so a
   *  census that moved no pane re-runs no row. */
  const paneIds = createMemo(() => panes().map((pane) => pane.id), {
    name: "useHostTerminals.paneIds",
    equals: sameItems,
  });

  /** ONE ROW PER PANE — its live arm's port reading, or nothing at all for a
   *  pane that is sleeping, parked or still in flight. {@link foldEach} keeps
   *  each pane's record on its own row memo and the join at `1 + ⌈N / 128⌉`.
   *
   *  The reading is {@link plainPorts}-COPIED out of the projection record here,
   *  on the pane's own row memo, because the port join runs in its CONSUMER's
   *  scope: `PortRow`'s `<Show when={props.serving}>` memo and `tilePorts` read
   *  every candidate through {@link knownPorts}, and the record's `ports` proxy
   *  would charge those scopes a store leaf per pane for the `status` and
   *  another for the `list` — past the 200-source judge at about 40 panes. The
   *  copy keeps the known/unknown two-way, so a pane whose first scan has not
   *  landed still contributes nothing rather than asserting it serves nothing.
   *
   *  {@link samePorts} is the row gate the copy needs: a fresh object every
   *  recompute, compared by VALUE, so a pane that said the same thing keeps its
   *  row identity and the join below does not re-run. */
  const panePorts = foldEach(
    "useHostTerminals.panePorts",
    paneIds,
    (id) => {
      const arm = activeArm(store.getMetadata(id));
      return arm === undefined
        ? undefined
        : { id, ports: plainPorts(arm.ports) };
    },
    (a, b) => a.id === b.id && samePorts(a.ports, b.ports),
  );

  /** The panes a port may be attributed to, in pane order — the folded
   *  readings paired back with the tile each pane sits in. Two sources.
   *
   *  `parentId` here is the CONTAINING TILE (root), not the true one-hop
   *  parent — the port join returns the tile the user can activate. */
  const candidates = createMemo<readonly ServingCandidate[]>(
    () => {
      const held = new Map(panePorts().map((row) => [row.id, row.ports]));
      return panes().flatMap((pane) => {
        const ports = held.get(pane.id);
        return ports === undefined
          ? []
          : [{ id: pane.id, parentId: pane.parentId, ports }];
      });
    },
    {
      name: "useHostTerminals.candidates",
      equals: sameEach(
        (a: ServingCandidate, b: ServingCandidate) =>
          a.id === b.id && a.parentId === b.parentId && a.ports === b.ports,
      ),
    },
  );

  const printedBy = (tileId: TerminalId): ReadonlySet<number> =>
    new Set(store.getTilePaneIds(tileId).flatMap((id) => printedPortsOf(id)));

  /** ONE ROW PER PANE — the ports it printed a loopback URL for, copied out
   *  of the index into a plain array so the join below reads no store leaf of
   *  its own. `printedPortsOf` is a leaf per pane, which put the whole-host
   *  set past the judge at about 200 panes. A pane that printed nothing makes
   *  no row. */
  const panePrinted = foldEach(
    "useHostTerminals.panePrinted",
    paneIds,
    (id) => {
      const ports = printedPortsOf(id);
      return ports.length === 0 ? undefined : [...ports];
    },
    sameItems,
  );

  const printedOnHost = createMemo(
    () => {
      const all = new Set<number>();
      for (const ports of panePrinted())
        for (const port of ports) all.add(port);
      return all;
    },
    { name: "useHostTerminals.printedOnHost", equals: sameSet },
  );

  return {
    servingFor: (port) =>
      servingLink({
        port,
        candidates: candidates(),
        armOf: (id) => activeArm(store.getMetadata(id)),
        activate: (id) => store.activate(id),
      }),
    tilePorts: (tileId) =>
      foldPorts(
        candidates()
          .filter((c) => c.id === tileId || c.parentId === tileId)
          .flatMap((c) => knownPorts(c.ports)),
      ),
    printedBy,
    printedOnHost,
  };
}
