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

/** The padi map's DOMAIN failure cause — "why did this host's padi entry fail", a
 *  STRUCTURAL classification never parsed from `reason` (the W4 types decision,
 *  D1). Distinct from `@kolu/surface-remote`'s transport cause ("network" vs
 *  "remote" — the TRANSPORT axis, shared with drishti/odu via `SessionState`);
 *  this is padi's OWN domain axis, one layer up — not duplication, a different
 *  question at a different layer.
 *
 *   - `contract-skew-refused` — #1313: this binder is OLDER than the running padi
 *     — never drains (monotonicity).
 *   - `cross-supervisor`      — a DIFFERENT LIVE supervisor owns the state root —
 *     never drains. RESERVED: not yet a live producer — wired by the held W4 P0
 *     ownership/lineage work (`claimLocalSupervisor`'s `SupervisorClaim.kind ===
 *     "foreign"` verdict), which lands separately.
 *   - `drv-unbaked`           — `PADI_AGENT_DRVS_JSON` isn't baked (a non-Nix-wrapper run).
 *   - `drv-missing-for-system`— the baked map has no `.drv` for the probed arch.
 *   - `unconverged`           — a newer-contract drain never provably took.
 *   - `link-failed`           — the transport gave up (host unreachable / provisioning
 *     failed).
 *   - `other`                 — every other structural fault (unknown host, a plain
 *     transport failure with no more specific classification). ALWAYS a member —
 *     `@kolu/surface-map`'s own generic fallback (`projectStatus`/`statusOf`) when
 *     a registry supplies no (or no matching) domain classification lands here. */
export type EntryFailedCause =
  | "contract-skew-refused"
  | "cross-supervisor"
  | "drv-unbaked"
  | "drv-missing-for-system"
  | "unconverged"
  | "link-failed"
  | "other";

/** The typed version pair the `contract-skew-refused` cause carries (D2) — TYPED
 *  fields a producer attaches to the wire object (`packages/server`'s remote padi
 *  binder), never scanned from `reason`'s human text by a consumer. */
export interface SkewVersionPair {
  readonly running: string;
  readonly expected: string;
}

/** The padi map's published per-entry status — `EntryStatus` narrowed to padi's
 *  own {@link EntryFailedCause}, PLUS the typed {@link SkewVersionPair} sidecar on
 *  the `contract-skew-refused` cause specifically (D2). `@kolu/surface-map` can't
 *  type the version-pair fields itself (a domain-agnostic package can't know a
 *  domain's per-cause extra fields — the volatility boundary D1 draws); a padi
 *  consumer that wants typed `.running`/`.expected` reads through THIS view (a
 *  cast at the read site — `entry.state() as PadiEntryStatus`). The wire schema
 *  itself stays a loose object (`entryStatusSchema`'s `failed` arm) so the extra
 *  fields a producer attaches survive transport untouched; this type is the
 *  consumer-side promise about what they are. */
export type PadiEntryStatus =
  | Exclude<EntryStatus<EntryFailedCause>, { cause: "contract-skew-refused" }>
  | ({
      kind: "failed";
      reason: string;
      cause: "contract-skew-refused";
    } & SkewVersionPair);

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
 *  Instantiated at `EntryFailedCause` (D1, decision #1's option 2) — explicit type
 *  arguments, not inference: nothing in `defineSurfaceMap`'s runtime args
 *  (`keySchema`/`entry`/`codec`) mentions `Cause`, so it can't be inferred. Every
 *  consumer that reads `padiHostMap.entriesSpec`/`connectSurfaceMap(padiHostMap,
 *  ...)`'s `.entry(k).state()` now sees the NARROWED `EntryStatus<EntryFailedCause>`
 *  (never a bare `string` cause) by construction. */
export const padiHostMap = defineSurfaceMap<
  typeof HostKeySchema,
  typeof padiEntrySurface.spec,
  EntryFailedCause
>(HostKeySchema, padiEntrySurface, hostKeyCodec);
