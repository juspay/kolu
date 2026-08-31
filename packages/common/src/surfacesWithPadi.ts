/**
 * The composed sibling registry: the app's `surfaces` PLUS the `padi`
 * terminal-workspace surface. This is the ONE map kolu-server serves
 * (`composeSurfaceContracts` widens the served `RpcGroup`; `implementSurfaces`
 * serves the deps) and the client dials (`surfaceClients(transport,
 * surfacesWithPadi)`).
 *
 * Composing the app's registry with padi's authored surface is an APP concern,
 * so it lives here in kolu-common and imports `padiSurface` FROM `@kolu/padi`
 * (the post-flip arrow: the app consumes padi; padi never depends back on the
 * app — the seal's fifth arm enforces that). It sits in its OWN module, NOT in
 * `./surface.ts`, so the heavily-imported `kolu-common/surface` stays free of
 * the `@kolu/padi` dependency — only the two files that actually dial/serve the
 * combined map (client `wire.ts`, server `surface.ts`) reach for it.
 *
 * The padi-LESS `surfaces` (in `./surface.ts`) is what `kolu-common/contract`
 * composes and the client's own contract consumes; kolu-server extends the
 * SERVED contract with this padi-ful map locally.
 */

import { padiSurface } from "@kolu/padi-client/surface";
import { mergeDisjointGroups } from "@kolu/surface/define";
import {
  defineSurfaceMap,
  type EntryStatus,
  type KeyCodec,
} from "@kolu/surface-map";
import {
  type ConnectionInfo,
  ConnectionInfoSchema,
} from "@kolu/surface-remote/connection";
import { Schema } from "effect";
import { koluRootGroup, koluSurfaceGroup } from "./contract.ts";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  HostKeySchema,
} from "./hostKey.ts";
import { surfaces } from "./surface.ts";

// The entry's fine `connection` payload value type — re-exported here so a consumer
// reading `padiMap.entry(host).state().connection` (SR9: the fine word rides the entry,
// not a per-host cell) types the readout through kolu-common (the map's home) rather than
// reaching into `@kolu/surface-remote` directly. (The log-tail element type is reachable as
// `ConnectionInfo["log"][number]` for the rare consumer that needs it, so no separate
// `LogEntry` re-export.) `ConnectPhase` (the up-but-not-yet-connected phase subset a
// connect/progress UI narrates) rides the same re-export so the client's overlay imports it
// through this established path.
export type {
  ConnectionInfo,
  ConnectPhase,
} from "@kolu/surface-remote/connection";
// The key + local-host constant live in the padi-LESS `./hostKey.ts` (so
// `contract.ts` can type the `hosts.*` root RPCs without pulling `@kolu/padi`); re-export
// them here beside the map so consumers still reach them through one module.
export { type HostKey, HostKeySchema, LOCAL_HOST } from "./hostKey.ts";

/** The single sibling key the padi map is mounted, composed, and served under
 *  (`surface.padi.*`). Single-sourced so the composed contract, the map's own `name`,
 *  and both server splice sites reference ONE literal — change it here and every mount
 *  moves together (no "keep the string in sync" convention across files). */
export const PADI_SURFACE_NAME = "padi" as const;

export const surfacesWithPadi = {
  ...surfaces,
  [PADI_SURFACE_NAME]: padiSurface,
} as const;

/** `HostKey`'s string codec, for `defineSurfaceMap` — a discriminated-sum OBJECT is
 *  not a valid collection key/channel name by itself (`@kolu/surface-map`'s wire
 *  `mapKey`, the `entries` membership collection, and every per-key channel name are
 *  all plain strings), so this pairs `encodeHostKey`/`decodeHostKey` into the codec
 *  the map bridges through. */
const hostKeyCodec: KeyCodec<HostKey> = {
  encode: encodeHostKey,
  decode: decodeHostKey,
};

/** The typed version pair the `contract-skew-refused` failure carries (D2) — TYPED
 *  fields a producer sets on the failure value (`packages/server`'s remote padi
 *  binder), never scanned from `reason`'s human text by a consumer. Defined ONCE as
 *  a schema so the wire failure arm, the `PadiEntryFailedDetail` type, and the client
 *  reader all derive from a single source. Both fields are REQUIRED: the sole producer
 *  (`computeEntryFailedDetail` on a `skew-refused` anomaly) always has both contract
 *  versions as typed evidence. */
const SkewVersionPairSchema = Schema.Struct({
  running: Schema.String,
  expected: Schema.String,
});
export type SkewVersionPair = typeof SkewVersionPairSchema.Type;

