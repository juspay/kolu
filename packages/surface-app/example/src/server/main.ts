/**
 * Hello-world server for @kolu/surface-app — sibling surfaces, no bespoke glue.
 *
 * surface-app is served as a SIBLING surface (key `surfaceApp`) alongside the
 * app's OWN `demo` surface (the live `serverStats` cell), multiplexed over one
 * transport by `implementSurfaces`. The `surfaceApp` entry's deps come from
 * `surfaceAppServer()` in one call (commit auto-resolved, the buildInfo cell's
 * async `connect` fired internally by the surface runtime); the `demo` entry
 * wires only the example's own cell. The example writes no cell store wiring, no
 * `/sw.js` route, and no commit literal. To see skew in dev, boot with
 * `SURFACE_APP_COMMIT=<other>` — a real deploy-simulating override.
 *
 * THE LISTENER IS ONE CALL. `serveSurfaceApp` (`@kolu/surface-app/serve`) owns
 * the whole order — origin gate → upgrade (on `SURFACE_WS_PATH` and no
 * other path) → stale-tab check → heartbeat enrolment → serve — plus the shell
 * layers (fresh SPA + manifest + the `/sw.js` retirement worker), the bind, and
 * the teardown, with the inbound frame cap read from the framework constant
 * instead of guessed at. This file used to spell those five steps out by hand,
 * which is exactly how every downstream copy of it acquired a step to drop.
 *
 * What stays here is the app's own half and nothing else: which surfaces are
 * served, where the dist is, and the live connection count — the last of which
 * rides the listener's ONE event sink (`onEvent`'s `Connected`/`Disconnected`
 * arms) rather than a second callback shape.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  implementSurfacesOnPublisher,
  inMemoryPublisher,
  publisherChannel,
} from "@kolu/surface/server";
import { parseAllowedOrigins } from "@kolu/surface/ws-origin";
import { surfaceAppServer } from "@kolu/surface-app/server";
import {
  reportSurfaceAppEvent,
  serveSurfaceApp,
} from "@kolu/surface-app/serve";
import { resolveCommit } from "@kolu/surface-app/vite";
import { Effect, Exit, Scope } from "effect";
import {
  EMPTY_STATS,
  type ExampleBuildInfo,
  buildInfo as exampleBuildInfo,
  type ServerStats,
  surfaces,
} from "../common/surface.ts";

const PORT = Number(process.env.PORT ?? 7710);
const HOST = process.env.HOST ?? "127.0.0.1";
// CSWSH gate: same-origin is always allowed; list extra browser origins (a
// reverse proxy / `tailscale serve` FQDN) in `ALLOWED_ORIGINS` if you front
// this example with one. Handed to `serveSurfaceApp`, which runs the gate on the
// RAW socket before the upgrade.
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const DIST_DIR =
  process.env.KOLU_SURFACE_APP_DIST ??
  fileURLToPath(new URL("../../dist", import.meta.url));

/** The framework's own name-keyed publisher: "the same `Channel<T>` for the same
 *  name", which is what makes the surface's derived channel names bind publish
 *  site to subscribe site. Held here (rather than letting `implementSurfaces`
 *  own one) only because this server passes the factory explicitly. */
const publisher = inMemoryPublisher();

// App-specific live state — the example's OWN cell, served as a sibling
// alongside surface-app's buildInfo. The server pushes updates via
// ctx.demo.cells.serverStats.set.
let stats: ServerStats = {
  ...EMPTY_STATS,
  startedAt: Date.now(),
  now: Date.now(),
};
const statsStore = {
  get: () => stats,
  set: (next: ServerStats) => {
    stats = next;
  },
};

// Both surfaces in ONE call — the counterpart to `composeSurfaceContracts` on
// the surface side. `implementSurfaces` serves surface-app as a SIBLING (key
// `surfaceApp`) instead of merging it: the buildInfo
// cell comes from `surfaceAppServer()`, and the runtime fires the buildInfo
// cell's async `connect` (the boot axis below) for us — no app-visible connect,
// no hand-written seed→connect dance. The app's own `serverStats` cell rides
// the sibling `demo` surface. Channels are key-namespaced, so neither surface's
// `:changed` channel can collide on the wire.
//
// The build-identity surface EXTENDS the default `{ commit }` with a `bootId`
// axis the server only learns ASYNCHRONOUSLY at boot — standing in for kolu's
// pty-host `system.version`, learned over an in-process link a moment after boot.
// The fragment seeds `{ commit, bootId: "" }` synchronously, folds the resolved
// patch in when the promise settles, and the runtime republishes it to
// subscribers — no hand-written second `ctx.cells.buildInfo.set`.
const surfaceAppDeps = surfaceAppServer<ExampleBuildInfo>({
  // The schema-valid seed: every required axis at its default. Until the
  // async source settles, the cell publishes `{ commit, bootId: "" }` — a
  // full `ExampleBuildInfo`, never a half-shape missing `bootId`.
  default: exampleBuildInfo.cells.buildInfo.default,
  buildInfo: async () => {
    await new Promise((r) => setTimeout(r, 50)); // the link round-trip
    return { bootId: randomUUID().slice(0, 8) }; // a Partial<T> patch
  },
  // Surface a failed boot-time probe instead of silently keeping the seed.
  onError: (err) => console.error("buildInfo boot-time axis failed:", err),
});

