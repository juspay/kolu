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

import type { SleepingTerminal, TerminalId } from "kolu-common/surface";

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
 *  - `terminal` — a live terminal tile (PTY · xterm · agent).
 *  - `sleeping` — a frozen, PTY-released terminal that can still be focused,
 *    dragged, and resized like any tile. Its `record` carries the full
 *    `SavedTerminal` tree (so wake respawns it faithfully) plus the saved
 *    canvas layout the registry reads through `getLayout`.
 *  - `planned`  — later: a tile with only a future (activate → start fresh).
 *
 *  Adding a kind is one new arm here plus one new `<Match>`/`.with(...)` at each
 *  dispatch — the silo becomes unrepresentable. */
export type TileContent =
  | { kind: "terminal"; terminalId: TerminalId }
  | { kind: "sleeping"; record: SleepingTerminal };

/** Narrow a tile's content to one arm — the accessors a `<Switch>`/`<Match>`
 *  dispatch passes to `when`, so each `<Match>` body gets the arm's concrete
 *  type (not the union). Stable-boolean by construction (they key off `kind`),
 *  so the dispatch can't fall into the #989 remount trap that `match(freshObj)`
 *  would. Pure functions over the union — the single home for "is this tile a
 *  terminal / sleeping tile", reused by the canvas and dock. */
export const terminalContent = (c: TileContent | undefined) =>
  c?.kind === "terminal" ? c : undefined;
export const sleepingContent = (c: TileContent | undefined) =>
  c?.kind === "sleeping" ? c : undefined;
