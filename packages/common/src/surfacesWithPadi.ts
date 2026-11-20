import { oduCarriedSurface, padiSurface } from "@kolu/padi-client/surface";
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

export type {
  ConnectionInfo,
  ConnectPhase,
} from "@kolu/surface-remote/connection";
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
 *  vs "remote" — the TRANSPORT axis); this is padi's OWN domain axis, one layer up.
 *
 *  A schema VALIDATES this value on the wire (PR4): the map's `failed` arm can only
 *  carry a value this schema accepts, and there is NO fabricated catch-all — every
 *  arm is a named structural producer, so a failure kolu can't classify fails loud
 *  (`serveHostMap`'s `UnclassifiedHostFailureError`). Each arm carries its human
 *  `reason` (shown verbatim on the host-down card, never parsed for control flow);
 *  `contract-skew-refused` carries the typed {@link SkewVersionPair} (D2) directly,
 *  when the binder knows it.
 *
 *   - `contract-skew-refused` — #1313: this binder is OLDER than the running padi
 *     — never drains (monotonicity).
 *   - `cross-supervisor`      — a DIFFERENT LIVE supervisor owns the state root —
 *     never drains (`remotePadiBinding`'s `crossSupervisor` verdict).
 *   - `agent-source-unbaked`  — the source ref isn't baked (a non-Nix-wrapper run).
 *   - `agent-cache-unbaked`   — the source ref IS baked, but the tree it names
 *     carries no binary-cache declaration: a binder built before that contract.
 *   - `agent-drv-unavailable` — that source cannot resolve padi for the probed arch.
 *   - `unconverged`           — a newer-contract drain never provably took.
 *   - `previous-protocol-epoch` — the daemon on that host speaks a protocol epoch
 *     this kolu cannot decode at all, and the takeover could not complete
 *     (juspay/kolu#2101). Produced by `computeEntryFailedDetail` when the standing
 *     convergence is `unconverged` with cause `unspeakable-protocol`.
 *   - `auth-required`         — the host refused kolu's ssh credentials. kolu
 *     connects strictly non-interactively (`BatchMode`), so a password /
 *     keyboard-interactive gate can never be answered — terminal until the
 *     operator sets up key-based ssh.
 *   - `host-key-unverified`   — ssh refused the HOST's identity (an unknown or
 *     changed host key); the trust prompt is likewise unanswerable — terminal
 *     until the operator verifies the key with one interactive `ssh`.
 *   - `nix-unavailable`       — ssh worked, but the host's shell could not run
 *     `nix-instantiate` (exit 127): no Nix installed, or none on a
 *     non-interactive PATH — terminal.
 *   - `connect-stalled`       — a REMOTE give-up of the transport class: a step of
 *     the dial went silent past its bound too many times. The only way a
 *     `"network"` session ever stops retrying, so it names THAT fact — never
 *     "unreachable", which it cannot know.
 *   - `host-setup-failed`     — a REMOTE give-up of the remote class: the host
 *     answered, and bringing padi up there kept failing. Both remote arms are
 *     minted by `padiFailureOf` for a provisioning arm's terminal give-up with no
 *     finer detail, split on the session's own transport `cause` — a structural
 *     fact, never read from the reason text.
 *   - `local-start-failed`    — the LOCAL padi couldn't start on THIS machine (a
 *     terminal give-up with no convergence channel — the local arm's
 *     `entryFailedDetail()` is always null). `padiFailureOf` mints it for the
 *     `detail === null && phase === "failed"` case on a NON-provisioning arm
 *     (`session.provisions === false`), which is uniquely the local arm. */
export const PadiEntryFailureSchema = Schema.Union([
  Schema.Struct({
    cause: Schema.Literal("contract-skew-refused"),
    reason: Schema.String,
    // The skew fields are defined ONCE in `SkewVersionPairSchema` and spread here —
    // one source of truth for the pair's shape and (optional) optionality, so the
    // wire arm can never drift from the `SkewVersionPair` type consumers read.
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
    cause: Schema.Literal("connect-stalled"),
    reason: Schema.String,
  }),
  Schema.Struct({
    cause: Schema.Literal("host-setup-failed"),
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
  siblings: { odu: oduCarriedSurface },
  codec: hostKeyCodec,
  failure: PadiEntryFailureSchema,
  // SR9 — the FINE connection payload rides every LIVE entry (the ONE connection authority;
  // a `failed` entry carries none — its post-mortem is the failure record instead).
  connection: ConnectionInfoSchema,
  entriesClient: { onError: { kind: "toast", label: "Host membership" } },
  // The sibling key this map is mounted + served under (`surface.padi.*`), single-sourced
  // through {@link PADI_SURFACE_NAME} (PR3) — so the mount name lives in ONE place, not a
  // "keep three literals in sync" convention.
  name: PADI_SURFACE_NAME,
});

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
