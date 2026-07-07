/**
 * oRPC contract: defines the typed API shape shared by server and client.
 *
 * The typed reactive layer lives in `./surface` (`defineSurface(...)`) and
 * appears at `surface.<key>.<verb>` on the wire. The terminal domain's raw
 * procedures (lifecycle, attach, screen, git worktrees, …) relocated onto
 * `@kolu/padi`'s `padiSurface` across W1.R — the root `terminal.*` / `git.*`
 * namespaces this contract once carried were DELETED at W1.R7 (the
 * package-boundary seal). What remains are the two host-level raw procedures
 * that never fit a surface primitive and stay kolu-server's own: `server.info`
 * (synchronous per-host branding) and `daemon.restart`.
 *
 * The procedure I/O schemas this contract consumes are declared in this file.
 * Schemas shared with the surface layer live in `./surface` and are imported
 * there, not here.
 */

import { composeSurfaceContracts } from "@kolu/surface/define";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { HostKeySchema } from "./hostKey.ts";
import { surfaces } from "./surface";

// ── Raw oRPC procedure I/O schemas ────────────────────────────────────

export const PwaIdentitySchema = z.object({
  hostname: z.string(),
  name: z.string(),
  themeColor: z.string(),
});
export type PwaIdentity = z.infer<typeof PwaIdentitySchema>;

// The `processId` (restart axis) and `commit` (build-identity / skew axis) that
// used to ride this probe now live on the surface, owned by @kolu/surface-app:
// `processId` is the `surface.surfaceApp.identity.info` probe (surface-app served
// as a sibling surface), and `commit` is the server-pushed `buildInfo` cell
// (`koluBuildInfo`); the kaval expected/reported identities ride padi's `status`
// cell + `daemonStatus` collection, not this probe. This raw probe keeps only the
// per-host BRANDING the shell needs synchronously at boot (document title,
// watermark, PWA theme).
export const ServerInfoSchema = z.object({
  identity: PwaIdentitySchema,
});
export type ServerInfo = z.infer<typeof ServerInfoSchema>;

// ── The contract ──────────────────────────────────────────────────────

export const contract = oc.router({
  // Two sibling surfaces multiplexed over one transport (kolu#1197): kolu's OWN
  // primitives under `kolu`, and surface-app's complete surface (buildInfo cell
  // + identity probe) under `surfaceApp`. `composeSurfaceContracts` keys each
  // inner contract, producing `{ surface: { kolu: …, surfaceApp: … } }` — wire
  // paths are `surface.<key>.<prim>.<verb>`. `surfaces` is the single source
  // shared with the server + client. (The generic `terminalWorkspace` sibling
  // was retired at W1.R7 — it had zero consumers once the client moved onto
  // padi's `terminals` collection; the terminal domain is `padiSurface` now.)
  //
  // `padiSurface` (the padi plan of record, PR #1649) is NOT here — it lives in
  // `@kolu/padi`, which OWNS the terminal vocabulary (its `./vocab.ts` schemas);
  // the arrow points `kolu-common → @kolu/padi`, so kolu-common must not depend
  // BACK on `padiSurface`. kolu-server extends this contract with the `padi`
  // sibling locally (`server/src/surface.ts`) and serves it; the client consumes
  // the padi-less contract. The terminal domain's root `terminal.*` / `git.*`
  // procedures moved ONTO `padiSurface` and were deleted here at W1.R7 — only
  // `server` + `daemon` remain beside `surface`.
  ...composeSurfaceContracts(surfaces),
  server: {
    info: oc.output(ServerInfoSchema),
  },
  daemon: {
    /** Restart the local kaval daemon, preserving the session (B3.2). Captures
     *  the session before the kill, recycles the daemon (kill → wait → spawn →
     *  connect), and leaves the empty canvas + preserved session the restore
     *  card consumes. Resolves once the fresh daemon is connected — the daemon's
     *  live state rides the `daemonStatus` surface (`restarting`→`connected`),
     *  not this return value. The user reaches it from the kaval rail dialog (a
     *  running or degraded daemon) or the DegradedCanvas (a dead one). No input:
     *  one local host today, host-count-agnostic shapes deferred to R-2. */
    restart: oc.output(z.void()),
  },
  // Runtime membership of the keyed padi host map — the selector strip's add/remove
  // actions. Root RPCs (not surface members): they mutate the POOL, not one host's
  // surface. The host is re-validated as a `HostKey` at the wire (P5). These exist on
  // the shared contract (not a kolu-server-local splice like `padi`) because the CLIENT
  // strip calls them.
  hosts: {
    /** Add a padi host to the warm pool at runtime. Resolves once the pool has seeded
     *  the binding; the entry then warms through the map's `entries` collection
     *  (connecting → connected). Re-adding an existing
     *  member rejects loudly (`host already exists`) — never a silent no-op. */
    add: oc.input(z.object({ host: HostKeySchema })).output(z.void()),
    /** Remove a guest host — its map subs end typed, its session is destroyed, and it
     *  drops from `entries`. Removing the unremovable default (LOCAL_HOST / the first
     *  seed) is rejected loudly: the canvas must always keep a host to fall back to. */
    remove: oc.input(z.object({ host: HostKeySchema })).output(z.void()),
  },
});