/** The padi map's DOMAIN failure — "why did this host's padi entry fail". A
 *  STRUCTURAL classification never parsed from the human `reason` (the W4 types
 *  decision, D1). Distinct from `@kolu/surface-remote`'s transport cause ("network"
 *  vs "remote" — the TRANSPORT axis, shared with drishti/odu via `SessionState`);
 *  this is padi's OWN domain axis, one layer up — not duplication, a different
 *  question at a different layer.
 *
 *  A schema VALIDATES this value on the wire (PR4): the map's `failed` arm can only
 *  carry a value this schema accepts, and there is NO fabricated catch-all — every
 *  arm is a named structural producer, so a failure kolu can't classify fails loud
 *  (`serveHostMap`'s `UnclassifiedHostFailureError`) rather than bucketing into a
 *  renamed "other" (dropped in PR4). Each arm carries its human `reason` (shown verbatim on the
 *  host-down card, never parsed for control flow); `contract-skew-refused` carries
 *  the typed {@link SkewVersionPair} (D2) directly, when the binder knows it.
 *
 *   - `contract-skew-refused` — #1313: this binder is OLDER than the running padi
 *     — never drains (monotonicity).
 *   - `cross-supervisor`      — a DIFFERENT LIVE supervisor owns the state root —
 *     never drains (`remotePadiBinding`'s `crossSupervisor` verdict).
 *   - `agent-source-unbaked`  — the source ref isn't baked (a non-Nix-wrapper run).
 *   - `agent-cache-unbaked`   — the source ref IS baked, but the tree it names
 *     carries no binary-cache declaration: a binder built before that contract.
 *     Distinct from `agent-source-unbaked` because the remedy differs (update
 *     this kolu build, rather than launch it through its wrapper).
 *   - `agent-drv-unavailable` — that source cannot resolve padi for the probed arch.
 *   - `unconverged`           — a newer-contract drain never provably took.
 *   - `previous-protocol-epoch` — the daemon on that host speaks a protocol epoch
 *     this kolu cannot decode at all, and the takeover could not complete
 *     (juspay/kolu#2101). A SEPARATE arm from `unconverged` even though the
 *     framework anomaly is the same `unconverged` kind, because the operator's
 *     situation is not the same one: nothing drained and nothing timed out — the
 *     two ends cannot speak. Its remedy (get a current build onto that host) has
 *     nothing to do with "retry from the host", so rendering the generic
 *     unconverged card would send an operator down the wrong path. Produced by
 *     `computeEntryFailedDetail` when the standing convergence is `unconverged`
 *     with cause `unspeakable-protocol`.
 *   - `auth-required`         — the host refused kolu's ssh credentials. kolu
 *     connects strictly non-interactively (`BatchMode`), so a password /
 *     keyboard-interactive gate can never be answered — terminal until the
 *     operator sets up key-based ssh (the remote-hosts prerequisite).
 *   - `host-key-unverified`   — ssh refused the HOST's identity (an unknown or
 *     changed host key); the trust prompt is likewise unanswerable — terminal
 *     until the operator verifies the key with one interactive `ssh`.
 *   - `nix-unavailable`       — ssh worked, but the host's shell could not run
 *     `nix-instantiate` (exit 127): no Nix installed, or none on a
 *     non-interactive PATH. padi is provisioned with the host's own Nix, so
 *     there is nothing to proceed with — terminal.
 *   - `link-failed`           — a REMOTE transport gave up (host unreachable /
 *     provisioning failed / a remote terminal give-up). Set by the remote arm's
 *     convergence machine (`remotePadiBinding`, on the `failed` phase).
 *   - `local-start-failed`    — the LOCAL padi couldn't start on THIS machine (a
 *     terminal give-up with no convergence channel — the local arm's
 *     `entryFailedDetail()` is always null). A DISTINCT producer from `link-failed`
 *     (a spawn/connect failure here, not a network reach), with a distinct remedy
 *     (check the local install/logs), so it earns its own arm rather than
 *     collapsing into `link-failed` — which would be `"other"` wearing a better
 *     name. `padiFailureOf` mints it for the `detail === null && phase === "failed"`
 *     case, which is uniquely the local arm (the remote arm always carries a
 *     `link-failed` detail on a terminal give-up). */
