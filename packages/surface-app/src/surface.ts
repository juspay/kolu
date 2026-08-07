/**
 * @kolu/surface-app/surface — build identity as a standalone surface.
 *
 * "What build is the server?" is reactive server state, so it rides surface as a
 * `buildInfo` cell. The default exposes just `{ commit }`; an app extends it via
 * `defineBuildInfo`. Build identity is the one thing apps vary — so it's an
 * INTERFACE: `defineBuildInfo` lets kolu add a pty-host axis while drishti takes
 * the default, and both carry the same `isStale` predicate.
 *
 * surface-app is a COMPLETE surface, not a fragment merged into the app surface.
 * A consumer serves it as a SIBLING of their own surface — a keyed map of
 * independent surfaces multiplexed over one transport (`implementSurfaces` /
 * `surfaceClients` / `composeSurfaceContracts` in `@kolu/surface`). Registered
 * under a key (e.g. `surfaceApp`), its wire path is `surface.surfaceApp.*`.
 */

import { defineSurface, type WireSchema } from "@kolu/surface/define";
import { Schema } from "effect";
import { clientIsStale } from "./index";

/** The minimum build identity: the deployed commit. Extend it via `defineBuildInfo`. */
export interface BuildInfo {
  commit: string;
}

/** A composable build-identity fragment: a `cells` map to spread into the
 *  surface's `defineSurface({ cells: { ...buildInfo.cells } })`, plus the
 *  `isStale` predicate the UI reads.
 *
 *  The cell is `verbs: ["get"]` — server build identity is read-only on the
 *  wire. Without this the default `["get", "set"]` would publish a `set`
 *  procedure, letting any client overwrite `{ commit, … }` and fabricate or
 *  hide stale-client state. The server still mutates it via the internal
 *  `ctx.cells.buildInfo.set` (independent of the wire verbs). */
export interface BuildInfoDef<T extends BuildInfo = BuildInfo> {
  cells: {
    buildInfo: {
      schema: WireSchema<T>;
      default: T;
      verbs: readonly ["get"];
    };
  };
  isStale: (server: T, clientCommit: string | undefined) => boolean;
}

/** Define a build-identity fragment. The default `isStale` is the pure,
 *  clean-ref-guarded commit comparison; extend `schema` (and `isStale`) to add
 *  more axes — e.g. kolu's pty-host divergence. */
export function defineBuildInfo<T extends BuildInfo>(opts: {
  schema: WireSchema<T>;
  default: T;
  isStale?: (server: T, clientCommit: string | undefined) => boolean;
}): BuildInfoDef<T> {
  return {
    cells: {
      buildInfo: {
        schema: opts.schema,
        default: opts.default,
        verbs: ["get"] as const,
      },
    },
    isStale:
      opts.isStale ??
      ((server, clientCommit) => clientIsStale(server.commit, clientCommit)),
  };
}

/** The default build identity: `{ commit }`. drishti uses exactly this. */
export const buildInfo: BuildInfoDef = defineBuildInfo({
  schema: Schema.Struct({ commit: Schema.String }),
  default: { commit: "" },
});

/** What an identity probe reports: the server's `processId` — a value that
 *  changes when the server restarts, so a reconnect to a *different* process is
 *  a restart, not a transient drop. This schema is the single source of the
 *  probe's wire shape: the `ServerProbe` type is derived from it via
 *  `typeof …Schema.Type` (and re-exported from `/solid`), so the validator and
 *  the type can't desync.
 *
 *  WIRE format, byte-pinned by `surface.test.ts`: `{"processId":"<id>"}`, the
 *  same bytes the zod original encoded (a required, non-optional string). */
export const ServerProbeSchema = Schema.Struct({ processId: Schema.String });

/** The probe's wire shape as a type, derived from `ServerProbeSchema` (the one
 *  source). An app may send a superset (the `/solid` provider is generic over
 *  the probe response — see its `P`). */
export type ServerProbe = typeof ServerProbeSchema.Type;

/** The probe's INPUT: no arguments. Spelled as an empty struct (not
 *  `Schema.Void`) so the encoded payload stays the `{}` object the zod-era
 *  contract put on the wire — `Schema.Void` would encode `null` (PLAN D8's
 *  measured divergence (3)), changing the frame for a member whose shape is
 *  part of the app handshake. */
export const ServerProbeInputSchema = Schema.Struct({});

/** Build the standalone surface-app surface for a given build-identity def: the
 *  `buildInfo` cell (read-only) plus the `identity.info` restart probe. The
 *  probe lives in this surface's OWN `identity` namespace, so a consumer that
 *  registers this surface under key `surfaceApp` gets the wire path
 *  `surface.surfaceApp.identity.info` (the key namespaces the sibling; the probe
 *  namespace is `identity`). Extenders (kolu's pty-host axis) pass their
 *  `BuildInfoDef` here; the server impl is `surfaceAppServer()` from
 *  `@kolu/surface-app/server`. */
export function surfaceAppSurfaceWith<T extends BuildInfo>(
  def: BuildInfoDef<T>,
) {
  return defineSurface({
    cells: { ...def.cells },
    procedures: {
      identity: {
        info: { input: ServerProbeInputSchema, output: ServerProbeSchema },
      },
    },
  });
}

/** The default surface-app surface — the bare `{ commit }` buildInfo cell plus
 *  the `identity.info` restart probe. drishti serves exactly this as a sibling;
 *  kolu/the example extend build identity and call `surfaceAppSurfaceWith(theirDef)`
 *  instead. */
export const surfaceAppSurface = surfaceAppSurfaceWith(buildInfo);
