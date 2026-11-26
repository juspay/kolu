/** Pending tile layouts — the bridge between local geometry intent
 *  (drag-end, resize-end, default-place, arrange) and server metadata
 *  echoes. Multiple consumers need access:
 *
 *  - `TerminalCanvas` reads pending in `layoutOf()`, drops entries for dead
 *    tiles via `deadIds`/`dropIds`, and flushes everything via `clear()` on its
 *    own unmount so a mobile↔desktop remount never carries stale entries
 *    forward.
 *  - `useCanvasArrange` seeds pending in `handleCanvasAutoArrange` so
 *    a follow-on `placeNew` (e.g. user opens a new worktree right
 *    after arrange) reads the arranged layouts in `existing` instead
 *    of the still-saved pre-arrange ones — the metadata round-trip
 *    hasn't completed yet.
 *
 *  AN OVERRIDE CARRIES WHAT THIS CLIENT AUTHORED. The store entry is just
 *  `{ layout }`; beside it, keyed by the same id, runs the tile's AUTHORED
 *  TRAIL: every value this client has COMMITTED for the tile — the base the
 *  first gesture was minted against, then each committed gesture a later one
 *  superseded. Only values that go on the wire (drag-end, resize commit,
 *  minimap commit, `applyMany`, `resetActiveTileSize`) join it; a preview
 *  frame replaces `layout` alone, because a value nobody sent can never echo.
 *  The override is released by its OWN echo — the flush whose saved value
 *  equals `layout`. A saved value from the trail is an earlier write of ours
 *  catching up, so the newest gesture keeps standing; anything else is
 *  FOREIGN (another client, or a server-side move) and wins immediately.
 *  Either way the release costs no pass: it happens in the flush that delivers
 *  the saved value, with nobody writing anything. The old design deleted the
 *  entry from an effect that had just READ it, so the release was a write
 *  relayed back into every layout consumer (the canvas's own `layoutOf`, the
 *  minimap's bounds, the centering resolver).
 *
 *  THE TRAIL IS NOT REACTIVE (the `claimedBy` convention below): the release
 *  that forgets it happens inside a READ, in the flush that delivers the echo,
 *  and a store write there would relay that read back into every layout
 *  consumer — the very second pass this design exists to avoid.
 *
 *  Singleton hook per `dev/skills/kolu-client/SKILL.md`'s "State per domain"
 *  rule. `createStore` (per the same rule, "use createStore over
 *  createSignal<Record> for keyed state") gives fine-grained per-key
 *  reactivity so a single `setOne` doesn't invalidate every consumer
 *  that reads a different key. */

import type { TerminalId } from "kolu-common/surface";
import { createStore, reconcile, untrack } from "solid-js";
import { layoutsEqual, type TileLayout } from "./TileLayout";

/** A local geometry intent. What it is judged against — the authored trail,
 *  and whether this layout is a preview frame or a commit — is side data
 *  (`authoredTrails`), not part of the entry: the entry is a store row, and a
 *  second field on it would replace the row's container on every preview frame
 *  for the one key that moved. See the note above. */
interface PendingEntry {
  readonly layout: TileLayout;
}

/** Layout equality that admits "no layout", so a base of `undefined` matches a
 *  saved value that hasn't arrived yet. */
function sameLayout(
  a: TileLayout | undefined,
  b: TileLayout | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return layoutsEqual(a, b);
}

// HOST-SCOPING: host-INDEPENDENT by design — keyed by globally-unique TerminalId
// (a transient drag-intent → server-echo bridge, cleared on canvas unmount), so a
// pending override applies to its own tile regardless of which host is shown, not
// durable per-host state.
const [pending, setPending] = createStore<Record<string, PendingEntry>>({});

// What this client has authored per tile, beside the store and NOT reactive
// (see the note above): the release that forgets a tile's trail runs inside
// `standingOverride`, a read. Keyed by the same ids as `pending` and emptied
// with them (`dropIds`, `clear`), so it cannot outlive the store.
//
// `values` are the COMMITTED layouts (the base the gesture was minted against
// at its head) — bounded by design: a preview frame does not extend it, and
// the trail is deleted the moment the override's own echo lands. `committed`
// says whether the entry's CURRENT layout went on the wire or is a live
// preview frame; a gesture that has not committed yet outranks any saved
// value, because the pointer is the newest intent there is.
interface AuthoredTrail {
  readonly values: (TileLayout | undefined)[];
  readonly committed: boolean;
}
const authoredTrails = new Map<string, AuthoredTrail>();

/** Test seam — how long a tile's authored trail is. Previews must leave it at
 *  the number of COMMITTED writes. Not part of the hook's surface; nothing in
 *  the app reads it. */
export function authoredTrailLength(id: string): number {
  return authoredTrails.get(id)?.values.length ?? 0;
}

