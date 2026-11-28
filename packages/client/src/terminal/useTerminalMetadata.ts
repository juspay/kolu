/** Terminal metadata — subscriptions for server-derived state.
 *
 *  One subscription per terminal: metadata (slow-changing state — CWD,
 *  git, PR, agent status). Each event replaces the previous; only
 *  current state matters.
 *
 *  Terminal IDs are derived from the live list subscription data. Order
 *  is the server's Map insertion order (terminal creation order) — no
 *  client-side sort, no per-terminal ordering field.
 *
 *  Per-terminal subscriptions are managed by `useCollection` from
 *  `@kolu/surface/solid` — the framework's `mapArray`-backed lifecycle
 *  creates a reactive owner per terminal ID and disposes it when the
 *  terminal leaves the list. No manual Map, AbortController, or version
 *  signals needed at this call site. */

import {
  isParkedTerminal,
  type TerminalMetadata,
  tileTerminalOf,
} from "@kolu/padi-client/surface";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createMemo,
  createProjection,
  mapArray,
} from "solid-js";
import { sameFields } from "../conductor/sameItems";
import { activeScope } from "../hostScope/hostScopes";
import { foldEach } from "@kolu/surface/solid";
import { activeHost, padiMap } from "../wire";
import { reprojectTerminalClock } from "./reprojectClock";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayEntry,
  type TerminalDisplayInfo,
} from "./terminalDisplay";
import {
  containingTileOf,
  descendantsByRoot,
  type PaneNode,
  paneTreeOf,
  type ParentEdge,
  rootAncestorOf,
} from "./terminalTree";

/** Where one listed record stands: not yet yielded, a parked restore-card row,
 *  or an active|sleeping tile. One row of the tri-state census. */
type RecordPhase = "awaited" | "parked" | "live";

/** One terminal's parent edge, carried with its id so the pure tree walks can
 *  run over the joined list. `parent` is `undefined` for an absent or parked
 *  record, `null` for a root, else the parent's id. */
interface ParentRow {
  readonly id: TerminalId;
  readonly parent: TerminalId | null | undefined;
}

/** Whether two top-level terminal-id lists are identical — the same ids in the
 *  same order. Serves as the `equals` gate on the `terminalIds` memo below: a
 *  metadata change that leaves the *set* of top-level terminals untouched (the
 *  common case — a git / PR / agent field updating on one terminal) keeps the
 *  prior array reference, so `terminalIds()` stops *notifying* downstream when
 *  the set is unchanged. That spares dependants that key off the reference the
 *  spurious recompute non-display writes (PR / agent / foreground) used to
 *  trigger; display-relevant changes (git / cwd / parentId) still re-run
 *  `displayInfos` via its own field-level subscriptions, as they should. This is
 *  the reactivity keystone of the performance map
 *  (`docs/atlas/.../performance.mdx`). Order is significant — it drives sidebar
 *  position labels — so a reorder must invalidate. A bounded-algorithm leaf,
 *  deliberately domain-specific to terminal ids rather than a generic
 *  array-equality receptacle. */
export function sameTerminalIdOrder(
  a: readonly TerminalId[],
  b: readonly TerminalId[],
): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Whether a composed record is a PARKED restore-pending record (W1.R6) — a
 *  genuine type-guard over padi's honest 3-arm `PadiTerminal` union, not a widened
 *  cast. padi's boot reconcile parks each reboot-killed active terminal so
 *  `session.restore` can re-spawn it; a parked record rides the `terminals`
 *  collection but must NOT render as a canvas tile — it is a restore-card row, not
 *  a live/dormant tile. Excluding it here keeps the canvas EMPTY while a reboot's
 *  session awaits restore, so the restore card shows (byte-identical to the pre-R6
 *  registry-empty restore-pending state).
 *
 *  Reads the `state` discriminant directly on the wire type (`PadiTerminal` =
 *  `active | sleeping | parked`), so the narrowing is SOUND — no `(m as { state })`
 *  cast. `getMetadata` below is its ONE caller: it narrows padi's 3-arm wire union
 *  down to the honest 2-arm `TerminalMetadata` every tile consumer expects,
 *  collapsing a parked record to `undefined`.
 *
 *  The guard itself is `@kolu/padi-client`'s now, not this file's. It was
 *  declared here — privately — and that turned out to be the whole obstacle for
 *  an out-of-repo consumer holding the same three-arm union off the same wire:
 *  it had no sound way past the parked arm and no exported narrowing to reach
 *  for, so the row folds simply would not accept its records. A narrowing of
 *  padi's wire union belongs beside the union, next to `activePadiTerminal`
 *  which had already been exported for exactly this reason. Re-exported here so
 *  this module stays the one door the client's own callers already knock on. */
