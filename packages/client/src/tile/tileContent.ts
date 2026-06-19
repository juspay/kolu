/** The Tile model — identity + a content union — that the canvas, dock, and
 *  selection read through, so they stay agnostic to what a tile holds.
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
 *  is identified by that workspace-root terminal's id, and a future sleeping
 *  tile keeps the very same id (a slept terminal's record is keyed by its
 *  original id, so its canvas position, MRU rank, and active-selection carry
 *  over seamlessly). There is therefore no synthetic tile id to invent — what
 *  varies between tiles of the same id over time is their {@link TileContent},
 *  not their identity. The alias documents that intent without erecting a
 *  nominal wall the shared id space would only fight. */
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
export type TileContent = { kind: "terminal"; terminalId: TerminalId };

/** A first-class tile: stable identity plus the content it currently holds. */
export interface Tile {
  readonly id: TileId;
  readonly content: TileContent;
}
