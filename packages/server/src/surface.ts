/**
 * Server-side surface implementation — single source of truth for kolu-server's
 * OWN typed reactive layer (the `kolu` + `surfaceApp` siblings).
 *
 * As of the W2.2 cutover kolu-server serves NO terminal domain: `padiSurface` is
 * RE-SERVED off a bound padi PROCESS (see `padiBinding.ts` + the async boot in
 * `index.ts`), not implemented in-process here. So this file implements only the
 * two siblings kolu-server owns. SR8.a moved the serve out of module load into a
 * boot-time {@link implementKoluSurface} that `index.ts` calls AFTER `padiSession`
 * exists; SR8.c gave every member ONE home HERE. `implementKoluSurface` takes plain
 * domain-named deps (reads + a projected `onState`) and assembles EVERY member's
 * framework node in this file — so `index.ts` imports no reactor primitive — and
 * RETURNS just a {@link ServedFragment} (`{ group, handlers }` — there are no
 * module-level router/ctx exports, and NO ctx-write path: the reactor graph is every
 * derived member's one writer).
 *
 * What stays at module load is the WIDENING SEAM: {@link servedGroup}, the flat
 * superset group kolu-server serves (the root procedures + its own two siblings + the
 * padi host map), asserted tag-complete at IMPORT. Its boot-time twin
 * {@link assembleServedHandlers} merges the three fragments' handlers and proves the
 * bound tag set matches that group exactly, in both directions — the successor of the
 * oRPC-era `implement(servedContract)` re-adaptation, which existed to attach the
 * `/surface/padi/*` routes a padi-less builder silently dropped.
 *
 *   - kolu's four live members: `processMemory` + `daemonInventory` are DERIVED POLL
 *     cells (a fused `everyMsOr` cadence); `padiLink` + `processStartedAt` are DERIVED
 *     PUSH cells (two `scan`s over ONE shared `onState` source). All are graph-written —
 *     no ctx entry (the bridge's one-writer law). `preferences` and `viewerMode` are the
 *     Conf-backed store cells.
 *
 * Publisher channel names are framework-derived in two layers. Each surface
 * names its own channels by primitive: `<prim>:changed` for cells,
 * `<prim>:keys` + `<prim>:<key>` for collections,
 * `<prim>:<JSON.stringify(input)>` for events. `implementSurfaces` then
 * key-namespaces every name with its sibling key before it reaches the shared
 * publisher — so the wire publisher actually sees `kolu/preferences:changed`,
 * `surfaceApp/buildInfo:changed`, etc.
 *
 * `preferences` and `viewerMode` are the `confStore`-backed cells kolu-server still
 * owns (`koluSurface` cells served here); the `activityFeed` + `session` stores retired
 * from here at W2.2 — padi owns its OWN state-root now, so those stores no longer
 * cross into padi from kolu-server.
 */

import { publisher } from "@kolu/padi/assembly";
import {
  type CellStore,
  confStore,
  type ImplementSurfaceDeps,
  implementSurfacesOnPublisher,
  publisherChannel,
  type SurfaceHandlers,
} from "@kolu/surface/server";
import { surfaceAppServer } from "@kolu/surface-app/server";
import { Effect } from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { koluRootGroup, koluSurfaceGroup } from "kolu-common/contract";
import type { PadiProcessMemory } from "@kolu/padi/surface";
import { derived, everyMsOr, scan, source } from "@kolu/surface/reactor";
import type {
  ForwardCreateInput,
  Forwards,
  KoluBuildInfo,
  KoluForward,
  NewTerminalPolicy,
  PadiLink,
  Preferences,
  ProcessStartedAt,
  ViewerMode,
} from "kolu-common/surface";
import {
  type DaemonInventory,
  DEFAULT_DAEMON_INVENTORY,
  type koluSurface,
  resolveNewTerminalPolicy,
  surfaces,
} from "kolu-common/surface";
import { padiHostMap } from "kolu-common/surfacesWithPadi";
import {
  serverCommit,
  serverProcessId,
  serverStartedAt,
  serverVersion,
} from "./hostname.ts";
import { log } from "./log.ts";
import {
  MEMORY_SAMPLE_INTERVAL_MS,
  sampleServerMemory,
} from "./memorySampler.ts";
import { FORWARD_REAP_INTERVAL_MS } from "./portForward/forwards.ts";
import { DAEMON_INVENTORY_SAMPLE_INTERVAL_MS } from "./padi/daemonInventory.ts";
import { store } from "./state.ts";

