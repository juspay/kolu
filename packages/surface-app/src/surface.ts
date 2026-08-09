/**
 * @kolu/surface-app/surface — build identity as a standalone surface.
 *
 * "What build is the server?" is reactive server state, so it rides surface as a
 * `buildInfo` cell. The default exposes just `{ commit }`; an app extends it via
 * `defineBuildInfo`. Build identity is the one thing apps vary — so it's an
 * INTERFACE: `defineBuildInfo` lets kolu add a pty-host axis while drishti takes
 * the default, and both carry the same `isStale` predicate.
 *
 * The RESTART axis is not here. "Which process is serving me?" is a question every
 * surface answers through `@kolu/surface`'s reserved `system/identity` member, so
 * surface-app declares no probe of its own — see {@link ServerProbe}.
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

/** What an identity probe must report for `createServerLifecycle` to classify a
 *  reconnect: the server's `processId` — a value that changes when the server
 *  restarts, so a reconnect to a *different* process is a restart, not a transient
 *  drop.
 *
 *  It is a STRUCTURAL bound, not a member surface-app declares. surface-app used to
 *  ship its own `identity.info` procedure with this shape; the framework's reserved
 *  `system/identity` now carries `processId` itself, so `probeSurfaceIdentity`
 *  (`@kolu/surface/identity`) satisfies this bound over ANY surface — including one
 *  that never heard of surface-app. That is the point: an app should not have to
 *  declare a member to find out whether it is still talking to the process that
 *  served its page. */
export type ServerProbe = { processId: string };

/** Build the standalone surface-app surface for a given build-identity def: the
 *  `buildInfo` cell (read-only). Extenders (kolu's pty-host axis) pass their
 *  `BuildInfoDef` here; the server impl is `surfaceAppServer()` from
 *  `@kolu/surface-app/server`.
 *
 *  The `identity.info` probe that used to sit beside the cell is GONE — it
 *  duplicated the framework-reserved `system/identity`, which every surface already
 *  answers with the same per-process id. Its removal is what lets an app with no
 *  surface-app sibling at all (olai) run the same stale-tab handshake and the same
 *  lifecycle. */
export function surfaceAppSurfaceWith<T extends BuildInfo>(
  def: BuildInfoDef<T>,
) {
  return defineSurface({ cells: { ...def.cells } });
}

/** The default surface-app surface — the bare `{ commit }` buildInfo cell.
 *  drishti serves exactly this as a sibling; kolu/the example extend build
 *  identity and call `surfaceAppSurfaceWith(theirDef)` instead. */
export const surfaceAppSurface = surfaceAppSurfaceWith(buildInfo);
