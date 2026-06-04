/**
 * @kolu/surface-app/surface — build identity as a composable surface fragment.
 *
 * "What build is the server?" is reactive server state, so it rides surface as a
 * `buildInfo` cell. The default exposes just `{ commit }`; an app composes its
 * `cells` into its own `defineSurface(...)`. Build identity is the one thing apps
 * vary — so it's an INTERFACE: `defineBuildInfo` lets kolu add a pty-host axis
 * while drishti takes the default, and both carry the same `isStale` predicate.
 */

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
 *  a restart, not a transient drop. The single source of truth for the probe's
 *  wire shape; `/solid`'s `ServerProbe` is `z.infer` of this. */
export const ServerProbeSchema = z.object({ processId: z.string() });

/** The `server.info` identity procedure as a composable fragment — the restart
 *  axis's counterpart to `buildInfo`'s skew axis. Spread `...serverIdentity.procedures`
 *  into your `defineSurface({ procedures })` so the probe procedure isn't
 *  hand-written per app (kolu's rpc.ts, the example, drishti all re-derived it).
 *  The server impl is `serverIdentity()` from `@kolu/surface-app/server`. */
export const serverIdentity = {
  procedures: {
    server: {
      info: { input: z.object({}), output: ServerProbeSchema },
    },
  },
} as const;