// ── The WIDENING SEAM: kolu-server's served superset group ─────────────────
//
// kolu-server serves a SUPERSET of the shared `kolu-common` contract: the root
// procedures PLUS the two siblings it owns (`kolu`, `surfaceApp`) PLUS the padi
// HOST MAP — the key-folded `surface/padi/*` members + the `entries` membership
// collection that `serveHostMap` serves in `index.ts`. Under Effect RPC the wire
// namespace is FLAT (PLAN D1), so a "sibling" is a tag PREFIX and the superset is
// one `RpcGroup.merge` of three DISJOINT halves:
//
//   koluRootGroup    → `server/*`, `daemon/*`, `hosts/*`     (7 tags)
//   koluSurfaceGroup → `surface/kolu/*`, `surface/surfaceApp/*`
//   padiHostMap.group→ `surface/padi/*` (folded members + `entries`)
//
// **Why the padi-LESS `koluSurfaceGroup`, not `composeSurfaceContracts(surfacesWithPadi)`.**
// The oRPC original spread the padi-FUL composition and then OVERWROTE the `padi`
// key with the map's own contract, because the two describe the same wire paths
// with different payloads (the map folds every member behind a `{mapKey, input}`
// envelope). A flat `merge` cannot express "overwrite" honestly: it is a
// last-writer-wins `Map.set` (#16), so merging BOTH would silently drop one
// spelling of every shared tag AND leave the plain sibling's three reserved
// `surface/padi/system/*` tags ADVERTISED with nothing bound to them — an
// advertised-but-unhandled tag, which is exactly the silent-404 class this seam
// exists to prevent. So the padi half enters ONCE, as the map, and the two
// remaining halves are provably disjoint from it.
//
// **The assertion is the proof.** `RpcGroup.make`/`.merge` have zero collision
// detection, so disjointness is only real if it is counted: the tag total must
// equal the sum of the three halves. It runs at IMPORT — a boot crash, never a
// production 404 on `/surface/padi/*` (the regression `router.test.ts` was written
// for, restated on the tag axis now that there is no matcher tree to inspect).
//
// The one cast: `RpcGroup<in out R>` is INVARIANT in its element union, so a group
// whose elements are precisely-typed `Rpc`s (the root procedures, spelled member by
// member in `kolu-common/contract`) is not assignable to the erased
// `RpcGroup<Rpc.Any>` every serving seam takes — even though every element IS an
// `Rpc.Any`. The framework's own dynamically-assembled groups (`Surface.group`,
// `SurfaceMap.group`) are born erased and need no cast; this one is not, and no
// typed alternative exists short of erasing the contract's precision, which is what
// makes the client face precise. Same structural constraint the retired
// `RPCHandler(appRouter as any)` carried.
export const servedGroup = koluRootGroup.merge(
  koluSurfaceGroup,
  padiHostMap.group,
) as unknown as RpcGroup.RpcGroup<Rpc.Any>;

/** Every tag the served superset carries, in the three halves it is assembled
 *  from — exported so the wire-shape test asserts the exact key set against the
 *  same sources the server merges, rather than a hand-copied literal that could
 *  drift. */
export const SERVED_TAG_COUNTS = {
  root: koluRootGroup.requests.size,
  koluSurfaces: koluSurfaceGroup.requests.size,
  padiMap: padiHostMap.group.requests.size,
} as const;

const EXPECTED_SERVED_TAGS =
  SERVED_TAG_COUNTS.root +
  SERVED_TAG_COUNTS.koluSurfaces +
  SERVED_TAG_COUNTS.padiMap;

if (servedGroup.requests.size !== EXPECTED_SERVED_TAGS) {
  throw new Error(
    `kolu-server: the served group carries ${servedGroup.requests.size} tag(s), expected ` +
      `${EXPECTED_SERVED_TAGS} (root ${SERVED_TAG_COUNTS.root} + kolu surfaces ` +
      `${SERVED_TAG_COUNTS.koluSurfaces} + padi map ${SERVED_TAG_COUNTS.padiMap}) — ` +
      `an RpcGroup merge dropped a colliding tag.`,
  );
}

