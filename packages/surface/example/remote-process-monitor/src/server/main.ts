/**
 * Remote-process-monitor parent server.
 *
 * Three-tier bridge:
 *
 *   browser  ─WS surface─▶  this server  ─stdio surface─▶  remote agent
 *
 * Both legs are Effect RPC over ndjson. Browser ↔ server rides one WebSocket
 * (`serveSurfaceSocket` stands a per-connection RPC server over the shared
 * handlers); server ↔ agent uses the Surface Remote session and ssh connector
 * over stdio. The bridge is symmetrical with R-2's `RemoteTerminalBackend`: same
 * transport stack, same lifecycle, same snapshot-then-delta invariant — just
 * with process data instead of terminal data.
 *
 * Configuration (env vars):
 *
 *   HOST                          ssh target (default: localhost — see
 *                                 plan §R-1.5 "Localhost is a valid target")
 *   SURFACE_AGENT_FLAKE_REF       exact source selected by the Nix wrapper
 *                                 (or the development recipe). Required by
 *                                 Surface Remote; no fallback.
 *   PORT                          HTTP+WS port (default 7720)
 *   KOLU_SURFACE_EXAMPLE_DIST     when set, serve the pre-built client
 *                                 bundle from this dir (production mode)
 */

import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { gateWsOrigin, parseAllowedOrigins } from "@kolu/surface/ws-origin";
import {
  freshStaticLayer,
  type ServableSocket,
  serveSurfaceSocket,
} from "@kolu/surface-app/server";
import {
  makeSession,
  resolveBakedAgentDrv,
  sshConnector,
} from "@kolu/surface-remote";
import { Effect, Scope } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { WebSocketServer } from "ws";
import { surface } from "../common/surface";
import { buildSurface } from "./serve";

const HOST = process.env.HOST ?? "localhost";
const PORT = Number(process.env.PORT ?? 7720);
// CSWSH gate: this demo binds 0.0.0.0 (below), so the Origin check is what
// keeps a cross-site page from driving the unauthenticated RPC surface.
// Same-origin always passes; `ALLOWED_ORIGINS` lists reverse-proxy origins.
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

/** Tag every parent-side log so `[server]` lines are visually distinct
 *  from `[host:<h> local]` (the session) and `[host:<h> remote]`
 *  (forwarded agent stderr). Demo logs are intentionally chatty. */
function log(line: string): void {
  process.stderr.write(`[server] ${line}\n`);
}

