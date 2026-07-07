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
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { activeHost, padiMap } from "../wire";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

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
  // rebuild).
  const keys = createMemo<TerminalId[]>(
    () => deps.list()?.map((t) => t.id) ?? [],
  );
  const terminals = padiMap.useEntry(activeHost).collections.terminals.use({
    keys,
    onError: (err: Error) => toast.error(`Metadata error: ${err.message}`),
  });

  // padi's `terminals` collection is typed `PadiTerminal` — a 3-arm union:
  // `active | sleeping | PARKED`, each carrying the reserved cross-host `host` axis
  // (never populated on a single-host canvas). A PARKED record is a restore-card
  // row, NEVER a tile (W1.R6's boot reconcile produces it), so it is narrowed out
  // HERE — via the sound `isParked` type-guard, NOT a cast — leaving the honest
  // 2-arm `TerminalMetadata` (`active | sleeping`) the ~20 tile consumers expect.
  // This is the ONE type bridge where the padi wire shape meets the client's domain
  // type.
  //
  /** A terminal's composed TILE record — `undefined` until the server-composed
   *  record has arrived, AND `undefined` for a PARKED record (a restore-card row,
   *  not a tile). The `byKey` read is reactive, so this re-runs as the record
   *  updates. The value is read field-wise by every one of the ~20 consumers inside
   *  its own tracking scope — none compares it by identity — so per-key reactivity
   *  stays granular (a change to one terminal notifies only readers of that
   *  terminal). This is ALSO the read the ordering filters below use for
   *  `parentId`: presence (a real tile record arrived) is the gate that excludes a
   *  still-loading OR parked terminal from the order. */
  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    const record = rawTile(id);
    return record === undefined ? undefined : reprojectClock(record);
  }

  /** The RAW composed tile record — presence + the parked-narrow, with NO clock
   *  reprojection. The ORDERING filters (`terminalIds`/`getSubTerminalIds`) read `parentId`
   *  + presence off THIS, both clock-free, so the #1422 order-reference stability is not
   *  perturbed by `reprojectClock`'s activeHost/offset read + fresh-object-per-call (which
   *  only the value-reading `getMetadata` needs). */
  function rawTile(id: TerminalId): TerminalMetadata | undefined {
    const record = terminals.byKey(id)?.();
    return record === undefined || isParked(record) ? undefined : record;
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
   *  one of which consumers already render as "unknown", never the raw value. */
  function reprojectClock(record: TerminalMetadata): TerminalMetadata {
    const { toLocal } = padiMap.entry(activeHost()).clock;
    const lastActivityAt =
      record.lastActivityAt === undefined
        ? undefined
        : (toLocal(record.lastActivityAt) ?? undefined);
    const agent =
      "agent" in record && typeof record.agent?.startedAt === "number"
        ? { ...record.agent, startedAt: toLocal(record.agent.startedAt) ?? 0 }
        : "agent" in record
          ? record.agent
          : undefined;
    const sleptAt =
      "sleptAt" in record && typeof record.sleptAt === "number"
        ? (toLocal(record.sleptAt) ?? 0)
        : undefined;
    // The same type bridge the parked-narrow above rides: the reprojected fields keep
    // their wire types (number|undefined), so this is a value-only rewrite of the record.
    return {
      ...record,
      lastActivityAt,
      ...(agent === undefined ? {} : { agent }),
      ...(sleptAt === undefined ? {} : { sleptAt }),
    } as TerminalMetadata;
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
   *  `CanvasFacts.transportLive` (watchdog-backed) — a LIVE transport with a
   *  never-composing record is a padi/compose BUG that must surface loudly, not a UI
   *  state to tune around. */
  const recordPhases = createMemo(() => {
    let awaited = 0;
    let parked = 0;
    let live = 0;
    for (const id of keys()) {
      const record = terminals.byKey(id)?.();
      if (record === undefined) awaited++;
      else if (isParked(record)) parked++;
      else live++;
    }
    return { awaited, parked, live };
  });

  // --- Order: server Map insertion order, filtered by parent relationship ---

  /** Top-level terminal IDs in server-provided order.
   *  Terminals whose metadata hasn't arrived yet are excluded (still loading).
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
        // record, so presence alone excludes restore-card rows. Raw (not reprojected):
        // ordering reads only `parentId`, clock-free.
        const a = rawTile(id);
        return a !== undefined && !a.parentId;
      }),
    [],
    { equals: sameTerminalIdOrder },
  );

  /** Sub-terminal IDs for a parent, in server-provided order. `getMetadata`
   *  excludes parked records (never a live split — they await restore), so a
   *  presence check suffices here too. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return keys().filter((id) => {
      const a = rawTile(id);
      return a !== undefined && a.parentId === parentId;
    });
  }

  /** True if any terminal outside of `excludeId`'s tree is also on
   *  `worktreePath`. Callers use this to decide whether removing the
   *  worktree would yank it out from under a live terminal.
   *
   *  A sub-terminal of a different top-level must also count: its git
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
      return onWorktree(otherId) || getSubTerminalIds(otherId).some(onWorktree);
    });
  }

  // --- Derived accessors ---

  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(terminalIds(), getMetadata, getSubTerminalIds),
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
    isWorktreeShared,
    getDisplayInfo,
    terminalLabel,
  };
}