/** A served fragment: one flat group and the handlers bound at its tags. Every
 *  producer kolu-server assembles — `implementSurfacesOnPublisher`, `serveHostMap`,
 *  and {@link buildAppRouter}'s root procedures — hands back this same pair. */
export interface ServedFragment {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly handlers: SurfaceHandlers;
}

/** Merge the three halves' HANDLERS into the one record the transport dispatches,
 *  and prove the result covers {@link servedGroup} EXACTLY — in both directions:
 *
 *   - a tag the group advertises with no handler bound is a silent 404 at the far
 *     end (the `/surface/padi/*` regression, on the tag axis);
 *   - a handler at a tag the group never minted is dead code no client can reach.
 *
 *  This is the successor of `assertHandlersMatchGroup`, applied at the ONE place
 *  three independently-built fragments become one served surface. Called once from
 *  the async boot; a mismatch crashes the boot rather than shipping a hole. */
export function assembleServedHandlers(parts: {
  /** kolu-server's own two siblings — {@link implementKoluSurface}. */
  readonly kolu: ServedFragment;
  /** The padi host map — `serveHostMap(padiHostMap, pool, …)`. */
  readonly padiMap: ServedFragment;
  /** The root procedures — `buildAppRouter(...)`. */
  readonly root: ServedFragment;
}): SurfaceHandlers {
  // Null-prototype, exactly as the framework's own handler records are (S2): a
  // member named `toString` must not collide with an inherited property.
  const handlers: SurfaceHandlers = Object.assign(
    Object.create(null) as SurfaceHandlers,
    parts.kolu.handlers,
    parts.padiMap.handlers,
    parts.root.handlers,
  );
  const bound = new Set(Object.keys(handlers));
  const advertised = new Set(servedGroup.requests.keys());
  const missing = [...advertised].filter((tag) => !bound.has(tag));
  const orphaned = [...bound].filter((tag) => !advertised.has(tag));
  if (missing.length > 0 || orphaned.length > 0) {
    throw new Error(
      `kolu-server: the served handler set does not match the served group — ` +
        `${missing.length} advertised tag(s) with no handler (${missing.slice(0, 8).join(", ")}` +
        `${missing.length > 8 ? ", …" : ""}), ` +
        `${orphaned.length} handler(s) at unminted tag(s) (${orphaned.slice(0, 8).join(", ")}` +
        `${orphaned.length > 8 ? ", …" : ""}).`,
    );
  }
  return handlers;
}

// ── Stores (Conf-backed; one slot per persisted cell) ──────────────────
//
// `preferences` + `viewerMode` are kolu-server's own persisted cells. The `session` +
// `activityFeed` + `lastPairedDaemon` stores retired from here at the W2.2
// cutover: padi owns its OWN state-root now (`openPadiStateStores`), so those
// stores no longer cross into padi from kolu-server.

const preferencesStore: CellStore<Preferences> = confStore<Preferences>(
  store,
  "preferences",
);

// The browser's last-reported OS light/dark reading. Persisted so a headless face
// (MCP, CLI) creating a terminal on a server no browser has dialled since boot still
// resolves an "auto" shuffle against a real answer instead of a fabricated one.
const viewerModeStore: CellStore<ViewerMode> = confStore<ViewerMode>(
  store,
  "viewerMode",
);

/** The RESOLVED new-terminal theme policy the padi pusher publishes — derived from
 *  the SAME two stores the `preferences` / `viewerMode` cells serve, so the pushed
 *  fact and the cells can never disagree. The derivation itself lives once in
 *  `kolu-common/surface` (`resolveNewTerminalPolicy`), which is also where "auto" is
 *  spent; nothing downstream of here sees a preference. */
export function currentNewTerminalPolicy(): NewTerminalPolicy {
  return resolveNewTerminalPolicy(
    preferencesStore.get(),
    viewerModeStore.get(),
  );
}

