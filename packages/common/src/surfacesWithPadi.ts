/**
 * The composed sibling registry: the app's `surfaces` PLUS the `padi`
 * terminal-workspace surface. This is the ONE map kolu-server serves
 * (`composeSurfaceContracts` widens the wire contract; `implementSurfaces`
 * serves the deps) and the client dials (`connectSurfaces<contract, typeof
 * surfacesWithPadi>`).
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

import { padiSurface } from "@kolu/padi/surface";
import {
  type ConnectionInfo,
  ConnectionInfoSchema,
} from "@kolu/surface-remote/connection";
import {
  defineSurfaceMap,
  type EntryStatus,
  type KeyCodec,
} from "@kolu/surface-map";
import { z } from "zod";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  HostKeySchema,
} from "./hostKey.ts";
import { surfaces } from "./surface.ts";

// The key + local-host constant live in the padi-LESS `./hostKey.ts` (so
// `contract.ts` can type the `hosts.*` root RPCs without pulling `@kolu/padi`); re-export
// them here beside the map so consumers still reach them through one module.
export { type HostKey, HostKeySchema, LOCAL_HOST } from "./hostKey.ts";

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
const SkewVersionPairSchema = z.object({
  running: z.string(),
  expected: z.string(),
});
export type SkewVersionPair = z.infer<typeof SkewVersionPairSchema>;

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
export const PadiEntryFailureSchema = z.discriminatedUnion("cause", [
  z.object({
    cause: z.literal("contract-skew-refused"),
    reason: z.string(),
    // The skew fields are defined ONCE in `SkewVersionPairSchema` and spread here —
    // one source of truth for the pair's shape and (optional) optionality, so the
    // wire arm can never drift from the `SkewVersionPair` type consumers read.
    ...SkewVersionPairSchema.shape,
  }),
  z.object({ cause: z.literal("cross-supervisor"), reason: z.string() }),
  z.object({ cause: z.literal("agent-source-unbaked"), reason: z.string() }),
  z.object({ cause: z.literal("agent-cache-unbaked"), reason: z.string() }),
  z.object({ cause: z.literal("agent-drv-unavailable"), reason: z.string() }),
  z.object({ cause: z.literal("unconverged"), reason: z.string() }),
  z.object({ cause: z.literal("auth-required"), reason: z.string() }),
  z.object({ cause: z.literal("host-key-unverified"), reason: z.string() }),
  z.object({ cause: z.literal("nix-unavailable"), reason: z.string() }),
  z.object({ cause: z.literal("link-failed"), reason: z.string() }),
  z.object({ cause: z.literal("local-start-failed"), reason: z.string() }),
]);

/** The validated padi failure value on a `failed` entry's `EntryStatus` — a
 *  discriminated union over the structural {@link EntryFailedCause}, each arm with
 *  its human `reason` and (for skew) the typed {@link SkewVersionPair}. */
export type PadiEntryFailure = z.infer<typeof PadiEntryFailureSchema>;

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
 *  and the client connects it (`connectSurfaceMap`); `padi` on the wire becomes this
 *  map's contract (the key-folded members + the `entries` membership collection). With
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
