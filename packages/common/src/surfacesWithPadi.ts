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
import { mirroredSurface } from "@kolu/surface-remote/connection";
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

// The per-host `connection` cell's value type — re-exported here so a consumer reading
// `padiMap.entry(host).cells.connection` types the readout through kolu-common (the
// map's home) rather than reaching into `@kolu/surface-remote` directly. (The log-tail
// element type is reachable as `ConnectionInfo["log"][number]` for the rare consumer
// that needs it, so no separate `LogEntry` re-export.) See {@link padiEntrySurface}.
// `ConnectPhase` (the up-but-not-yet-connected phase subset a connect/progress UI narrates)
// rides the same re-export so the client's overlay imports it through this established path.
export type {
  ConnectionInfo,
  ConnectPhase,
} from "@kolu/surface-remote/connection";

export const surfacesWithPadi = {
  ...surfaces,
  padi: padiSurface,
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
 *  binder), never scanned from `reason`'s human text by a consumer. */
export interface SkewVersionPair {
  readonly running: string;
  readonly expected: string;
}

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
 *  (`UnclassifiedEntryFailureError`) rather than bucketing into a renamed "other"
 *  (dropped in PR4). Each arm carries its human `reason` (shown verbatim on the
 *  host-down card, never parsed for control flow); `contract-skew-refused` carries
 *  the typed {@link SkewVersionPair} (D2) directly, when the binder knows it.
 *
 *   - `contract-skew-refused` — #1313: this binder is OLDER than the running padi
 *     — never drains (monotonicity).
 *   - `cross-supervisor`      — a DIFFERENT LIVE supervisor owns the state root —
 *     never drains (`remotePadiBinding`'s `crossSupervisor` verdict).
 *   - `drv-unbaked`           — `PADI_AGENT_DRVS_JSON` isn't baked (a non-Nix-wrapper run).
 *   - `drv-missing-for-system`— the baked map has no `.drv` for the probed arch.
 *   - `unconverged`           — a newer-contract drain never provably took.
 *   - `link-failed`           — the transport gave up (host unreachable / provisioning
 *     failed / a terminal give-up). */
export const PadiEntryFailureSchema = z.discriminatedUnion("cause", [
  z.object({
    cause: z.literal("contract-skew-refused"),
    reason: z.string(),
    // OPTIONAL: the binder omits the pair when it doesn't know the running/expected
    // versions (`computeEntryFailedDetail` returns `{ cause }` without them), so
    // requiring them here would REJECT a valid producer value on the wire.
    running: z.string().optional(),
    expected: z.string().optional(),
  }),
  z.object({ cause: z.literal("cross-supervisor"), reason: z.string() }),
  z.object({ cause: z.literal("drv-unbaked"), reason: z.string() }),
  z.object({ cause: z.literal("drv-missing-for-system"), reason: z.string() }),
  z.object({ cause: z.literal("unconverged"), reason: z.string() }),
  z.object({ cause: z.literal("link-failed"), reason: z.string() }),
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
export type PadiEntryStatus = EntryStatus<PadiEntryFailure>;

/** The per-host entry surface — `padiSurface` MIRRORED with the get-only `connection`
 *  cell (the same seam kolu-server's `reServeSurface` composes per host). Exposing the
 *  cell on the MAP's entry surface is what lets the client read each host's honest link
 *  health — the copying/building provisioning phase + the live `log` tail — per entry
 *  (`padiMap.entry(host).cells.connection.use()`), the fine signal the coarse
 *  `EntryStatus` chip (warming/connected/failed) folds away. The server already serves
 *  this cell per host (its re-serve mirrors the same base); declaring it here is what
 *  forwards it through the map to the browser (W6 — "the honest connect"). */
export const padiEntrySurface = mirroredSurface(padiSurface);

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
});