// ── The bound padi's rail state — the projected payload the push cells derive from ──
//
// `padiLink` + `processStartedAt` both derive from the bound padi's `onState`. To keep
// this file domain-projection-free, `index.ts` projects each raw `SessionState` into
// this small payload (phase → `link`, `identity()` → `padiStartedAt`) BEFORE it reaches
// here; the two push cells then just route its fields. All FOUR of kolu-server's live
// members (`processMemory`, `daemonInventory`, `padiLink`, `processStartedAt`) now have
// ONE home — this file — assembled from the boot-only reads/onState `index.ts` supplies.
export interface PadiRailState {
  link: PadiLink;
  padiStartedAt: number | null;
}

/** The boot-only dependencies `index.ts` supplies so `implementKoluSurface` can build
 *  EVERY member here — the reactor `source`/`scan`/`derived.cell` nodes are assembled in
 *  this file, never a kolu-named parallel poll-spec type, and `index.ts` imports no
 *  reactor primitive. Each seam needs `padiSession` (the re-serve mirror, the liveness
 *  snapshot, the identity sum), which exists only in the async boot. */
export interface KoluSurfaceDeps {
  /** padi's `{ padi, kaval }` memory reading off the re-serve mirror (gated in
   *  `index.ts` on padi's honest connected phase, `padiSession.currentState().phase
   *  === "connected"`), or `null` when padi is down. */
  readPadiMemory: () => Promise<PadiProcessMemory | null>;
  /** The RAW host-daemon enumeration — may throw (a discovery fs-walk / session
   *  readout). `implementKoluSurface` wraps it TOTAL (below) so a fault degrades only
   *  this one diagnostic cell, never faults the runtime's `done` → `process.exit`. */
  readDaemonInventory: () => Promise<DaemonInventory>;
  /** The bound padi's state feed, projected to {@link PadiRailState}. Fires the current
   *  state synchronously on subscribe and returns an unsubscribe. Drives the two push
   *  cells (payload) AND the two poll cells' fused cadence (a bare change tick). */
  onState: (cb: (state: PadiRailState) => void) => () => void;
  /** kolu's port forwards (PRT2) — the `forwards` cell's read + its change edge,
   *  plus the two acts that move it. The POLICY (auto vs manual, the auto-cancel
   *  rule) lives in `forwards.ts`; this seam is only how the surface reaches it,
   *  so the member table here stays a member table.
   *
   *  `read` RECONCILES then reports: it runs the auto-cancel pass and returns the
   *  resulting list. That is one act, not two glued together — "which doors are
   *  open" and "which of them still have anything behind them" are the same
   *  question, and answering the first without the second would publish a list
   *  kolu already knows is stale. It must be TOTAL, because a poll source's T+0
   *  seed throw is fatal to the runtime.
   *
   *  `onChange` is the change EDGE — a bare notification that the map moved
   *  (someone opened or cancelled a door, a mechanism reported one lost), fused
   *  with the reap interval so an act publishes at once instead of waiting out a
   *  tick. The payload is deliberately not carried: the read is the one reader of
   *  the list, so there is exactly one path a value reaches the wire by. */
  forwards: {
    read: () => Promise<Forwards>;
    onChange: (tick: () => void) => () => void;
    create: (input: ForwardCreateInput) => Promise<KoluForward>;
    cancel: (key: string) => Promise<void>;
  };
  /** A bare nudge: one of the two inputs to {@link currentNewTerminalPolicy}
   *  (`preferences` or `viewerMode`) just changed, so the padi pusher must re-derive
   *  and re-publish to every bound padi. Fire-and-forget — the payload is deliberately
   *  not carried, because `currentNewTerminalPolicy` is the one reader of both stores
   *  and re-reads them itself (one path a policy reaches a padi by). */
  onPolicyInputsChanged: () => void;
}