export const PadiEntryFailureSchema = Schema.Union([
  Schema.Struct({
    cause: Schema.Literal("contract-skew-refused"),
    reason: Schema.String,
    // The skew fields are defined ONCE in `SkewVersionPairSchema` and spread here —
    // one source of truth for the pair's shape and (optional) optionality, so the
    // wire arm can never drift from the `SkewVersionPair` type consumers read.
    // (`Schema.Struct` exposes its field map as `.fields`, zod's `.shape`.)
    ...SkewVersionPairSchema.fields,
  }),
  Schema.Struct({
    cause: Schema.Literal("cross-supervisor"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("agent-source-unbaked"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("agent-cache-unbaked"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("agent-drv-unavailable"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("unconverged"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("previous-protocol-epoch"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("auth-required"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("host-key-unverified"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("nix-unavailable"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("link-failed"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("local-start-failed"),
    reason: Schema.String,
  }),
]);

/** The validated padi failure value on a `failed` entry's `EntryStatus` — a
 *  discriminated union over the structural {@link EntryFailedCause}, each arm with
 *  its human `reason` and (for skew) the typed {@link SkewVersionPair}. */
export type PadiEntryFailure = typeof PadiEntryFailureSchema.Type;

/** The padi map's failure-cause discriminant — DERIVED from
 *  {@link PadiEntryFailureSchema} (ONE source of truth), so the vocabulary and its
 *  wire validation can never drift. There is deliberately no `"other"` member: PR4
 *  bans a renamed catch-all, so an unclassifiable failure fails loud instead. */
export type EntryFailedCause = PadiEntryFailure["cause"];

/** The padi map's published per-entry status — `EntryStatus` narrowed to padi's own
 *  {@link PadiEntryFailure}. Because the failure IS a discriminated union (with the
 *  skew sidecar typed on its own arm), a consumer reads `state.failure.cause` /
 *  `state.failure.reason` (and `state.failure.running/expected` on the skew arm)
 *  with full narrowing — no cast, and the wire value is validated against the
 *  schema, not waved through as loose unknown extras. */
export type PadiEntryStatus = EntryStatus<PadiEntryFailure, ConnectionInfo>;

/** The per-host entry surface — `padiSurface`, served verbatim. SR9: the honest link
 *  health (the probing/provisioning phase + the live `log` tail the coarse
 *  `EntryStatus` chip folds away) is NO LONGER a separate get-only `connection` cell on
 *  this surface — it rides the map ENTRY's fine `connection` payload
 *  ({@link padiHostMap}'s `connection: ConnectionInfoSchema`), the ONE authority both the
 *  dot and the word derive from. So a client reads `padiMap.entry(host).state().connection`
 *  (the same entry it reads the dot from), never a second per-host subscription. */
export const padiEntrySurface = padiSurface;

/** The keyed map of padi surfaces — ONE entry surface ({@link padiEntrySurface}) served
 *  N times, keyed by host. kolu-server serves it (`serveHostMap` over the warm ssh pool)
 *  and the client connects it (`connectSurfaceMap`); the wire tags under
 *  `surface/padi/` become this map's own group (the key-folded members + the `entries`
 *  membership collection), which a host merges as `{group, handlers}`. With
 *  the host env unset the map has exactly one member (the local host) — pixel-identical.
 *
 *  The `failure` schema ({@link PadiEntryFailureSchema}) is what makes `Failure`
 *  INFERRED (PR4) — no explicit type arguments needed: every consumer that reads
 *  `padiHostMap.entriesSpec`/`connectSurfaceMap(padiHostMap, …)`'s `.entry(k).state()`
 *  sees the NARROWED `EntryStatus<PadiEntryFailure>` (a schema-validated domain
 *  value, never a bare `string` cause) by construction. */
export const padiHostMap = defineSurfaceMap({
  key: HostKeySchema,
  entry: padiEntrySurface,
  codec: hostKeyCodec,
  failure: PadiEntryFailureSchema,
  // SR9 — the FINE connection payload rides every LIVE entry (the ONE connection authority;
  // a `failed` entry carries none — its post-mortem is the failure record instead):
  // `serveHostMap` produces the coarse dot and this fine word from the SAME session frame,
  // so the client derives the connect overlay / status word from `state().connection`
  // without a second per-host subscription (fixes the dot-vs-word split, drishti#102).
  connection: ConnectionInfoSchema,
  // The membership `entries` collection's client error policy (SR11) — a plain `toast`
  // (the membership stream has no per-host origin), so a host-membership subscription
  // failure reaches the ONE interpreter as `Host membership error: …` (byte-identical to
  // the deleted `onHostMembershipError`). Threaded onto `entriesSpec.client`.
  entriesClient: { onError: { kind: "toast", label: "Host membership" } },
  // The sibling key this map is mounted + served under (`surface.padi.*`), single-sourced
  // through {@link PADI_SURFACE_NAME} (PR3): `connectSurfaceMap(padiHostMap, transport)`
  // slices this name from the combined socket, and both server splice sites mount under
  // the SAME const — so the mount name lives in ONE place, not a "keep three literals in
  // sync" convention, and no `as any` reaches into the contract.
  name: PADI_SURFACE_NAME,
});

// ── THE kolu wire, as one flat group ──────────────────────────────────────
//
// kolu's complete wire is a SUPERSET of the shared `kolu-common` contract: the
// root procedures PLUS the two siblings kolu-server owns (`kolu`, `surfaceApp`)
// PLUS the padi HOST MAP — the key-folded `surface/padi/*` members + the `entries`
// membership collection that `serveHostMap` serves. Under Effect RPC the wire
// namespace is FLAT (PLAN D1), so a "sibling" is a tag PREFIX and the superset is
// one merge of three DISJOINT halves:
//
//   koluRootGroup    → `server/*`, `daemon/*`, `hosts/*`     (7 tags)
//   koluSurfaceGroup → `surface/kolu/*`, `surface/surfaceApp/*`
//   padiHostMap.group→ `surface/padi/*` (folded members + `entries`)
//
// **Why it lives HERE and not at either consumer.** Two modules need this exact
// expression: kolu-server serves it (`servedGroup`) and the one-shot `kolu-rpc`
// caller dials it (`wireGroup`). Spelled twice, "the caller can spell exactly what
// the server serves" was a rule kept by a TEST that pinned two copies equal — and a
// rule a test remembers is a rule that can be broken, since a fourth half merged
// into one copy leaves the other answering "no member is served at tag" for a tag
// that IS served. The constraint that produced the two copies is real but narrower
// than it looked: `server/src/surface.ts` constructs the `Conf` store at IMPORT, so
// a one-shot CLI caller must not import THAT module. It says nothing about the
// derivation, which has a side-effect-free home — this one, which already imports
// both halves' sources. So there is one assembly, and both consumers alias it.
//
// **Why the padi-LESS `koluSurfaceGroup`, not `composeSurfaceContracts(surfacesWithPadi)`.**
// The oRPC original spread the padi-FUL composition and then OVERWROTE the `padi`
// key with the map's own contract, because the two describe the same wire paths
// with different payloads (the map folds every member behind a `{mapKey, input}`
// envelope). A flat merge cannot express "overwrite" honestly: it is a
// last-writer-wins `Map.set` (#16), so merging BOTH would silently drop one
// spelling of every shared tag AND leave the plain sibling's three reserved
// `surface/padi/system/*` tags ADVERTISED with nothing bound to them — an
// advertised-but-unhandled tag, which is exactly the silent-404 class this
// assembly exists to prevent. So the padi half enters ONCE, as the map, and the
// two remaining halves are provably disjoint from it.
//
// **The proof is the framework's, not this file's.** `RpcGroup.make`/`.merge` have
// zero collision detection, so disjointness is only real if it is counted — and
// `mergeDisjointGroups` (`@kolu/surface/define`) is the ONE place that count is
// spelled, for every consumer of a composed wire. Handed the three halves under
// their own names, it names both halves of any collision instead of reporting a
// total that came up short. It runs at IMPORT — a boot crash, never a production
// 404 on `/surface/padi/*` (the regression `server/src/router.test.ts` was written
// for, restated on the tag axis now that there is no matcher tree to inspect).
//
// No cast, and that is the merge's doing: `RpcGroup<in out R>` is INVARIANT in its
// element union, so a group whose elements are precisely-typed `Rpc`s (the root
// procedures, spelled member by member in `./contract.ts`) is not assignable to the
// erased `RpcGroup<Rpc.Any>` every serving seam takes — even though every element
// IS an `Rpc.Any`. `mergeDisjointGroups` takes the erasure on itself rather than
// demanding it of each caller, so the three halves go in as they are and the result
// is the erased group the serve and dial paths want.
/** The halves of kolu's wire that are NOT sibling surfaces — the hand-written
 *  root procedures (`server/*`, `daemon/*`, `hosts/*`) and the padi HOST MAP's
 *  key-folded members. Labelled, because that is how `mergeDisjointGroups`
 *  reports a collision.
 *
 *  ONE list with TWO readers, and that is the point: {@link koluWireGroup} merges
 *  them with the siblings for the serve and for `kolu-rpc`, and the BROWSER hands
 *  the same values to `connectSurfaces`' `extraGroups` (`client/src/wire.ts`),
 *  which cannot take a whole group because it derives the sibling half from the
 *  surfaces themselves. Hand-listed at that second reader — as it was — a fourth
 *  half would reach the server and `kolu-rpc` and silently leave the TAB short:
 *  the wire connects and every call at that tag dies, because Effect RPC resolves
 *  a call's schemas by looking its tag up in the group the wire was built over. */
export const koluNonSiblingGroups = {
  root: koluRootGroup,
  padiMap: padiHostMap.group,
} as const;

export const koluWireGroup = mergeDisjointGroups({
  koluSurfaces: koluSurfaceGroup,
  ...koluNonSiblingGroups,
});
