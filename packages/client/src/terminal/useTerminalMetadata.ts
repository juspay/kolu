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

import type {
  PadiParkedTerminal,
  PadiTerminal,
  TerminalMetadata,
} from "@kolu/padi/surface";
import { writeWrappedValue } from "@kolu/surface/solid";
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createComputed,
  createMemo,
  mapArray,
  onCleanup,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { activeScope } from "../hostScope/hostScopes";
import { reprojectTerminalClock } from "./reprojectClock";
import { activeHost, padiMap } from "../wire";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";
import { descendantsByRoot, rootAncestorOf } from "./terminalTree";

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
 *  collapsing a parked record to `undefined`. */
export function isParked(m: PadiTerminal): m is PadiParkedTerminal {
  return m.state === "parked";
}

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
 *  per-id computed in `useTerminalMetadata`). It mints a FRESH object and reads the
 *  active host's clock reactively — correct behaviour INSIDE the projection, where
 *  `reconcile` collapses an unchanged reprojection back to a stable reference. Calling
 *  it from any other tracking scope would reintroduce #1714's per-call identity churn,
 *  which is why the value read path funnels through `getMetadata` alone. */

/** A parent with no splits — the common case, and the SAME array every time so
 *  a consumer keyed on the reference (a memo over `getSubTerminalIds`) doesn't
 *  see a fresh empty array on every read. Never mutated; neither are the
 *  index's own lists. */
const NO_SUB_IDS: TerminalId[] = [];