async function main(): Promise<void> {
  log(`host=${HOST}`);

  const session = makeSession({
    initialConnection: "probing",
    // The connector takes the SURFACE as a value: Effect RPC builds its client
    // from `surface.group` and the member face is re-nested from `surface.spec`,
    // neither of which a type alone carries.
    connectOnce: sshConnector({
      surface,
      host: HOST,
      binary: "process-monitor-agent",
      // Policy-free: the CONSUMER composes the localhost arm's spawn env, keeping only
      // the keys that are SET (an empty HOME/PATH would misdirect config/command lookup).
      // kolu uses kolu-pty's `composeSpawnEnv`; a standalone example picks inline. Never
      // the caller's ambient `process.env`; unused for a real ssh host.
      localEnv: Object.fromEntries(
        (["HOME", "PATH"] as const)
          .map((k): [string, string | undefined] => [k, process.env[k]])
          .filter((e): e is [string, string] => e[1] !== undefined),
      ),
      resolveDrvPath: (ctx) =>
        resolveBakedAgentDrv("process-monitor-agent", ctx),
    }),
    label: `host:${HOST}`,
  });
  const { runtime } = buildSurface({ session });

  // ── HTTP server: serve client bundle in production ─────────────────
  // The http app is a LAYER, not a framework instance. In production
  // `freshStaticLayer` serves the built bundle (Effect's file engine for the
  // bytes, surface-app's freshness policy for the headers); in dev vite owns
  // the UI and this process answers one plain text route.
  const distDir = process.env.KOLU_SURFACE_EXAMPLE_DIST;
  const hasDist = distDir !== undefined && distDir.length > 0;
  if (hasDist) log(`serving client bundle from ${distDir}`);
  const appLayer = hasDist
    ? freshStaticLayer({ root: distDir })
    : HttpRouter.add(
        "GET",
        "/",
        HttpServerResponse.text(
          "remote-process-monitor server is up. Start vite (`pnpm run dev:client`) for the UI.",
        ),
      );

  // We own the `http.Server` so the `upgrade` seam below stays ours alone —
  // node fans an event out to every listener, and a framework-owned upgrade
  // handler would try to answer a socket we have already upgraded.
  const httpServer = createServer();
  const httpScope = Scope.makeUnsafe();
  httpServer.on(
    "request",
    await Effect.runPromise(
      Effect.gen(function* () {
        const httpEffect = yield* HttpRouter.toHttpEffect(appLayer);
        return yield* NodeHttpServer.makeHandler(httpEffect, {
          scope: httpScope,
        });
      }).pipe(
        Scope.provide(httpScope),
        Effect.provide(NodeHttpServer.layerHttpServices),
      ),
    ),
  );
  httpServer.listen({ host: "0.0.0.0", port: PORT }, () => {
    // Print the "listening" line ONLY after the bind completes —
    // otherwise Vite's WS proxy races the parent's nix-build step
    // and logs spurious ECONNREFUSED until the bind catches up.
    log(`listening on http://0.0.0.0:${PORT} (open http://localhost:${PORT}/)`);
  });

  // ── WebSocket: the browser's one transport ─────────────────────────
  const wss = new WebSocketServer({
    noServer: true,
    // 8 MiB per inbound frame — the framework's processes-collection
    // cold-start sends a 597-item key array in a single frame, which
    // is comfortably under 1 MiB; raise the cap so we can't quietly
    // hit it as the demo scales.
    maxPayload: 8 * 1024 * 1024,
  });
  wss.on("connection", (ws) => {
    log("browser ws connect");
    ws.on("close", (code, reason) =>
      log(
        `browser ws disconnect (code=${code} reason=${reason.toString() || "<none>"})`,
      ),
    );
    ws.on("error", (err) => log(`browser ws error: ${err.message}`));
    const serving = serveSurfaceSocket({
      group: runtime.group,
      handlers: runtime.handlers,
      // `ws`'s socket satisfies `ServableSocket` structurally; its typings
      // narrow `addEventListener` per event name, which the seam does not.
      socket: ws as unknown as ServableSocket,
    });
    // A serving site OWNS `done`: it resolves on hang-up and REJECTS if the
    // serving stack failed. An ignored rejection is an unhandled one.
    serving.done.catch((err) =>
      log(`browser ws serving failed: ${String(err)}`),
    );
  });
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/rpc/ws") {
      socket.destroy();
      return;
    }
    // CSWSH gate — reject a cross-site browser Origin before we upgrade.
    // Especially load-bearing here: this demo binds all interfaces.
    if (
      gateWsOrigin(req, socket, {
        allowedOrigins: ALLOWED_ORIGINS,
        onReject: (origin) =>
          log(
            `rejecting ws upgrade: disallowed Origin ${JSON.stringify(origin)}`,
          ),
      })
    ) {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });

  const shutdown = (sig: string) => {
    log(`${sig}: destroying the host session`);
    // This demo owns exactly ONE session (no shared pool — S10 deleted it), so it
    // tears down its own on shutdown.
    session.destroy();
    // `httpServer.close()` waits for in-flight connections to drain.
    // The browser's WebSocket is long-lived — it never closes on its
    // own — so a Ctrl+C hangs forever without forcing connections shut.
    // `closeAllConnections()` (Node ≥ 18.2) kills sockets immediately.
    wss.close();
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    }
    httpServer.closeAllConnections();
    httpServer.close(() => process.exit(0));
    // Belt-and-braces: if close() still hangs (unexpected stuck
    // socket), exit forcibly after a short grace window.
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`[server] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