const { group, handlers, ctx, done, close } = implementSurfacesOnPublisher(
  // `surfaces` (the keyed map) is the single source shared with the composed
  // group (`composeSurfaceContracts`) and the client (`surfaceClients`); here we
  // add only the server-only per-surface deps, keyed the same way.
  surfaces,
  { channel: <T>(name: string) => publisherChannel<T>(publisher, name) },
  {
    surfaceApp: surfaceAppDeps,
    // the example's OWN cell — per-key deps typed against `demoSurface`'s spec
    demo: { cells: { serverStats: { store: statsStore } } },
  },
);

// Own the supervised runtime, exactly as the doctrine (and the surface skill)
// asks a serving site to: OBSERVE `done` — an owned fault (here the buildInfo
// connector rejecting) is unrecoverable for this one-surface server, so crash
// loud rather than leave the rejection unobserved — and AWAIT `close` from the
// orderly shutdown path below so the runtime releases its owned sources before
// the process exits.
done.catch((err) => {
  console.error("surface runtime faulted — unrecoverable:", err);
  process.exit(1);
});

/** Broadcast a stats patch to every subscriber (snapshot + delta in one call). */
function pushStats(patch: Partial<ServerStats>): void {
  ctx.demo.cells.serverStats.set({ ...stats, ...patch });
}

// Tick the server clock once a second so even a single tab sees the cell update live.
setInterval(() => pushStats({ now: Date.now() }), 1000);

// The listener's whole lifetime hangs off ONE scope: `serveSurfaceApp` registers
// its teardown there (sockets dropped, server closed), so shutdown below is
// "close the scope" rather than a hand-ordered sequence this file could get
// wrong.
const scope = Scope.makeUnsafe();
const url = await Effect.runPromise(
  serveSurfaceApp({
    group,
    handlers,
    // With no dist yet there is simply nothing to serve, and every request 404s.
    clientDist: DIST_DIR,
    manifest: { name: "surface-app hello", themeColor: "#6b4eff", icons: [] },
    host: HOST,
    port: PORT,
    // CSWSH gate: same-origin is always allowed; list extra browser origins (a
    // reverse proxy / `tailscale serve` FQDN) in `ALLOWED_ORIGINS`.
    allowedOrigins: ALLOWED_ORIGINS,
    // The listener's ONE narration sink. The example uses it for the two things
    // an app actually wants from it: the live client count in the `serverStats`
    // cell, and a line when a tab bound to a previous process is retired.
    onEvent: (event) => {
      switch (event._tag) {
        case "Connected":
          return pushStats({ connections: stats.connections + 1 });
        case "Disconnected":
          return pushStats({
            connections: Math.max(0, stats.connections - 1),
          });
        case "StaleTab":
          return console.log(
            `stale tab rejected (claimed pid ${event.claimedPid})`,
          );
        default:
          // Every fault arm keeps the framework's loud default — see
          // `reportSurfaceAppEvent`.
          return reportSurfaceAppEvent(event);
      }
    },
  }).pipe(Scope.provide(scope)),
);
console.log(
  `@kolu/surface-app-example on ${url} (server commit ${resolveCommit()})`,
);
if (!existsSync(DIST_DIR)) {
  console.log(
    "  (no dist yet — run `pnpm build:client`, or start Vite for dev)",
  );
}

// Orderly shutdown: release the runtime's owned sources (its `close`), then close
// the listener's scope. A serving site OWNS `close` — process death alone would
// leak the buildInfo connector's abort-then-settle. Idempotent + guarded so a
// double signal can't run teardown twice.
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} — closing surface runtime and server`);
  await close();
  await Effect.runPromise(Scope.close(scope, Exit.void));
  process.exit(0);
}
process.on("SIGINT", (s) => void shutdown(s));
process.on("SIGTERM", (s) => void shutdown(s));
