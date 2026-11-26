/** `createHostWire` — ONE host's retained per-host WIRE SUBSCRIPTIONS, born inside
 *  its `scopedByEntry` owner and RETAINED across switch-away (padi W9, completing
 *  W7's K1).
 *
 *  A sibling owner member to `createViewState` (selection + posture),
 *  `createHostPrefs`, `createCamera`, and `createSessionRestore`. Where THOSE hold
 *  cheap client-owned state, this one holds the host's live SUBSCRIPTIONS — the
 *  six per-host readouts that W7 consciously left keyed on `activeHost`:
 *
 *    - `terminalKeys`  — the `terminals.keys` stream (the tile order source);
 *    - `terminals`     — the composed `terminals` metadata collection (keyed off
 *      this host's own `terminalKeys`);
 *    - `session`       — the persisted saved-session cell;
 *    - `roster`        — whether that key list is a CENSUS yet (padi has
 *      finished adopting), the qualifier every absence-reader needs;
 *    - `activityFeed`  — the MRU repos/agents cell;
 *    - `daemonStatus`  — the kaval status collection.
 *
 *  ── WHY per host, not per active-host (the W9 fix) ───────────────────────────
 *  W7 left these on `padiMap.useEntry(activeHost)`, whose contract is
 *  DISPOSE-ON-KEY-CHANGE: every host switch tore each readout down and reopened it
 *  from PENDING. Switch-BACK therefore reopened a host whose data the client held
 *  moments ago from `pending` — `daemonStatusPending()` flipped true and the
 *  composed `terminalCount` fell to 0, so `resolveCanvasMode` left `workspace` and
 *  `App.tsx`'s `<Switch>` unmounted the whole canvas arm (the ~1s rebuild). Opened
 *  instead inside this per-host owner — created LAZILY on first activation,
 *  RETAINED across every switch-away, DISPOSED only when the host leaves
 *  `padiMap.entries` — a switch-back has NO resubscribe at all, so no pending
 *  window can exist. The exported wire facades (`hostScope/activeWire.ts`) and the metadata /
 *  daemon readers (`useTerminalMetadata`, `useDaemonStatus`) become WINDOWS over
 *  `activeScope().wire`, reading whichever retained host is active.
 *
 *  ── The bytes stay active-host-only ─────────────────────────────────────────
 *  These are VALUE members (cells + collections + a keys stream) — cheap to hold
 *  open per visited host. xterm/WebGL and the terminal ATTACH byte stream are NOT
 *  here: they stay active-host-only (a sub-second re-attach paint remains, the one
 *  deliberate W9 exclusion), so no GL context is retained per host.
 *
 *  ── A sub error is surfaced, never dropped — toast if shown, else log ───────
 *  A retained BACKGROUND host's subscription now lives while you view another host,
 *  so a toast for it would be noise (an unlabeled error about a canvas you are not
 *  looking at). But `wireSubscriptionError` fires its error edge ONCE, so simply
 *  suppressing the toast would DISCARD a background failure permanently (no re-fire on
 *  switch-back). So the ONE `interpretClientError`'s `scopedSub` arm (SR11) splits by
 *  the GROUNDED-active host (`groundedActiveHost()` enc-compared to this entry's key):
 *  the shown host TOASTS (immediate feedback, exactly as the pre-W9 active-host-only
 *  readouts did); a backgrounded host LOGS to `console.error` (named by host) so the
 *  failure is never invisible — mirroring `watchByEntry`'s own default `onError` and the
 *  `caught-error-must-not-collapse-to-empty` rule. The four retained members declare
 *  their policies on `padiSurface` (session/activityFeed/terminals → `scopedSub`;
 *  daemonStatus → `hostToast`, the 4C ruling), so this owner opens them bare.
 *  Switching to a broken host then also
 *  shows its degraded state structurally (an errored `terminals`/`session` reads empty
 *  → the canvas's connecting/empty surface). */

import {
  encodeHostLocation,
  LOCAL_LOCATION,
  rosterIsEstablished,
  tileTerminalOf,
} from "@kolu/padi-client/surface";
import { unenrolledStreamCall } from "@kolu/surface/client";
import {
  createReactiveSubscription,
  type Subscription,
} from "@kolu/surface/solid";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import type { LivePlacement } from "../terminal/focusedTerminal";
import {
  containingTileOf,
  type ParentEdge,
  sameIdOrder,
} from "../terminal/terminalTree";
import { interpretClientError, padiMap } from "../wire";

