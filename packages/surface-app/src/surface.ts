/**
 * @kolu/surface-app/surface — build identity as a composable surface fragment.
 *
 * "What build is the server?" is reactive server state, so it rides surface as a
 * `buildInfo` cell. The default exposes just `{ commit }`; an app composes its
 * `cells` into its own `defineSurface(...)`. Build identity is the one thing apps
 * vary — so it's an INTERFACE: `defineBuildInfo` lets kolu add a pty-host axis
 * while drishti takes the default, and both carry the same `isStale` predicate.
 */

import type { SurfaceSpec } from "@kolu/surface/define";
import { z } from "zod";
import { clientIsStale } from "./index";

/** The minimum build identity: the deployed commit. Extend it via `defineBuildInfo`. */
export interface BuildInfo {
  commit: string;
}

/** A composable build-identity fragment: a `cells` map to spread into your
 *  `defineSurface({ cells: { ...buildInfo.cells } })`, plus the `isStale`
 *  predicate the UI reads.
 *
 *  The cell is `verbs: ["get"]` — server build identity is read-only on the
 *  wire. Without this the default `["get", "set"]` would publish a `set`
 *  procedure, letting any client overwrite `{ commit, … }` and fabricate or
 *  hide stale-client state. The server still mutates it via the internal
 *  `ctx.cells.buildInfo.set` (independent of the wire verbs). */
export interface BuildInfoDef<T extends BuildInfo = BuildInfo> {
  cells: {
    buildInfo: {
      schema: z.ZodType<T>;
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
  schema: z.ZodType<T>;
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
  schema: z.object({ commit: z.string() }),
  default: { commit: "" },
});

/** What an identity probe reports: the server's `processId` — a value that
 *  changes when the server restarts, so a reconnect to a *different* process is
 *  a restart, not a transient drop. The runtime validator for the probe's wire
 *  shape; it mirrors the canonical `ServerProbe` interface in `/solid` (kept
 *  hand-equal — there is no `z.infer` derivation between the two). */
export const ServerProbeSchema = z.object({ processId: z.string() });

/** The `surface.surfaceApp.info` identity procedure as a composable fragment —
 *  the restart axis's counterpart to `buildInfo`'s skew axis. Merged into your
 *  surface via `composeSurfaces` (see `surfaceAppSurface`) so the probe procedure
 *  isn't hand-written per app (kolu's rpc.ts, the example, drishti all re-derived
 *  it). Namespaced under `surfaceApp` so the wire path is `surface.surfaceApp.info`.
 *  The server impl is `serverIdentity()` from `@kolu/surface-app/server`. */
export const serverIdentity = {
  procedures: {
    surfaceApp: {
      info: { input: z.object({}), output: ServerProbeSchema },
    },
  },
} as const;

/** One surface-app fragment to merge into your surface in a single call (via
 *  composeSurfaces): the buildInfo cell + the surfaceApp.info restart probe.
 *  Extenders (kolu's pty-host axis) pass their BuildInfoDef to surfaceAppSurfaceWith. */
export function surfaceAppSurfaceWith<T extends BuildInfo>(
  def: BuildInfoDef<T>,
) {
  return {
    cells: { ...def.cells },
    procedures: { ...serverIdentity.procedures },
  } as const;
}

/** The default surface-app fragment — the bare `{ commit }` buildInfo cell plus
 *  the `surfaceApp.info` probe. drishti merges exactly this; kolu/the example
 *  extend build identity and call `surfaceAppSurfaceWith(theirDef)` instead. */
export const surfaceAppSurface = surfaceAppSurfaceWith(buildInfo);

// ── composeSurfaces ─────────────────────────────────────────────────────

/** Field-wise intersection of two `SurfaceSpec` fragments — the precise type
 *  `defineSurface` infers from `composeSurfaces(a, b)`. Each primitive map is the
 *  intersection of the two inputs' maps; `procedures` is intersected too (a
 *  two-level map), so a namespace present in only one side survives and a
 *  namespace present in both has its verbs merged. */
export type ComposedSurfaceSpec<
  A extends SurfaceSpec,
  B extends SurfaceSpec,
> = {
  cells: NonNullable<A["cells"]> & NonNullable<B["cells"]>;
  collections: NonNullable<A["collections"]> & NonNullable<B["collections"]>;
  streams: NonNullable<A["streams"]> & NonNullable<B["streams"]>;
  events: NonNullable<A["events"]> & NonNullable<B["events"]>;
  procedures: NonNullable<A["procedures"]> & NonNullable<B["procedures"]>;
};

/** Merge two `SurfaceSpec` fragments into one spec for `defineSurface`. The
 *  buildInfo cell + probe (surface-app's fragment) merge with the app's own
 *  cells/collections/streams/events/procedures in a single call — one surface,
 *  composed not hand-wired.
 *
 *  Runtime: `cells`/`collections`/`streams`/`events` are shallow-merged per map,
 *  THROWING on a duplicate top-level key. `procedures` is merged at TWO levels —
 *  namespaces merge, and within a shared namespace verbs merge, THROWING on a
 *  duplicate verb. The result is field-wise typed so `defineSurface` still infers
 *  every entry precisely. */
export function composeSurfaces<A extends SurfaceSpec, B extends SurfaceSpec>(
  a: A,
  b: B,
): ComposedSurfaceSpec<A, B> {
  const mergeMap = (
    kind: string,
    x: Record<string, unknown> | undefined,
    y: Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...x };
    for (const [k, v] of Object.entries(y ?? {})) {
      if (k in out) {
        throw new Error(
          `composeSurfaces: duplicate ${kind} key "${k}" — both fragments define it.`,
        );
      }
      out[k] = v;
    }
    return out;
  };

  const procedures: Record<string, Record<string, unknown>> = {};
  for (const [ns, verbs] of Object.entries(a.procedures ?? {})) {
    procedures[ns] = { ...verbs };
  }
  for (const [ns, verbs] of Object.entries(b.procedures ?? {})) {
    const existing = procedures[ns] ?? {};
    for (const [verb, spec] of Object.entries(verbs)) {
      if (verb in existing) {
        throw new Error(
          `composeSurfaces: duplicate procedure verb "${ns}.${verb}" — both fragments define it.`,
        );
      }
      existing[verb] = spec;
    }
    procedures[ns] = existing;
  }

  return {
    cells: mergeMap("cells", a.cells, b.cells),
    collections: mergeMap("collections", a.collections, b.collections),
    streams: mergeMap("streams", a.streams, b.streams),
    events: mergeMap("events", a.events, b.events),
    procedures,
  } as ComposedSurfaceSpec<A, B>;
}