// ── Surface implementation (SR8.a: served in boot; SR8.c: ONE home per member) ───
//
// Serving kolu-server's own two siblings is the ONE place a connect fires (the
// surface-app buildInfo connector). It happens HERE, called once from `index.ts`'s
// async boot AFTER `padiSession` exists — not at module load — because every live member
// reads/installs through boot-only seams. SR8.c: `implementKoluSurface` now takes plain
// domain-named deps and assembles EVERY member's framework node (`source`/`scan`/
// `derived.cell`) in THIS file — kolu's member table has one home, and `index.ts` imports
// no reactor primitive. Ordering is enforced by straight-line boot control flow (the
// caller uses the returned router/ctx immediately), so the rejected late-bind registrar
// slot (an override-knob) is unnecessary and absent. `t`/`servedContract` (module-level
// above) are pure contract builders that fire no connects, so `router.ts`'s app-router
// assembly against `t` keeps working unchanged.
/** Serve kolu-server's OWN two sibling surfaces (kolu + surfaceApp) on the shared
 *  `@kolu/padi` publisher, wire the runtime's deliberately-fatal `done`, and return the
 *  built router + kolu ctx. `index.ts`'s boot splices the RE-SERVED `padi` sibling into
 *  `.router.surface`; every kolu member is the reactor graph's own writer now (no
 *  ctx-write path). Call exactly once, after `padiSession`. */