/** The map entry lens `createHostWire` opens its cells/collections through. Aliased
 *  only to NAME the retained members' result types on {@link HostWire} PORTABLY —
 *  through `padiMap` (a public import) rather than the surface package's internal
 *  result-type module paths, which `tsc` refuses to name across the package
 *  boundary (TS2883). */
type PadiEntry = ReturnType<typeof padiMap.entry>;

/** One host's retained wire subscriptions. Its members are read through
 *  `activeScope().wire` by the exported facades and the metadata/daemon readers. */
export interface HostWire {
  /** The host's KEY LIST as the stream answers it — every id the registry
   *  holds, tiles, splits and parked rows alike, and `undefined` until it has
   *  answered at all.
   *
   *  It is also the LIVENESS fact, the one an absence-reader must use instead
   *  of a record: a kill changes this list, while a record merely arriving
   *  does not, so "the host no longer has this id" is answerable here a
   *  daemon round trip before the composed records land. `createViewState`'s
   *  visit prune reads it for exactly that reason. */
  terminalKeys: Subscription<TerminalId[]>;
  terminals: ReturnType<PadiEntry["collections"]["terminals"]["use"]>;
  session: ReturnType<PadiEntry["cells"]["session"]["use"]>;
  /** WHETHER THIS HOST'S TERMINAL LIST IS A CENSUS — padi's own `roster`
   *  standing (`padiSurface` 7.4). Retained beside the list it qualifies,
   *  because every reader that concludes an ABSENCE from `terminalKeys` needs
   *  both in the same breath (`listIsAuthoritative`, the fleet standing). */
  roster: ReturnType<PadiEntry["cells"]["roster"]["use"]>;
  /** The READING of that pair — whether this host's list can be trusted as a
   *  COMPLETE census right now. The one authority fact the removal reconcile
   *  suppresses its eviction writes on and the focus derivation gates its
   *  auto-switch on, so a supervised recycle's drain cannot be read as a
   *  departure by one of them and not the other. `listIsAuthoritative`
   *  (`kaval/useDaemonStatus`) is this for the ACTIVE host, conjoined with
   *  the link-liveness leg. */
  listIsCensus: Accessor<boolean>;
  activityFeed: ReturnType<PadiEntry["cells"]["activityFeed"]["use"]>;
  daemonStatus: ReturnType<PadiEntry["collections"]["daemonStatus"]["use"]>;
  /** Pure placement lookup over this host's retained terminal collection. */
  placementOf: (id: TerminalId) => LivePlacement;
  /** This host's live TOP-LEVEL tiles, in the server's census order.
   *
   *  The membership the visit trail is READ against
   *  (`createViewState.mruOrder`) instead of being written into it: the trail
   *  is a durable record of GESTURES, and "which of those are still here, and
   *  which tiles it has never seen" is a function of this census. Parked
   *  registry rows are restore-card entries, not tiles, so they are dropped
   *  exactly as `createBootPick` drops them. */
  tileIds: Accessor<TerminalId[]>;
}