export { isParkedTerminal as isParked } from "@kolu/padi-client/surface";

/** Reproject the record's padi-host-stamped epochs onto THIS browser's clock at the
 *  ingestion BOUNDARY — via the ACTIVE host's measured `clockOffset` — so no downstream
 *  consumer ever subtracts a raw remote epoch from the local clock (the foreign-clock
 *  fence, applied ONCE here rather than per-consumer, so nothing is translated twice).
 *  The THREE padi-stamped epochs a tile consumer renders against `Date.now()` are:
 *  `lastActivityAt` (top-level, optional — staleness/recency), the ACTIVE arm's
 *  `agent.startedAt` (the "Running for" duration), and the SLEEPING arm's `sleptAt` (the
 *  "asleep 3d" line + dock recency). (`adoptedAt` rides the daemon status, not a tile,
 *  and is a monotonic host-to-host dedup key — never compared to the browser clock — so
 *  it stays raw there; `parkedAt` lives only on the parked arm this boundary narrows out.)
 *  A null offset (host still warming, no offset measured yet) maps each epoch to its
 *  ABSENT form — `lastActivityAt` → undefined, `agent.startedAt`/`sleptAt` → 0 — every
 *  one of which consumers already render as "unknown", never the raw value.
 *
 *  MODULE-PRIVATE (not exported, and the ONLY caller is the metadata projection's
 *  per-id projection in `useTerminalMetadata`). It mints a FRESH object and reads the
 *  active host's clock reactively — correct behaviour INSIDE the projection, where
 *  `reconcile` collapses an unchanged reprojection back to a stable reference. Calling
 *  it from any other tracking scope would reintroduce #1714's per-call identity churn,
 *  which is why the value read path funnels through `getMetadata` alone. */

/** A tile with no splits — the common case, and the SAME array every time so
 *  a consumer keyed on the reference (a memo over `getSplitPaneIds`) doesn't
 *  see a fresh empty array on every read. Never mutated; neither are the
 *  index's own lists. */
const NO_SUB_IDS: TerminalId[] = [];

/** Same stable-reference contract for the nested shape. */
const NO_PANE_NODES: PaneNode[] = [];

/** Merge one freshly built display row into the row standing in the projection's
 *  draft, LEAF BY LEAF — never `draft[id] = row`.
 *
 *  The store tracks leaves: a row written whole makes every reader under that id
 *  re-run for the one field that moved, and hands the row a new reference. That is
 *  the #1714 shape one level down — a split opening under a tile (`subCount`)
 *  would repaint its colours and its identity key, and a `<For>` keyed on the row
 *  would rebuild it. Assigned only where the two differ, so a rebuild that changes
 *  nothing — the common case, since every metadata tick re-derives the whole table
 *  — touches no node at all and this stays the no-op it was.
 *
 *  TOTAL over the row's keys, in both directions, which is what the whole-row
 *  write it replaces was for free: a field this merge did not know about would
 *  otherwise never reach the store, and a field the fresh row DROPS (the
 *  collision `suffix`, once the collision is gone) would stand forever. Nested
 *  containers recurse rather than being replaced — `key` is the one today — so a
 *  reader of one of their leaves is woken only by that leaf. */
export function mergeDisplayInfo<T extends object>(into: T, next: T): void {
  for (const key of Object.keys(next) as (keyof T)[]) {
    const fresh = next[key];
    const held = into[key];
    if (isPlainBranch(fresh) && isPlainBranch(held)) {
      mergeDisplayInfo(held, fresh);
      continue;
    }
    if (held !== fresh) into[key] = fresh;
  }
  for (const key of Object.keys(into) as (keyof T)[])
    if (!(key in next)) delete into[key];
}

/** A value this merge recurses INTO rather than assigns: a plain object. An
 *  array, a `Date` or a class instance is one value, and is replaced whole. */
