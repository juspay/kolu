/** The Tile model — a stable identity ({@link TileId}) plus a content union
 *  ({@link TileContent}) — that the canvas, dock, and selection read through,
 *  so they stay agnostic to what a tile holds.
 *
 *  A first-class Tile separates tile PRESENCE (it exists, sits somewhere on the
 *  canvas, can be the active/focused tile, has a dock row) from terminal
 *  LIVENESS (PTY · xterm · agent · attach stream). Today every tile's content
 *  is a terminal; PR 2 adds a `sleeping` variant and PR 3+ a `planned` one —
 *  each a new arm of {@link TileContent}, never a parallel silo, so they inherit
 *  drag, resize, focus, active selection, dock ordering, and persistence for
 *  free from the content-agnostic machinery above. */

import type { TerminalId } from "kolu-common/surface";

/** A tile's stable identity.
 *
 *  Tiles and terminals share ONE id space: a tile whose content is a terminal
 *  is identified by that workspace-root terminal's id. A sleeping tile is keyed
 *  by the sleeping RECORD's id — and the id lifecycle is "transitions mint, never
 *  mutate" (the plan-of-record's immutable-records model): putting a terminal to
 *  sleep retires the active id and creates a sleeping record under a FRESH id, so
 *  the dormant tile is a new id, not the live terminal's. Its canvas position /
 *  MRU rank carry over because the sleeping record copies the persisted base
 *  (`canvasLayout`, `lastActivityAt`) from the active predecessor — NOT because
 *  the id is preserved — and `handleSleep` re-points the active selection at the
 *  new id. There is still no synthetic tile id to invent: what a tile holds is
 *  its {@link TileContent}, and a sleep swaps one tile (live id) for another
 *  (sleeping id) in a single merged-list update. The alias documents that the
 *  two id spaces are one without erecting a nominal wall they'd only fight. */
export type TileId = TerminalId;

/** What a tile currently holds. A discriminated union so every consumer
 *  dispatches on `kind` instead of branching on a tile's liveness:
 *
 *  - `terminal` — a live terminal tile (the only variant today).
 *  - `sleeping` — PR 2: a frozen, PTY-released terminal that can still be
 *    focused, dragged, and resized like any tile.
 *  - `planned`  — later: a tile with only a future (activate → start fresh).
 *
 *  Adding a kind is one new arm here plus one new `<Match>`/`.with(...)` at each
 *  dispatch — the silo becomes unrepresentable. */
export type TileContent =
  | { kind: "terminal"; terminalId: TerminalId }
  | { kind: "sleeping"; terminalId: TerminalId };