export function createHostWire(host: HostKey): HostWire {
  const entry = padiMap.entry(host);

  // Surface a retained sub's error WITHOUT dropping it: the shown host toasts; a
  // backgrounded host logs (a toast for a host you are not looking at is noise, but
  // `wireSubscriptionError`'s edge fires once — silently suppressing it would discard
  // the failure permanently). The split lives in the ONE `interpretClientError`
  // (SR11): the four RETAINED members declare their `scopedSub`/`hostToast` policies
  // ON THE SPEC (`padiSurface`) and route through the interpreter automatically (with
  // the map-injected `{ key }` origin); the `terminalKeys` STREAM is not a member
  // `.use()`, so it reuses the same interpreter by hand for behaviour parity.
  //
  // KNOWN LIMIT (recorded): the underlying `.use()` subs re-subscribe on transport
  // reconnect (STREAM_RETRY), but a sub that errors TERMINALLY on a BACKGROUND host is not
  // re-opened until this scope is rebuilt — i.e. the host leaves and rejoins `padiMap.entries`
  // (membership exit disposes the owner). There is no per-sub retry on switch-BACK: a
  // switched-to host reads its errored sub's floored-empty value until a reconnect or re-add
  // revives it. Acceptable today (a terminal sub error on a live link is rare and the empty
  // read is honest, not a false-success); revisit if it proves user-visible. */

  // The terminal-list keys stream — an UNENROLLED STREAM_RETRY stream (the #1591
  // health carve-out; a re-attach must never flicker the health gate). Keyed on
  // the FIXED `host` (a constant input, so `createReactiveSubscription` opens it
  // once and never re-keys) — the owner IS the host, so there is no `activeHost`
  // to capture and no re-key on switch: it stays live across switch-away. NOT a
  // member `.use()`, so it routes its error through the interpreter by hand (the
  // `scopedSub` arm, `{ key: host }` origin) to preserve the active-toasts /
  // background-logs behaviour the declared members get for free.
  const terminalKeys = createReactiveSubscription<HostKey, TerminalId[]>(
    () => host,
    () =>
      unenrolledStreamCall(
        entry.collections.terminals.unenrolledKeys,
        undefined,
        // Scoped by HOST (kolu#2101 J2): this same member is opened once per
        // host, and the liveness table has to be able to say WHICH one parked.
        { label: `terminals.keys[${encodeHostKey(host)}]` },
      ),
    {
      onError: (err) =>
        interpretClientError(
          { kind: "scopedSub", label: "Terminal list error" },
          err,
          { key: host },
        ),
    },
  );

  // The composed `terminals` metadata collection, keyed off THIS host's own
  // `terminalKeys` — co-located with the keys stream that drives it, so both the
  // key list and the per-id records ride one retained owner. Its `scopedSub`
  // "Metadata error" policy rides the spec; the use-site keeps only `keys`.
  const keys = createMemo<TerminalId[]>(() => terminalKeys() ?? []);
  const terminals = entry.collections.terminals.use({ keys });
  const placementOf = (id: TerminalId): LivePlacement => {
    const terminal = terminals.byKey(id)?.();
    if (!terminal) return { kind: "missing" };
    return terminal.parentId === undefined || terminal.parentId === null
      ? { kind: "top-level" }
      : { kind: "split", parentId: terminal.parentId };
  };

  // The host's live top-level tiles — see {@link HostWire.tileIds}. Derived
  // from the same two retained members the boot pick folds (the key list and
  // each key's composed record), so the trail's live membership and the pick
  // can never be answered from two different censuses.
  const tileIds = createMemo<TerminalId[]>(
    () => {
      const parents = new Map<TerminalId, TerminalId | null>();
      for (const id of keys()) {
        // `undefined` for a not-yet-arrived record AND for a parked one, which
        // is why both fall out of the census here.
        const record = tileTerminalOf(terminals.byKey(id)?.());
        if (record !== undefined) parents.set(id, record.parentId ?? null);
      }
      const parentEdge: ParentEdge = (id) => parents.get(id);
      return keys().filter(
        (id) => parents.has(id) && containingTileOf(id, parentEdge) === id,
      );
    },
    // A census move that changes no tile (a split's title, a record arriving
    // under a tile already listed) must not wake the MRU and the WebGL budget.
    { equals: sameIdOrder },
  );

  // The persisted saved-session cell (host-owned, restore-relevant).
  const session = entry.cells.session.use();

  // The MRU activity feed (recent repos / agents — host-fs facts).
  const activityFeed = entry.cells.activityFeed.use();

  // WHETHER THE LIST ABOVE IS A CENSUS — padi's own roster standing. Opened
  // beside `terminalKeys` because it is the other half of reading an absence:
  // a host that has not finished adopting serves an empty list that means
  // nothing, and a reader without this fact cannot tell that from a machine
  // whose terminals all exited.
  const roster = entry.cells.roster.use();

  // …AND THE READING OF THAT PAIR, once, here: the list is a census when the
  // standing is established AND the list has delivered every id the standing
  // names. A host that is adopting, recycling or restarting fails the first
  // test; a list still arriving fails the second (#2376). Both the removal
  // reconcile's suppression and the focus derivation's auto-switch gate read
  // this one answer, through `listIsAuthoritative`, which conjoins the
  // link-liveness leg the fleet owns.
  const listIsCensus = createMemo(() => {
    const standing = roster.value();
    if (standing === undefined || !rosterIsEstablished(standing)) return false;
    const listed = terminalKeys();
    if (listed === undefined) return false;
    return standing.ids.every((id) => listed.includes(id));
  });

  // The kaval daemon-status collection (this host's local kaval, keyed by its
  // local location). `useDaemonStatus` reads it through `activeScope().wire`. Its
  // `hostToast` "daemon status" policy (4C ruling) rides the spec; only `keys` stays.
  const daemonStatus = entry.collections.daemonStatus.use({
    keys: () => [encodeHostLocation(LOCAL_LOCATION)],
  });

  return {
    terminalKeys,
    terminals,
    session,
    roster,
    listIsCensus,
    activityFeed,
    daemonStatus,
    placementOf,
    tileIds,
  };
}