export function useTerminalMetadata(deps: {
  list: Accessor<{ id: TerminalId }[] | undefined>;
}) {
  // W1.R1: a terminal's record is served ALREADY COMPOSED. padi's `terminals`
  // collection folds the two halves that share the one registry entry — the
  // AUTHORED record (location + client chrome + the active|sleeping discriminant)
  // and the GENERIC AWARENESS value (the sensor fields) — server-side via
  // `composeTerminalMetadata` (the ONE join, shared with disk persist
  // `snapshotSession`). The client's former reader-join collapsed to this single
  // read; there is no client-side re-fusion. R9 (remote snapshots) swaps the
  // snapshot backing remote-side behind the server compose with no change here.
  // Memoized so the id array is computed once per list change, not re-mapped on
  // every `.use({ keys })` read, every `terminalIds` recompute, and every
  // `getSubTerminalIds` call (the last runs O(terminals) times per display
  // rebuild — which is why the parent→children relation is INDEXED once below
  // rather than re-scanned per parent).
  const keys = createMemo<TerminalId[]>(
    () => deps.list()?.map((t) => t.id) ?? [],
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
   *  reprojected record `getMetadata` returns. One `createComputed` per live
   *  terminal reprojects its raw record and writes THROUGH `writeWrappedValue`
   *  (the framework's reconcile-or-assign gate — `surface/src/solid/writeValue.ts`,
   *  the same one every subscription value rides) into a per-id `{ v }` store.
   *  Because that gate `reconcile`s, `store.v`'s proxy stays STABLE across the
   *  record's continuous lifetime — a changed field mutates the proxy in place and
   *  notifies only that leaf (the `useTerminalMetadata.test.ts` `lastActivityAt`
   *  case). The reference turns over only around absence/recreation: `undefined ⇄
   *  record`, or a structural swap `reconcile` can't merge in place.
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
   *  `slots` is a keyed store (not a plain Map) so `getMetadata`'s `slots[id]`
   *  read re-subscribes when THIS id's projection is created/removed WITHOUT
   *  tracking the whole membership — adding an unrelated terminal (a split) never
   *  notifies `slots[otherId]` readers, so `active` doesn't churn on split-add.
   *  `mapArray` gives each live id a reactive owner disposed when it leaves the
   *  set. In-repo precedent for the shared-reprojection remedy: `HostDaemonChips`
   *  `daemon()`. */
  const [slots, setSlots] = createStore<
    Record<TerminalId, { read: Accessor<TerminalMetadata | undefined> }>
  >({});
  const driveProjections = mapArray(keys, (id) => {
    const [store, setStore] = createStore<{ v: TerminalMetadata | undefined }>({
      v: undefined,
    });
    // Reprojects on every change of this id's raw record OR the active host's
    // clock; `writeWrappedValue`'s `reconcile` keeps `store.v`'s identity when the
    // reprojected value is unchanged. Sole write path for reprojected metadata —
    // the fresh-object read path is unspellable elsewhere.
    createComputed(() => {
      const record = rawTile(id);
      writeWrappedValue<TerminalMetadata | undefined>(
        setStore,
        record === undefined
          ? undefined
          : reprojectTerminalClock(
              padiMap.entry(activeHost()).clock.toLocal,
              record,
            ),
      );
    });
    setSlots(id, { read: () => store.v });
    onCleanup(() =>
      setSlots(
        produce((s) => {
          delete s[id];
        }),
      ),
    );
  });
  // `mapArray` is lazy — drive it from a `createComputed` (not an effect) so the
  // per-id owners are instantiated + reconciled SYNCHRONOUSLY: `getMetadata` is
  // read in the same tick it's set up (the `active` memo on first render, and the
  // hook's own `displayInfos`/`isWorktreeShared`), so the projection must be ready
  // without waiting for the effect queue. Each per-id computed likewise reprojects
  // eagerly, so a synchronous `getMetadata(id)` returns the value, not a transient
  // `undefined`.
  createComputed(driveProjections);

  /** The RAW composed tile record — presence + the parked-narrow, with NO clock
   *  reprojection. The ORDERING filters (`terminalIds`/`getSubTerminalIds`) read `parentId`
   *  + presence off THIS, both clock-free, so the #1422 order-reference stability is not
   *  perturbed by `reprojectClock`'s activeHost/offset read + fresh-object-per-call (which
   *  only the value-reading `getMetadata` needs). */
  function rawTile(id: TerminalId): TerminalMetadata | undefined {
    const record = terminals()?.byKey(id)?.();
    return record === undefined || isParked(record) ? undefined : record;
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
   *  Reading each record's own signal inside the memo IS the fine-grained
   *  subscription that drives this — no polling, no effect: the memo re-runs as each
   *  key yields. Arms:
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
  const recordPhases = createMemo(() => {
    let awaited = 0;
    let parked = 0;
    let live = 0;
    for (const id of keys()) {
      const record = terminals()?.byKey(id)?.();
      if (record === undefined) awaited++;
      else if (isParked(record)) parked++;
      else live++;
    }
    return { awaited, parked, live };
  });

  // --- Order: server Map insertion order, filtered by parent relationship ---

  /** Live parent edge for the pure tree walks (`rootAncestorOf` /
   *  `descendantsByRoot`). Raw (not reprojected): only `parentId` + presence,
   *  both clock-free. `undefined` when the id is absent or parked so a dangling
   *  parentId cannot invent a fake root. */
  function parentEdge(id: TerminalId): TerminalId | null | undefined {
    const tile = rawTile(id);
    if (tile === undefined) return undefined;
    return tile.parentId ?? null;
  }

  /** Top-level terminal IDs in server-provided order.
   *  Terminals whose metadata hasn't arrived yet are excluded (still loading).
   *
   *  A terminal with no resolvable root (cycle, or parentId dangling at a
   *  missing node) paints as top-level too — otherwise it would fall out of
   *  both this set and every root's flat split list, which is the exact
   *  invisibility bug #2059 is about. True descendants of a live root stay out.
   *
   *  The `equals` gate keeps the prior array reference whenever a metadata
   *  change leaves the top-level id set unchanged (the common case), so
   *  dependants keyed off the reference skip the no-op recompute an unchanged
   *  set would otherwise trigger — the reactivity keystone of the performance
   *  map. The accessor re-runs cheaply on each metadata change; what it no
   *  longer does is *notify* downstream when the set is identical. */
  const terminalIds = createMemo<TerminalId[]>(
    () =>
      keys().filter((id) => {
        // `rawTile` already returns `undefined` for a parked (or not-yet-arrived)
        // record, so presence alone excludes restore-card rows.
        if (rawTile(id) === undefined) return false;
        const root = rootAncestorOf(id, parentEdge);
        // Root of its own tree, or no root at all (cycle / dangling) → tile.
        return root === id || root === null;
      }),
    [],
    { equals: sameTerminalIdOrder },
  );

  /** The TRUE parent→children relation, indexed ONCE per invalidation.
   *
   *  This is the Dock's tree: one hop, exact `parentId` edges. Canvas split
   *  rendering uses {@link getSplitPaneIds} (root-ancestor flattening) instead.
   *
   *  Every reader of that relation used to walk EVERY terminal per parent:
   *  `getSubTerminalIds` filtered `keys()` for one parentId, and
   *  `buildTerminalDisplayInfos` asked it once per display row — so the same
   *  relation was scanned quadratically. One O(T) grouping walk answers every
   *  reader in O(1) per parent. Server-provided `keys()` order is
   *  preserved by construction: the walk appends in `keys()` order, so each
   *  parent's list is the same sequence the old filter produced. */
  const childrenByParent = createMemo<Map<TerminalId, TerminalId[]>>(() => {
    const byParent = new Map<TerminalId, TerminalId[]>();
    for (const id of keys()) {
      // `rawTile` already returns `undefined` for a parked (or not-yet-arrived)
      // record, so presence alone excludes restore-card rows — the same gate the
      // per-parent filter applied. Raw (not reprojected): `parentId` is
      // clock-free.
      const parentId = rawTile(id)?.parentId;
      if (!parentId) continue;
      const siblings = byParent.get(parentId);
      if (siblings) siblings.push(id);
      else byParent.set(parentId, [id]);
    }
    return byParent;
  });

  /** Every descendant of a root tile, flattened, in server-provided order.
   *
   *  The canvas paints these as the tile's split tab strip — a grandchild looks
   *  like a direct child; no indent, no breadcrumb. Built in one O(T) walk with
   *  a path memo so a deep chain is not re-walked per node. */
  const splitsByRoot = createMemo<Map<TerminalId, TerminalId[]>>(() =>
    descendantsByRoot(keys(), parentEdge),
  );

  /** True one-hop children of `parentId` (Dock / real structure). Server order.
   *  The returned array is the index's own and must be treated as read-only. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return childrenByParent().get(parentId) ?? NO_SUB_IDS;
  }

  /** Flat split-pane ids for a canvas tile (every descendant under its root).
   *  Server order. Read-only — the index's own array. */
  function getSplitPaneIds(rootId: TerminalId): TerminalId[] {
    return splitsByRoot().get(rootId) ?? NO_SUB_IDS;
  }

  /** Root ancestor of `id`, or `null` when the walk finds no root (cycle /
   *  dangling). A true root returns itself. Used by focus, WebGL budget, and
   *  adopt so chrome keyed on the tile (not the true parent edge) stays right
   *  for nested splits. */
  function rootAncestor(id: TerminalId): TerminalId | null {
    return rootAncestorOf(id, parentEdge);
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
    const onWorktree = (id: TerminalId) =>
      getMetadata(id)?.git?.worktreePath === worktreePath;
    return terminalIds().some((otherId) => {
      if (otherId === excludeId) return false;
      return onWorktree(otherId) || getSplitPaneIds(otherId).some(onWorktree);
    });
  }

  // --- Derived accessors ---

  // Tile badge / subCount is the FLAT descendant count (what the canvas shows),
  // not the one-hop Dock relation.
  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(terminalIds(), getMetadata, getSplitPaneIds),
  );

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos().get(id);
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
    getSubTerminalIds,
    getSplitPaneIds,
    rootAncestor,
    getTilePaneIds,
    isWorktreeShared,
    getDisplayInfo,
    terminalLabel,
  };
}
