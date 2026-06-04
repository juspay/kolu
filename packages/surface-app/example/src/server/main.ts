/**
 * Hello-world server for @kolu/surface-app — pure composition, no bespoke glue.
 *
 * The buildInfo cell's server impl + the `surfaceApp.info` probe impl are
 * composed from `surfaceAppServer()` in one call (commit auto-resolved);
 * `installSurfaceApp` serves the shell fresh + the manifest +
 * the `/sw.js` retirement worker. The example writes no cell store, no `/sw.js`
 * route, and no commit literal. To see skew in dev, boot with
 * `SURFACE_APP_COMMIT=<other>` — a real deploy-simulating override.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { implementSurface, publisherChannel } from "@kolu/surface/server";
import { installSurfaceApp, surfaceAppServer } from "@kolu/surface-app/server";
import { resolveCommit } from "@kolu/surface-app/vite";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import {
  buildInfo as exampleBuildInfo,
  EMPTY_STATS,
  type ExampleBuildInfo,
  type ServerStats,
  surface,
} from "../common/surface.ts";

const PORT = Number(process.env.PORT ?? 7710);
const HOST = process.env.HOST ?? "127.0.0.1";
const DIST_DIR =
  process.env.KOLU_SURFACE_APP_DIST ??
  fileURLToPath(new URL("../../dist", import.meta.url));

// biome-ignore lint/suspicious/noExplicitAny: MemoryPublisher's generic is too strict for our payloads; type safety lives on the typed channels.
const publisher = new MemoryPublisher<Record<string, any>>();

// App-specific live state — the example's OWN cell, composed alongside
// surface-app's buildInfo. The server pushes updates via ctx.cells.serverStats.set.
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

// The extended build-identity fragment. The `commit` is auto-resolved (env →
// git → "dev"); the `bootId` axis arrives ASYNCHRONOUSLY — standing in for
// kolu's pty-host `system.version`, learned over an in-process link a moment
// after boot. The fragment seeds `{ commit, bootId: "" }` synchronously, folds
// the resolved patch in when the promise settles, and `connect(...)` (below)
// republishes it to subscribers — no hand-written second `ctx.cells.buildInfo.set`.
const surfaceApp = surfaceAppServer<ExampleBuildInfo>({
  // The schema-valid seed: every required axis at its default. Until the async
  // source settles, the cell publishes `{ commit, bootId: "" }` — a full
  // `ExampleBuildInfo`, never a half-shape missing `bootId`.
  default: exampleBuildInfo.cells.buildInfo.default,
  buildInfo: async () => {
    await new Promise((r) => setTimeout(r, 50)); // the link round-trip
    return { bootId: randomUUID().slice(0, 8) }; // a Partial<T> patch
  },
  // Surface a failed boot-time probe instead of silently keeping the seed.
  onError: (err) => console.error("buildInfo boot-time axis failed:", err),
});

const { router: surfaceRouter, ctx } = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),
  cells: {
    ...surfaceApp.cells, // surface-app-specific: build identity (commit auto-resolved + async bootId)
    serverStats: { store: statsStore }, // app-specific: live server stats
  },
  procedures: {
    // surface-app-specific: the identity probe impl (one processId per process,
    // minted by the library) at `surface.surfaceApp.info`. Restart the server →
    // new id → status() flips to "restarted". Composed, not hand-written.
    ...surfaceApp.procedures,
  },
});

// Flow the late-arriving bootId axis through the SAME fragment: once the async
// source settles, `connect` republishes the full value over the cell's channel
// (deduped by the fragment's `equals`). The app never seeds-then-sets by hand.
void surfaceApp.cells.buildInfo.connect(ctx.cells.buildInfo);

/** Broadcast a stats patch to every subscriber (snapshot + delta in one call). */
function pushStats(patch: Partial<ServerStats>): void {
  ctx.cells.serverStats.set({ ...stats, ...patch });
}

// Tick the server clock once a second so even a single tab sees the cell update live.
setInterval(() => pushStats({ now: Date.now() }), 1000);

// biome-ignore lint/suspicious/noExplicitAny: see kolu server.ts — the router fragment's union isn't accepted by RPCHandler's input type; runtime is valid.
const appRouter = implement(surface.contract).router({
  ...surfaceRouter,
}) as any;

const app = new Hono();

const httpHandler = new RPCHandler(appRouter);
app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await httpHandler.handle(c.req.raw, {
    prefix: "/rpc",
  });
  if (matched) return response;
  await next();
});

if (existsSync(DIST_DIR)) {
  // one call: fresh shell + manifest + /sw.js retirement — all from the library.
  installSurfaceApp(app, {
    clientDist: DIST_DIR,
    manifest: { name: "surface-app hello", themeColor: "#6b4eff", icons: [] },
  });
}

const server = serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => {
    console.log(
      `@kolu/surface-app-example on http://${info.address}:${info.port} (server commit ${resolveCommit()})`,
    );
    if (!existsSync(DIST_DIR)) {
      console.log(
        "  (no dist yet — run `pnpm build:client`, or start Vite for dev)",
      );
    }
  },
);

const wsHandler = new WsRPCHandler(appRouter);
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (peer) => {
  // app-specific: reflect the live client count in the serverStats cell
  pushStats({ connections: stats.connections + 1 });
  peer.on("close", () =>
    pushStats({ connections: Math.max(0, stats.connections - 1) }),
  );
  void wsHandler.upgrade(peer);
});
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/rpc/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } else {
    socket.destroy();
  }
});