// One-shot create-time geometry slot — a distinct lifecycle from the
// keyed `pending` store above. `pending` is keyed by tile id (which
// doesn't exist until the create RPC returns); this is the anonymous
// "next tile" size the canvas's default-placement derivation reads when
// assembling a brand-new tile's default layout. Kept as its own field (NOT a
// mode on the keyed store) so the keyed/released-when-the-echo-lands and the
// one-shot/claimed-once lifecycles don't complect.
//
// Why a slot and not a read at placement time: the placement derivation runs
// later (driven by the server's tile-list push) and only knows "here is a
// new tile with no layout" — it has no reliable handle on WHICH existing
// tile to inherit from once a create is in flight (the active id may have
// already moved to the new tile, and the previous active tile's visible
// size may still be settling). `handleCreate` is the one place that knows
// the source (active) tile at create time, so it snapshots the size into
// this slot BEFORE starting the RPC; the placement memo CLAIMS it for the new
// tile. Correctness depends only on that ordering (armed before the server
// push, claimed when a new tile appears) — NOT on the relative timing of
// `setActiveSilently` and the `tileIds` effect.
//
// The claim is stamped INTO the record (`claimedBy`) rather than taken out of
// it: the consumer is a memo, which may recompute, and a read-and-clear would
// hand the same tile a different size on the second run. With the claim as
// data the derivation is idempotent — the claiming tile keeps the size, every
// other tile gets the default, and the next create arms a fresh record.
//
// NOT reactive: nothing derives from the slot; it is set by the create flow
// before the tile it belongs to even exists, so it carries no edge to track.
// HOST-SCOPING: host-INDEPENDENT by design — a transient armed-once/claimed-once
// slot scoped to a single create flow (also nulled by `clear()` on canvas
// unmount), not durable per-host state.
let nextDefaultSize: { w: number; h: number; claimedBy: string | null } | null =
  null;

// E2e test hook — bounded ring of recent `applyMany` calls. Use
// instead of a snapshot getter on the live store: the snapshot races
// the `deadIds`/`dropIds` cleanup (under CI load the seeded window can be
// shorter than the polling interval), but the history survives. The
// fix for the worktree-after-arrange race is "applyMany is called
// synchronously inside the arrange handler"; the history records
// that call deterministically. See `kolu-common/test-hooks`.
//
// Capped at HISTORY_LIMIT: applyMany fires on every drag/resize/
// default-place/arrange, so a long-running session would otherwise
// accumulate one entry per gesture. The cap is large enough that any
// individual e2e step's writes survive within the same scenario,
// small enough that production sessions don't leak a growing array. */
const HISTORY_LIMIT = 32;
if (typeof window !== "undefined") {
  window.__koluPendingApplyHistory = [];
}