function isPlainBranch(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function useTerminalMetadata(deps: {
  list: Accessor<readonly TerminalId[] | undefined>;
}) {
  // W1.R1: a terminal's record is served ALREADY COMPOSED. padi's `terminals`
  // collection folds the two halves that share the one registry entry — the
  // AUTHORED record (location + client chrome + the active|sleeping discriminant)
  // and the GENERIC AWARENESS value (the sensor fields) — server-side via
  // `composeTerminalMetadata` (the ONE join, shared with disk persist
  // `snapshotSession`). The client's former reader-join collapsed to this single
  // read; there is no client-side re-fusion. R9 (remote snapshots) swaps the
  // snapshot backing remote-side behind the server compose with no change here.
  //
  // THE ONE COPY of the collection's key array, and it is a `mapArray`: the
  // list a per-key collection serves is a store PROXY, so iterating it in user
  // code costs `length` plus an index leaf per terminal, on whichever scope
  // does the iterating — 197 panes to `WIDE_SCOPE_DEPS`, on every consumer
  // that re-derived its own copy. `mapArray` reads the container and walks the
  // backing raw, which is two sources flat; from here down every `keys()` fold
  // is reading a plain array and costs one.
  const keys = mapArray(
    () => deps.list() ?? [],
    (id) => id,
    { name: "useTerminalMetadata.keys" },
  );
  // The composed `terminals` collection now RIDES the active host's RETAINED per-host
  // owner (`activeScope().wire.terminals`, W9) — opened once per host in `createHostWire`
  // and held across switch-away — instead of a `useEntry(activeHost)` re-key HERE that
  // reopened it from pending on every switch. This hook stays the app-lifetime metadata
  // WINDOW: it layers the identity-stable projection (below) on whichever host is active,
  // so a switch-BACK reads the held records in one frame (no pending window). A function
  // (not a bound handle): `activeScope()` re-keys on switch and is briefly `undefined`
  // during the removal race — a tick where the projection reads an empty collection,
  // exactly as the pre-W9 pending sub read empty.
  const terminals = () => activeScope()?.wire.terminals;

  // padi's `terminals` collection is typed `PadiTerminal` — a 3-arm union:
  // `active | sleeping | PARKED`, each carrying the reserved cross-host `host` axis
  // (never populated on a single-host canvas). A PARKED record is a restore-card
  // row, NEVER a tile (W1.R6's boot reconcile produces it), so it is narrowed out
  // HERE — via the sound `isParked` type-guard, NOT a cast — leaving the honest
  // 2-arm `TerminalMetadata` (`active | sleeping`) the ~20 tile consumers expect.
  // This is the ONE type bridge where the padi wire shape meets the client's domain
  // type.
  //
  /** A terminal's composed TILE record — the identity-stable REPROJECTED record,
   *  read through the per-id projection (below). `undefined` until the
   *  server-composed record has arrived, AND `undefined` for a PARKED record (a
   *  restore-card row, not a tile). Reactivity comes from the keyed `slots[id]`
   *  read (re-subscribes when this id's projection lands) plus the projection's
   *  reconciled `store.v` — so a leaf reader (`meta.git.repoRoot`) tracks that leaf
   *  and is notified ONLY when its value changes, never on an incidental reproject
   *  to an unchanged value (the #1714 flicker fix). The ORDERING filters read the
   *  clock-free `rawTile` instead (see its doc), not this reprojected path. */
  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    return slots[id]?.read();
  }

  // --- The metadata projection: identity-stable reprojected records ---
  //
  /** Per-id reconcile-backed projection: `id → { read }`, where `read()` is the
   *  reprojected record `getMetadata` returns. One `createProjection` per live
   *  terminal reprojects its raw record into a per-id `{ v }` store. A
   *  projection commits its draft through Solid's reconcile channel, so
   *  `store.v`'s proxy stays STABLE across the record's continuous lifetime —
   *  a changed field mutates the proxy in place and notifies only that leaf
   *  (the `useTerminalMetadata.test.ts` `lastActivityAt` case). The reference
   *  turns over only around absence/recreation: `undefined ⇄ record`, or a
   *  structural swap `reconcile` can't merge in place. `key: null` is the same
   *  undeclared-merge rule `writeWrappedValue` applies to every subscription
   *  value: an array element is REPLACED rather than recycled, so no object is
   *  ever carried across records.
   *
   *  This restores an identity-stability GUARANTEE at the one knowing endpoint.
   *  #1714 broke it by having `getMetadata` return a fresh reprojected object
   *  per call (reactive on the active host's clock) so every observation
   *  manufactured a spurious "new value"; a consumer keyed on the reference
   *  (the `active` memo → `repoPath()` → the Code tab) then remounted on every
   *  incidental `lastActivityAt`/`agent`/clock tick (the right-panel flicker).
   *  With the projection, consumers reading `meta.git.…` track that leaf again
   *  and are notified only on a real value change.
   *
   *  `slots` is a keyed PROJECTION (not a plain Map) so `getMetadata`'s
   *  `slots[id]` read re-subscribes when THIS id's projection is created or
   *  removed WITHOUT tracking the whole membership — adding an unrelated
   *  terminal (a split) never notifies `slots[otherId]` readers, so `active`
   *  doesn't churn on split-add. `mapArray` gives each live id a reactive owner
   *  disposed when it leaves the set, and the table's own derive is what adds
   *  and drops its key — no slot writes from inside a mapped owner.
   *
   *  Both projections are PULLED, which is what keeps the old eager drive
   *  honest without one: `getMetadata` is read in the same tick this is set up
   *  (the `active` memo on first render, and the hook's own `displayInfos` /
   *  `isWorktreeShared`), and a read computes the table and the per-id record
   *  right there rather than waiting for a queue. In-repo precedent for the
   *  shared-reprojection remedy: `HostDaemonChips` `daemon()`. */
  interface MetadataSlot {
    readonly id: TerminalId;
    readonly read: Accessor<TerminalMetadata | undefined>;
    readonly parent: Accessor<TerminalId | null | undefined>;
  }
  const slotList = mapArray(keys, (id): MetadataSlot => {
    // Reprojects on every change of this id's raw record OR the active host's
    // clock. Sole write path for reprojected metadata — the fresh-object read
    // path is unspellable elsewhere.
    //
    // The derive RETURNS its value; it does not assign it into a draft. That is
    // what buys the identity stability below: a returned value is committed
    // through Solid's reconcile channel (merged into the live store, leaf by
    // leaf), whereas assigning a fresh object to a draft KEY replaces that key's
    // value wholesale — a new proxy per reprojection, and every leaf reader woken
    // (the #1714 flicker, exactly).
    const projected = createProjection<{ v: TerminalMetadata | undefined }>(
      () => {
        const record = rawTile(id);
        return {
          v:
            record === undefined
              ? undefined
              : reprojectTerminalClock(
                  padiMap.entry(activeHost()).clock.toLocal,
                  record,
                ),
        };
      },
      null,
      { key: null },
    );
    const parent = createMemo(() => {
      const tile = rawTile(id);
      return tile === undefined ? undefined : (tile.parentId ?? null);
    });
    return { id, read: () => projected.v, parent };
  });
  const slots = createProjection<Record<TerminalId, MetadataSlot>>(
    (draft) => {
      const live = slotList();
      for (const slot of live)
        if (draft[slot.id] !== slot) draft[slot.id] = slot;
      const ids = new Set(live.map((slot) => slot.id));
      for (const id of Object.keys(draft) as TerminalId[])
        if (!ids.has(id)) delete draft[id];
    },
    {},
    { key: null },
  );

  /** The RAW composed tile record — presence + the parked-narrow, with NO clock
   *  reprojection. The ORDERING filters (`terminalIds`/`getSplitPaneIds`) read `parentId`
   *  + presence off THIS, both clock-free, so the #1422 order-reference stability is not
   *  perturbed by `reprojectClock`'s activeHost/offset read + fresh-object-per-call (which
   *  only the value-reading `getMetadata` needs). */
  function rawTile(id: TerminalId): TerminalMetadata | undefined {
    const record = terminals()?.byKey(id)?.();
    return tileTerminalOf(record);
  }

  /** The tri-state census of the listed terminals' composed records, counted from
   *  the RAW `terminals.byKey` read — BEFORE `getMetadata`'s parked-collapse folds
   *  "not yet arrived" and "arrived-but-parked" into one `undefined`. That collapse
   *  is right for tile consumers (neither is a tile) but destroys the bit the
   *  empty-vs-loading decision needs: on a browser RELOAD the live records are merely
   *  in flight (→ keep loading, `awaited > 0`), whereas on a genuine REBOOT they
   *  arrive PARKED (→ show the restore card, `awaited === 0 && live === 0`).
   *  `terminalIds().length === 0` alone can't tell the two apart; this census keeps
   *  the states distinct so `resolveCanvasMode` owns the choice.
   *
   *  Read ONE RECORD AT A TIME. Counting the fleet on one scope subscribes
   *  that scope to every listed record, which Solid's development build
   *  judges `WIDE_SCOPE_DEPS` past 200 sources — about 70 panes here, since a
   *  record read costs two nodes before any field. So each id's phase is its
   *  own row memo ({@link foldEach}), the rows are joined in chunks, and the
   *  three counts are a fold over the JOINED list: one source, for any fleet.
   *  The per-row subscription is the same fine-grained one — no polling, no
   *  effect: a row re-runs as its key yields. Arms:
   *    - `awaited` — record not yet yielded (`byKey(id)?.()` undefined). An id absent
   *      from the collection reads undefined too, and counts as awaited (correct — we
   *      wait it out rather than treat it as settled).
   *    - `parked`  — arrived as a restore-card row (`isParked`).
   *    - `live`    — arrived as an active|sleeping tile.
   *  Over an EMPTY `keys()` all three are 0 — trivially settled; the loading gate then
   *  falls through to the saved-session cell for the genuinely-empty boot.
   *
   *  HAZARD: a record whose per-key stream WEDGES without erroring stays `awaited`
   *  forever, holding the canvas on `connecting` while `terminalIds()` is 0. There is
   *  deliberately NO timeout knob (fail-fast doctrine): the floor is
   *  `CanvasFacts.channelLive` (watchdog-backed ws ∧ the active entry) — a LIVE channel
   *  with a never-composing record is a padi/compose BUG that must surface loudly, not a UI
   *  state to tune around. */
  const recordPhaseRows = foldEach(
    "useTerminalMetadata.recordPhase",
    keys,
    (id): RecordPhase => {
      const record = terminals()?.byKey(id)?.();
      if (record === undefined) return "awaited";
      return isParkedTerminal(record) ? "parked" : "live";
    },
  );
  const recordPhases = createMemo(
    () => {
      let awaited = 0;
      let parked = 0;
      let live = 0;
      for (const phase of recordPhaseRows()) {
        if (phase === "awaited") awaited++;
        else if (phase === "parked") parked++;
        else live++;
      }
      return { awaited, parked, live };
    },
    // Three counts, minted fresh on every census tick. Most ticks move a
    // record's fields without moving any count, and the loading gate above
    // this must not re-decide for that.
    {
      name: "useTerminalMetadata.recordPhases",
      equals: (a, b) =>
        a.awaited === b.awaited && a.parked === b.parked && a.live === b.live,
    },
  );

  // --- Order: server Map insertion order, filtered by parent relationship ---

  /** Live parent edge for the pure tree walks (`rootAncestorOf` /
   *  `descendantsByRoot`). Raw (not reprojected): only `parentId` + presence,
   *  both clock-free. `undefined` when the id is absent or parked so a dangling
   *  parentId cannot invent a fake root.
   *
   *  EXPORTED as the one edge every walk in the app runs on. A hook that builds
   *  its own `getMetadata(id)?.parentId ?? null` collapses "absent" into "root",
   *  and the walk then climbs THROUGH a departed ancestor and answers with a
   *  dead tile — chrome keyed on a terminal that is gone. There is one edge
   *  because there is one census. */
  function parentEdge(id: TerminalId): TerminalId | null | undefined {
    return slots[id]?.parent();
  }

  /** EVERY listed terminal's parent edge, one row memo per id. A row tracks
   *  its own `slots[id]` and that slot's `parent` memo and nothing else, so
   *  the whole census is `1 + ⌈N / 128⌉` sources on the join rather than two
   *  per terminal on each of the three walks below ({@link foldEach}). The
   *  walks themselves need no reactivity at all: they are pure functions of
   *  these edges, so {@link census} runs them over the JOINED list. */
  const parentRows = foldEach(
    "useTerminalMetadata.parentEdge",
    keys,
    (id): ParentRow => ({ id, parent: parentEdge(id) }),
    (a, b) => a.id === b.id && a.parent === b.parent,
  );

  /** The three shapes of ONE membership fact — which terminals are tiles,
   *  which panes hang under each tile, and the same panes nested by their true
   *  parent — walked together from the joined edges. ONE source: the walks
   *  read the edge out of a plain `Map`, never off the store, so adding a
   *  terminal cannot widen this scope. Publishing the three together is also
   *  what keeps them one fact: a surface that walks the parent edge itself is
   *  how a split of a split came to exist in the roster while no surface gave
   *  it a row. */
  const census = createMemo(
    () => {
      const rows = parentRows();
      const edges = new Map<TerminalId, TerminalId | null | undefined>(
        rows.map((row) => [row.id, row.parent]),
      );
      // Total, exactly as `parentEdge` is: an id the census does not hold
      // reads `undefined` (absent / parked), so a dangling parentId cannot
      // invent a fake root.
      const edgeOf: ParentEdge = (id) => edges.get(id);
      const ids = rows.map((row) => row.id);
      const splits = descendantsByRoot(ids, edgeOf);
      // A terminal with no resolvable root (cycle, or parentId dangling at a
      // missing node) paints as top-level too — otherwise it would fall out of
      // both this set and every root's flat split list, which is the exact
      // invisibility bug #2059 is about. True descendants of a live root stay
      // out; an absent or parked record is no tile at all.
      const topLevel = ids.filter((id) => {
        if (edges.get(id) === undefined) return false;
        const root = rootAncestorOf(id, edgeOf);
        return root === id || root === null;
      });
      const panes = new Map<TerminalId, PaneNode[]>(
        [...splits].map(([rootId, flat]) => [
          rootId,
          paneTreeOf(rootId, flat, edgeOf),
        ]),
      );
      return { topLevel, splits, panes };
    },
    { name: "useTerminalMetadata.census" },
  );

  /** Top-level terminal IDs in server-provided order.
   *  Terminals whose metadata hasn't arrived yet are excluded (still loading).
   *
   *  The `equals` gate keeps the prior array reference whenever a metadata
   *  change leaves the top-level id set unchanged (the common case), so
   *  dependants keyed off the reference skip the no-op recompute an unchanged
   *  set would otherwise trigger — the reactivity keystone of the performance
   *  map. The accessor re-runs cheaply on each membership change; what it no
   *  longer does is *notify* downstream when the set is identical. */
  const terminalIds = createMemo<TerminalId[]>(() => census().topLevel, {
    name: "useTerminalMetadata.terminalIds",
    equals: sameTerminalIdOrder,
  });

  /** Every descendant of a root tile, flattened, in server-provided order.
   *
   *  The canvas paints these as the tile's split tab strip — a grandchild looks
   *  like a direct child; no indent, no breadcrumb. A root whose list did not
   *  change keeps the ARRAY it had, so a consumer keyed on the reference (the
   *  tab strip, the split badge) sleeps through a census that moved another
   *  tile. */
  const splitsByRoot = createMemo<Map<TerminalId, TerminalId[]>>(
    (prev) => {
      const next = new Map(census().splits);
      for (const [id, ids] of next) {
        const old = prev?.get(id);
        if (old && sameTerminalIdOrder(old, ids)) next.set(id, old);
      }
      return next;
    },
    { name: "useTerminalMetadata.splitsByRoot" },
  );

  /** The SAME panes, re-shaped into the true parent→child tree the Dock
   *  indents — built in {@link census} from the flat lists, never from a second
   *  walk of `parentId`. Membership is therefore one fact with two shapes: the
   *  flat strip the canvas paints and the tree the Dock lists always cover the
   *  same terminals. */
  const paneTreesByRoot = createMemo<Map<TerminalId, PaneNode[]>>(
    () => census().panes,
    { name: "useTerminalMetadata.paneTreesByRoot" },
  );

  /** Flat split-pane ids for a canvas tile (every descendant under its root).
   *  Server order. Read-only — the index's own array. */
  function getSplitPaneIds(rootId: TerminalId): TerminalId[] {
    return splitsByRoot().get(rootId) ?? NO_SUB_IDS;
  }

  /** The same panes as `getSplitPaneIds`, nested by their true parent edge —
   *  what the Dock indents. Read-only — the index's own nodes. */
  function getPaneTree(rootId: TerminalId): readonly PaneNode[] {
    return paneTreesByRoot().get(rootId) ?? NO_PANE_NODES;
  }

  /** The canvas TILE that owns `id` — the root of its parent chain, or `id`
   *  itself when it is a root, a cycle member, or an orphan. TOTAL on purpose:
   *  the unresolvable cases are exactly the ones `terminalIds` paints as
   *  top-level tiles, so answering `null` here made each consumer re-decide
   *  what an orphan is, and they disagreed — one fell back to the true parent
   *  and keyed a tile's sub-panel chrome on a middle node that owns no panel.
   *  Used by focus, the WebGL budget, and adopt so chrome keyed on the tile
   *  (not the true parent edge) stays right for nested splits. */
  function containingTile(id: TerminalId): TerminalId {
    return containingTileOf(id, parentEdge);
  }

  /** The PANES of a tile — its root plus its flat splits, in server order.
   *
   *  A tile is ONE thing to the user and SEVERAL PTYs to the daemon, so every
   *  surface that speaks about "this terminal" in the user's sense reads this:
   *  the Attach section's command list, the Ports section (a dev server started
   *  in a split is the default case, not the exotic one — observed on a real
   *  deployment), and PRT2's forwarded-port group. Stated here once, beside the
   *  parent/child relation the store already owns, rather than re-derived with a
   *  fresh explanatory comment at every call site. Nested descendants count —
   *  the canvas flattens them into this tile's pane set. */
  function getTilePaneIds(tileId: TerminalId): TerminalId[] {
    return [tileId, ...getSplitPaneIds(tileId)];
  }

  /** True if any terminal outside of `excludeId`'s tree is also on
   *  `worktreePath`. Callers use this to decide whether removing the
   *  worktree would yank it out from under a live terminal.
   *
   *  A nested descendant of a different top-level must also count: its git
   *  metadata is derived from its own CWD and it survives when
   *  `excludeId` dies. */
  function isWorktreeShared(
    worktreePath: string,
    excludeId: TerminalId,
  ): boolean {
    const onWorktree = (id: TerminalId) => {
      // A terminal whose git is `none` or `unresolved` is on no worktree.
      const git = getMetadata(id)?.git;
      return git?.kind === "repo" && git.info.worktreePath === worktreePath;
    };
    return terminalIds().some((otherId) => {
      if (otherId === excludeId) return false;
      return onWorktree(otherId) || getSplitPaneIds(otherId).some(onWorktree);
    });
  }

  // --- Derived accessors ---

  /** ONE TILE'S IDENTITY PROJECTION — the canonical `(group, label)` pair for
   *  its record, plus the flat descendant count the split badge shows (what
   *  the canvas tab strip covers, not the one-hop parent edge).
   *
   *  Per id, because `git` and `cwd` are store leaves: projecting the fleet on
   *  one scope subscribes it to every tile's git fact, which Solid's
   *  development build judges `WIDE_SCOPE_DEPS` past 200 sources — about 30
   *  tiles. A row holds its own record's leaves; what the table below reads is
   *  the joined list of PLAIN strings, so the collision pass that needs every
   *  tile at once costs one source. */
  const displayEntries = foldEach(
    "useTerminalMetadata.displayEntry",
    terminalIds,
    (id): TerminalDisplayEntry | undefined => {
      const meta = getMetadata(id);
      if (meta === undefined) return undefined;
      const { group, label } = terminalKey(meta);
      return { id, group, label, subCount: getSplitPaneIds(id).length };
    },
    sameFields,
  );

  /** The display table, derived per id. A projection rather than a store a
   *  rule writes: the derive's `draft` IS the previous table (its reads are
   *  not tracked, so diffing against it takes no untracking), and the commit
   *  touches only the LEAVES that moved — a tile whose row is unchanged
   *  notifies nobody, and a tile whose split count moved notifies the readers
   *  of that count alone ({@link mergeDisplayInfo}). A row arriving for the
   *  first time is the one write that assigns: there is nothing to merge into. */
  const displayInfos = createProjection<Record<string, TerminalDisplayInfo>>(
    (draft) => {
      const next = buildTerminalDisplayInfos(displayEntries());
      for (const id of Object.keys(draft)) if (!next.has(id)) delete draft[id];
      for (const [id, value] of next) {
        const row = draft[id];
        if (row === undefined) draft[id] = value;
        else mergeDisplayInfo(row, value);
      }
    },
    {},
    { key: null },
  );

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos[id];
  }

  /** Human-readable label for a terminal by its sidebar position. */
  function terminalLabel(id: TerminalId): string {
    const pos = terminalIds().indexOf(id) + 1;
    return pos > 0 ? `Terminal ${pos}` : "Terminal";
  }

  return {
    getMetadata,
    recordPhases,
    terminalIds,
    getSplitPaneIds,
    getPaneTree,
    containingTile,
    parentEdge,
    getTilePaneIds,
    isWorktreeShared,
    getDisplayInfo,
    terminalLabel,
  };
}