export function implementKoluSurface(deps: KoluSurfaceDeps) {
  // The daemon-inventory read made TOTAL — the guard has ONE home, here beside the cell.
  // `deps.readDaemonInventory` may throw (a discovery fs-walk / session readout), and a
  // poll source's T+0 SEED throw faults the runtime's `done` → `process.exit(1)` (below),
  // crashing the whole web shell over a purely diagnostic panel. Catch → a structured
  // `log.error` (the reactor's own poll catch is a bare `console.error`, no serverId/cell
  // tag) and the honest empty default, mirroring the memory read's totality. Enumeration
  // is designed not to throw, so this is defence in depth.
  const readDaemonInventoryTotal = async (): Promise<DaemonInventory> => {
    try {
      return await deps.readDaemonInventory();
    } catch (err) {
      log.error({ err }, "daemon-inventory sample failed");
      return DEFAULT_DAEMON_INVENTORY;
    }
  };

  // ONE push `source` over the bound padi's projected `onState` — the "single onState
  // subscription" both push cells share. The source's tap is ref-counted (installed on the
  // first `scan` subscriber, torn down on the last), so the two cells' scans multicast off a
  // single `deps.onState`. A push occurrence emits SYNCHRONOUSLY (the reactor's `makeEmit`
  // `batch` → the graph-node publish `effect`, no microtask) — deliberately the PUSH arm,
  // never the reactor's microtask-deferred POLL arm, whose read must gate on padi's honest
  // `currentState().phase` (never a `currentClient()` pointer reassigned mid-frame). The source has
  // no `initial` (its bare level is honestly `T | undefined`); each cell's SCAN carries its
  // own exact-`T` honest seed below, so no fabricated `undefined` ever reaches the wire.
  //
  // SEED INVARIANT (why two scans over one ref-counted source is safe): `source.subscribe`
  // does NOT replay its current level, so only `padiLink`'s scan (the FIRST subscriber,
  // which installs the tap) folds the install-time `onState` emission; `processStartedAt`'s
  // scan subscribes second and keeps its own `startedAtSeed`. That is correct ONLY because
  // padi is still WARMING when this runs — `index.ts` calls `implementKoluSurface`
  // synchronously right after a fire-and-forget local `pin()`, so the async dial has not
  // completed, `padiStartedAt()` is `null`, and the install-time emission carries
  // `{ padi: null }` — byte-equal to `startedAtSeed`, so the second scan misses nothing.
  // Both cells then track every LATER `onState` (both subscribed). This warming precondition
  // is not left to chance: `index.ts` ENFORCES it fail-fast (asserts `padiStartedAt()` is
  // `null`) right before calling this — a future change that awaits the pin trips at boot,
  // not silently. The fix then is to seed both scans from a live snapshot, not to relax it.
  const padiRail = source<PadiRailState>(deps.onState);
  // Each push cell's honest pre-first-onState seed, typed EXACTLY as the cell's `T` (so the
  // scan's level is `DerivedCell<T>`, not a literal-widened `string`): `padiLink` at the
  // gate-closed `connecting`; `processStartedAt` with kolu-server's own boot epoch known
  // (`serverStartedAt`) and padi's genuinely not yet (`null`) — no `0` sentinel (#1034).
  const linkSeed: PadiLink = "connecting";
  const startedAtSeed: ProcessStartedAt = {
    server: serverStartedAt,
    padi: null,
  };

  // Typed against `koluSurface.spec` so every member is inferred per-entry
  // (`SurfaceDepsFor`/`ImplementSurfaceDeps` carry the spec types since #1197/#1201 — full
  // inline inference, no cast anywhere). The two DERIVED poll cells fold padi's readouts
  // on a fused cadence; the two PUSH cells scan the shared `onState`; `preferences` and
  // `viewerMode` are the Conf-backed stores. Each derived member is the reactor graph's
  // one writer — no ctx entry, its `equals` at the spec (the one wire dedup point).
  const koluDeps: ImplementSurfaceDeps<typeof koluSurface.spec> = {
    cells: {
      preferences: {
        store: preferencesStore,
        // Content-level dedup, mirroring the `session` cell. Defence in depth behind
        // the client's coalescing + no-op drop (#1041): a patch that doesn't change
        // the value skips the `state.json` write and the bus publish, so it can't
        // contend with the session autosave on the shared Conf store. `JSON.stringify`
        // is fine — Preferences is small and writes are rare once the client settles.
        equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        // Log only patched keys — values may carry user-identifying state (themes,
        // file paths in rightPanel.tab) that have no business in operator logs.
        onMutate: (patch) =>
          log.info(
            {
              keys: Object.keys(patch),
              rightPanel: patch.rightPanel
                ? Object.keys(patch.rightPanel)
                : undefined,
            },
            "preferences update",
          ),
        // POST-merge, post-`equals` (never `onMutate`, whose patch fires even when the
        // merge is a no-op): the three theme preferences are half the new-terminal
        // policy, so a real change must reach every bound padi at once rather than
        // waiting for its next (re)bind.
        onWrite: () => deps.onPolicyInputsChanged(),
      },
      // The viewer's raw OS light/dark reading — the other half of the policy, written
      // by the browser and remembered on disk (see `viewerModeStore`). Same `onWrite`
      // nudge for the same reason; the scalar `equals` lives on the spec, so a browser
      // re-publishing an unchanged reading (every reconnect does) re-pushes nothing.
      viewerMode: {
        store: viewerModeStore,
        onWrite: () => deps.onPolicyInputsChanged(),
      },
      // Live metric — a DERIVED POLL cell. Its read folds padi's `{ padi, kaval }` off the
      // re-serve mirror onto kolu-server's own RSS; its `install` fuses the 5s interval
      // with `deps.onState` so a padi drop reports `absent` at once (#1831). Whole-MB
      // `equals` at the spec; the graph is the one writer.
      processMemory: derived.cell(
        source({
          label: "processMemory",
          read: () => sampleServerMemory(deps.readPadiMemory),
          install: everyMsOr(MEMORY_SAMPLE_INTERVAL_MS, deps.onState),
        }),
      ),
      // Live signal — a DERIVED PUSH cell scanning the shared `onState`: each state change
      // folds to the projected `link`. Seeded at the gate-closed `connecting` (the scan's
      // exact-`T` honest initial — the real warming phase at boot too). `equals` at the spec
      // dedups a repeated same-link transition. The reactor graph is the one writer.
      padiLink: derived.cell(
        scan<PadiRailState, PadiLink>(padiRail, linkSeed, (_prev, s) => s.link),
      ),
      // Live signal — a DERIVED PUSH cell scanning the SAME shared `onState`: kolu-server's
      // own boot time + the bound padi's honest boot time (`null` while unbound). Seeded
      // `startedAtSeed`. `equals` at the spec. The reactor graph is the one writer.
      processStartedAt: derived.cell(
        scan(padiRail, startedAtSeed, (_prev, s) => ({
          server: serverStartedAt,
          padi: s.padiStartedAt,
        })),
      ),
      // Live diagnostic — a DERIVED POLL cell. Its read enumerates the host daemons + the
      // bound padi's identity/convergence (TOTAL-wrapped above); its `install` fuses the
      // 10s interval with `deps.onState` so a padi (re)bind refreshes version/convergence
      // at once. Structural `equals` at the spec; the graph is the one writer.
      daemonInventory: derived.cell(
        source({
          label: "daemonInventory",
          read: readDaemonInventoryTotal,
          install: everyMsOr(DAEMON_INVENTORY_SAMPLE_INTERVAL_MS, deps.onState),
        }),
      ),
      // The live forward list — a DERIVED POLL cell on a FUSED cadence, exactly
      // like `processMemory` and `daemonInventory` above. The interval is the
      // auto-cancel pass (a door whose listener died has to be noticed, and only a
      // fresh port reading can notice it); the fused `onChange` edge is every act
      // that moves the map, so opening or cancelling a forward publishes at once
      // rather than waiting out a tick. Both arms run the SAME read, so a
      // reconciled list is the only thing that ever reaches the wire.
      //
      // Poll rather than push, and not merely because the web shell's cadence
      // belongs to the reactor (it does — `seal.test.ts` pins that with a zero
      // allowlist): the fact being published genuinely IS sampled. "Which doors are
      // open" cannot be answered honestly without asking whether anything is still
      // behind them, and that answer has to be re-read on a clock.
      forwards: derived.cell(
        source({
          label: "forwards",
          read: deps.forwards.read,
          install: everyMsOr(FORWARD_REAP_INTERVAL_MS, deps.forwards.onChange),
        }),
      ),
    },
    procedures: {
      // Thin by design: each is one call into `forwards.ts`, which owns every rule.
      // A handler that decided anything here would be a second home for the policy.
      //
      // `Effect.promise`, not a declared failure: neither procedure declares an
      // `error` on the spec, so a rejection is an UNDECLARED fault ⇒ a DEFECT (D4).
      // That is the honest translation of what these two rejections are — "the door
      // could not be opened" carries the mechanism's own message and nothing
      // downstream branches on it — and the framework's own rule, not a local choice.
      forwards: {
        create: ({ input }) =>
          Effect.promise(() => deps.forwards.create(input)),
        cancel: ({ input }) =>
          Effect.promise(() => deps.forwards.cancel(input.key)),
      },
    },
  };

  // The two SIBLING surfaces kolu-server OWNS, multiplexed over one transport
  // (kolu#1197): kolu's own primitives under the `kolu` key, and surface-app's
  // COMPLETE surface (the buildInfo cell + the `identity.info` restart probe) under
  // `surfaceApp`. They are NOT merged — `implementSurfaces` keys each surface,
  // serving them at `/surface/kolu/…` and `/surface/surfaceApp/…`. The third
  // sibling, `padi`, is NOT implemented here: `index.ts`'s async boot RE-SERVES it
  // off a bound padi process and splices it into this fragment under `/surface/padi/*`.
  //
  // kolu seeds the buildInfo cell with `{ commit }` and patches `version` over it.
  // `surfaceAppServer` returns the buildInfo cell carrying `.connect` — the surface
  // runtime fires it once the cell ctx is built, republishing the resolved
  // `{ commit, version }` (server-pushed, so the `srv` rail fills in without a
  // client reload). The connector is an OWNED source now: a fault reaches the
  // runtime's `done` (routed to kolu's fatal policy below), never floats.
  //
  // ON PUBLISHER: kolu serves on the SHARED `@kolu/padi` publisher (its
  // cross-channel microtask order is load-bearing — the terminal-list vs.
  // per-terminal-exit ordering pinned by `kill.feature`), so the runtime does
  // NOT own the channel's lifetime. Distinct constructor, not a mode flag.
  const koluSurfaces = implementSurfacesOnPublisher(
    // The padi-LESS `surfaces` map (`{ kolu, surfaceApp }`) — kolu-server implements
    // only its own two siblings; the `padi` sibling's IMPL comes from the re-serve
    // (spliced in `index.ts`), and the client's wire contract stays unchanged
    // because the client dials padi through the map client, not this static router.
    surfaces,
    {
      channel: <T>(name: string) => publisherChannel<T>(publisher, name),

      // Default subsequent-read error handler for poll-shape streams.
      onStreamReadError: (err, info) =>
        log.error(
          { err: err instanceof Error ? err.message : String(err), ...info },
          "stream snapshot read failed",
        ),
    },
    {
      // ── surface-app's server deps (sibling under `surfaceApp`) ───────────
      // The build-identity cell's server fragment (skew axis) PLUS the
      // `identity.info` restart probe pinned to kolu's boot UUID. `commit` is
      // kolu's single source (`serverCommit` ← `KOLU_COMMIT_HASH`); `version`
      // lands as a `Partial<KoluBuildInfo>` patch over the library-seeded
      // `{ commit }`. Per-key deps are typed against the surface's own spec, so
      // this needs no cast.
      surfaceApp: surfaceAppServer<KoluBuildInfo>({
        buildInfo: async () => ({ version: serverVersion }),
        commit: serverCommit,
        // surface-app's identity probe (restart axis) —
        // `surface.surfaceApp.identity.info`. Pin it to the existing boot UUID
        // (`serverProcessId`) so the value is stable within a process and
        // changes on restart. Composed, not hand-written.
        processId: serverProcessId,
        // `version` is a build constant — this read can't fail — but keep the
        // fragment's error sink for the cell's contract.
        onError: (err) =>
          log.error(
            { err: err instanceof Error ? err.message : String(err) },
            "buildInfo version axis failed",
          ),
      }),

      // ── kolu's own server deps (sibling under `kolu`) ────────────────────
      // The one Conf-backed store cell (`preferences`) + the two DERIVED PUSH cells
      // scanning `onState` (`padiLink`/`processStartedAt`) + the two DERIVED poll cells
      // (`processMemory`/`daemonInventory`) — every one built above in THIS file (SR8.c),
      // the reactor graph its own writer. Every terminal-derived member rides the
      // re-served `padi` sibling.
      kolu: koluDeps,
    },
  );

  // Observe the surface runtime's `done` and route it into kolu-server's EXISTING
  // deliberately-fatal fault policy (the same disposition a floated cell-connector
  // rejection reached via the process `unhandledRejection` handler before, and the
  // same fatal treatment the default padi re-serve's `done` gets in `index.ts`): an
  // owned surface fault is unrecoverable for the web shell, so crash loud. The
  // DISPOSITION is unchanged — only the route (owned `done` instead of a floated
  // rejection). Byte-identical in the no-fault steady state.
  koluSurfaces.done.catch((err) => {
    log.fatal({ err }, "kolu surface runtime faulted — unrecoverable");
    process.exit(1);
  });

  // NB: the runtime's `close` is intentionally NOT returned. kolu-server's web-shell
  // runtime is process-lifetime (built once in boot, lives exactly as long as the
  // process), and its graceful shutdown is a SYNCHRONOUS signal handler
  // (`index.ts` → `process.exit(0)`). For a process-lifetime owner, process death IS
  // the teardown; the runtime's only owned source (the surface-app buildInfo
  // connector) is released by process exit. Returning a `close` nobody calls would be
  // a dead knob, and awaiting it inside the sync signal handler would add a
  // shutdown-hang risk (a parked connector) for zero real benefit. `done` (above) is
  // still observed — the fault channel is what matters here, not teardown.
  // The kolu+surfaceApp FINAL served fragment: the padi-less `koluSurfaceGroup` (by
  // identity — `implementSurfaces` re-walks the same `surfaces` map) and its bound
  // handlers, keyed by full wire tag. `index.ts`'s async boot merges it with the
  // re-served padi MAP fragment and the root procedures through
  // {@link assembleServedHandlers}; a tag carries its own route, so there is nothing
  // to splice or re-prefix. padi is async (an `await`ed binding), so it cannot be
  // composed here. Every DERIVED member is the reactor graph's own writer (the poll
  // cells' reads + the push cells' `scan`s over the shared `onState` source), so the
  // full ctx is not returned — but the two Conf-backed STORE cells additionally hand
  // out their server-internal writers, narrowly, for the state-backup restore
  // (#1658): `ctx.cells.<key>.set` is the framework's sanctioned in-process write
  // path for a store cell (dedupe + `onWrite` + publish ride along), and returning
  // just these two keeps the graph-owned members unreachable.
  return {
    group: koluSurfaces.group,
    handlers: koluSurfaces.handlers,
    restoreCellWriters: {
      setPreferences: (value: Preferences) =>
        koluSurfaces.ctx.kolu.cells.preferences.set(value),
      setViewerMode: (value: ViewerMode) =>
        koluSurfaces.ctx.kolu.cells.viewerMode.set(value),
    },
  } satisfies ServedFragment & {
    restoreCellWriters: {
      setPreferences: (value: Preferences) => void;
      setViewerMode: (value: ViewerMode) => void;
    };
  };
}