export function usePendingLayouts(): {
  /** COMMIT a single tile's pending override — a value that has gone (or is
   *  going) on the wire, stamped with the layout it was minted against (the
   *  value the echo will replace). Joins the tile's authored trail. */
  setOne: (
    id: TerminalId,
    layout: TileLayout,
    saved: TileLayout | undefined,
  ) => void;
  /** PREVIEW a single tile's pending override — a live gesture frame (resize
   *  `onMove`, minimap drag) that is NOT reported to the server. Replaces the
   *  standing layout without extending the authored trail: an unsent value can
   *  never echo, so recording it would only grow the trail per frame. The
   *  first frame of a gesture still mints the entry, so `saved` is the base it
   *  is judged against. */
  previewOne: (
    id: TerminalId,
    layout: TileLayout,
    saved: TileLayout | undefined,
  ) => void;
  /** Effective layout for a tile: a STANDING pending override wins over the
   *  echoed/saved layout; an override whose echo has landed does not. The
   *  single home for the "pending ⊕ saved" precedence — both the canvas
   *  `layoutOf` and `handleCreate`'s size-inheritance read go through this
   *  instead of re-deriving it. */
  resolveLayout: (
    id: TerminalId,
    saved: TileLayout | undefined,
  ) => TileLayout | undefined;
  /** Does a pending override still STAND for this tile (its echo not yet
   *  landed)? The resize release's "an earlier gesture's entry still
   *  commits" question. */
  hasOverride: (id: TerminalId, saved: TileLayout | undefined) => boolean;
  /** Bulk-apply pending overrides (used by arrange), each stamped with the
   *  tile's saved layout as its base. */
  applyMany: (
    layouts: Map<TerminalId, TileLayout>,
    saved: (id: TerminalId) => TileLayout | undefined,
  ) => void;
  /** Pending entries whose tile is gone — dead-tile hygiene, the only cleanup
   *  left now that a landed echo releases its own override. Reads the store
   *  UNTRACKED: the trigger is the tile set shrinking, and tracking `pending`
   *  here would relay the deletion back into every layout consumer. */
  deadIds: (alive: Set<TerminalId>) => TerminalId[];
  /** Drop the entries `deadIds` named. A write — effect phase only. */
  dropIds: (ids: readonly TerminalId[]) => void;
  /** Wipe all pending entries. Called on canvas unmount so a remount
   *  starts from a clean slate. */
  clear: () => void;
  /** Arm the one-shot create-time size slot. Called by `handleCreate`
   *  before the create RPC; `null` clears it (create failed → no server
   *  push to consume it). Separate from the keyed store. */
  setNextDefaultSize: (size: { w: number; h: number } | null) => void;
  /** Claim the one-shot create-time size FOR a tile, idempotently: the first
   *  tile to ask keeps it across re-runs, everyone else gets null. Called by
   *  the canvas's default-placement derivation. */
  claimNextDefaultSize: (id: TerminalId) => { w: number; h: number } | null;
} {
  /** The override as it STANDS: released by its own echo (the saved value has
   *  caught up with it) and by any FOREIGN saved value; held while the saved
   *  value is one this client authored earlier and a later gesture superseded,
   *  and held unconditionally while the gesture is still previewing.
   *
   *  The trail is consulted FIRST: it is the only mark that an entry was
   *  already released (the store entry itself is never deleted), so without
   *  that gate a released override would come back the moment the tile's
   *  layout was withdrawn, and stand forever.
   *
   *  The own-echo release FORGETS the trail. Without that, a saved value equal
   *  to an older authored value — the same tile pushed back to where it was,
   *  by another client or a revert — would read as "our earlier write catching
   *  up" and resurrect the released override, permanently. The forget is a Map
   *  delete, not a store write, so it costs no pass. */
  function standingOverride(
    id: TerminalId,
    saved: TileLayout | undefined,
  ): TileLayout | undefined {
    const entry = pending[id];
    if (!entry) return undefined;
    // No trail: this entry was already released by its own echo. Nothing
    // revives it — not even the saved layout going away again.
    const trail = authoredTrails.get(id);
    if (!trail) return undefined;
    // A gesture in progress. Nothing this client has sent can be waiting for
    // this value, so there is no echo to release it and no foreign value that
    // outranks the pointer: it stands until its commit, as on master.
    if (!trail.committed) return entry.layout;
    if (sameLayout(saved, entry.layout)) {
      authoredTrails.delete(id);
      return undefined;
    }
    // No saved layout at all: nobody authored "nothing", so there is no
    // foreign value to lose to. The gesture stands — this is a brand-new tile
    // whose first layout (the default this canvas derived, the base the
    // gesture was minted against) has not echoed yet.
    if (saved === undefined) return entry.layout;
    return trail.values.some((own) => sameLayout(saved, own))
      ? entry.layout
      : undefined;
  }

  /** Mint (or extend) an entry. `commit` says whether the layout went on the
   *  wire: a committed value joins the authored trail, a preview frame only
   *  replaces the standing layout. Either way the trail keeps the base the
   *  first frame of the gesture was minted against at its head. */
  function mint(
    draft: Record<string, PendingEntry>,
    id: TerminalId,
    layout: TileLayout,
    saved: TileLayout | undefined,
    commit: boolean,
  ): void {
    const values = authoredTrails.get(id)?.values ?? [saved];
    authoredTrails.set(id, {
      values: commit ? [...values, layout] : values,
      committed: commit,
    });
    draft[id] = { layout };
  }

  return {
    setOne(id, layout, saved) {
      setPending((draft) => {
        mint(draft, id, layout, saved, true);
      });
    },
    previewOne(id, layout, saved) {
      setPending((draft) => {
        mint(draft, id, layout, saved, false);
      });
    },
    resolveLayout(id, saved) {
      return standingOverride(id, saved) ?? saved;
    },
    hasOverride(id, saved) {
      return standingOverride(id, saved) !== undefined;
    },
    applyMany(layouts, saved) {
      setPending((draft) => {
        for (const [id, layout] of layouts)
          mint(draft, id, layout, saved(id), true);
      });
      if (typeof window !== "undefined") {
        const history = window.__koluPendingApplyHistory;
        if (history) {
          history.push([...layouts.keys()]);
          if (history.length > HISTORY_LIMIT) history.shift();
        }
      }
    },
    deadIds(alive) {
      const ids: TerminalId[] = [];
      // Untracked: the alive set is the edge this answers to; tracking the
      // store's keys would make the deletion below a write into a read.
      for (const id of untrack(() => Object.keys(pending)) as TerminalId[])
        if (!alive.has(id)) ids.push(id);
      return ids;
    },
    dropIds(ids) {
      // Steady state is nothing to drop — skip the draft write (and the
      // invalidation it would cost) on every effect tick.
      if (ids.length === 0) return;
      setPending((draft) => {
        for (const id of ids) delete draft[id];
      });
      for (const id of ids) authoredTrails.delete(id);
    },
    clear() {
      // `null` key: positional reconcile. The value is `{}`, so every entry
      // goes regardless — and the entries are layouts with no identity field,
      // so there is nothing to match rows by.
      setPending(reconcile({}, null));
      authoredTrails.clear();
      // The one-shot size slot is part of the same cleanup contract: a
      // canvas unmount wipes the keyed pending AND any size armed but not
      // yet claimed, so a remount can't have a stale create-time size
      // leak into the next new tile.
      nextDefaultSize = null;
    },
    setNextDefaultSize(size) {
      nextDefaultSize = size ? { ...size, claimedBy: null } : null;
    },
    claimNextDefaultSize(id) {
      const armed = nextDefaultSize;
      if (!armed) return null;
      if (armed.claimedBy === null) armed.claimedBy = id;
      else if (armed.claimedBy !== id) return null;
      return { w: armed.w, h: armed.h };
    },
  };
}
