/**
 * Remote-process-monitor parent server.
 *
 * Three-tier bridge:
 *
 *   browser  ─WS oRPC─▶  this server  ─stdio oRPC─▶  remote agent
 *
 * Browser ↔ server uses the framework's existing WebSocket transport
 * (`@orpc/server/ws`). Server ↔ agent uses R-1.5's new stdio link via
 * `HostSession`. The bridge is symmetrical with R-2's
 * `RemoteTerminalBackend`: same transport stack, same lifecycle, same
 * snapshot-then-delta invariant — just with process data instead of
 * terminal data.
 *
 * Configuration (env vars):
 *
 *   HOST                          ssh target (default: localhost — see
 *                                 plan §R-1.5 "Localhost is a valid target")
 *   KOLU_AGENT_DRV  (required)    path to the agent's `.drv`; the
 *                                 derivation is shipped to the target
 *                                 host and realised there for the
 *                                 right architecture. **No fallback** —
 *                                 the operator names this explicitly
 *                                 (lesson #2: matched-pair-by-operator-
 *                                 named-input).
 *   PORT                          HTTP+WS port (default 7720)
 *   KOLU_SURFACE_EXAMPLE_DIST     when set, serve the pre-built client
 *                                 bundle from this dir (production mode)
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  gateWsOrigin,
  type OriginGateRequest,
  parseAllowedOrigins,
  type UpgradeSocket,
} from "@kolu/surface/ws-origin";
import { destroyAllSessions, getHostSession } from "@kolu/surface-nix-host";
import { RPCHandler } from "@orpc/server/ws";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import type { surface } from "../common/surface";
import { buildRouter } from "./router";

const HOST = process.env.HOST ?? "localhost";
const DRV_PATH = process.env.KOLU_AGENT_DRV;
const PORT = Number(process.env.PORT ?? 7720);
// CSWSH gate: this demo binds 0.0.0.0 (below), so the Origin check is what
// keeps a cross-site page from driving the unauthenticated RPC surface.
// Same-origin always passes; `ALLOWED_ORIGINS` lists reverse-proxy origins.
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

/** Tag every parent-side log so `[server]` lines are visually distinct
 *  from `[host:<h> local]` (HostSession) and `[host:<h> remote]`
 *  (forwarded agent stderr). Demo logs are intentionally chatty. */
function log(line: string): void {
  process.stderr.write(`[server] ${line}\n`);
}

async function main(): Promise<void> {
  if (DRV_PATH === undefined || DRV_PATH.length === 0) {
    log(
      "KOLU_AGENT_DRV is required (no fallback). Set it to the agent's .drv path — e.g. `KOLU_AGENT_DRV=$(nix eval --raw .#packages.<system>.process-monitor-agent.drvPath)`.",
    );
    process.exit(1);
  }
  log(`host=${HOST}, agent drv=${DRV_PATH}`);

  const session = getHostSession<typeof surface.contract>({
    host: HOST,
    // This example takes the .drv straight from the environment (no arch
    // probe), so the resolver is a constant. Consumers that pick the .drv
    // per host's nix-system pass an async probe here instead — see
    // `resolveSystem` in @kolu/surface-nix-host.
    resolveDrvPath: () => Promise.resolve(DRV_PATH),
    binary: "process-monitor-agent",
  });
  const { router } = buildRouter({ session });

  // ── HTTP server: serve client bundle in production ─────────────────
  const app = new Hono();
  const distDir = process.env.KOLU_SURFACE_EXAMPLE_DIST;
  if (distDir !== undefined && distDir.length > 0) {
    app.use("*", serveStatic({ root: distDir }));
    log(`serving client bundle from ${distDir}`);
  } else {
    app.get("/", (c) =>
      c.text(
        "remote-process-monitor server is up. Start vite (`pnpm run dev:client`) for the UI.",
      ),
    );
  }

  const httpServer = serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: "0.0.0.0",
    },
    (info) => {
      // Print the "listening" line ONLY after the bind completes —
      // otherwise Vite's WS proxy races the parent's nix-build step
      // and logs spurious ECONNREFUSED until the bind catches up.
      log(
        `listening on http://${info.address}:${info.port} (open http://localhost:${info.port}/)`,
      );
    },
  );

  // ── WebSocket: oRPC over @orpc/server/ws ───────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: same Lazy<Router> spread typing dance as kolu/server.ts uses on its own appRouter.
  const wsHandler = new RPCHandler(router as any);
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
    void wsHandler.upgrade(
      ws as unknown as Parameters<typeof wsHandler.upgrade>[0],
    );
  });
  (
    httpServer as unknown as {
      on: (
        event: "upgrade",
        cb: (req: unknown, socket: unknown, head: unknown) => void,
      ) => void;
    }
  ).on("upgrade", (req, socket, head) => {
    const r = req as OriginGateRequest & { url?: string };
    const s = socket as UpgradeSocket;
    if (r.url !== "/rpc/ws") {
      s.destroy();
      return;
    }
    // CSWSH gate — reject a cross-site browser Origin before oRPC upgrades.
    // Especially load-bearing here: this demo binds all interfaces.
    if (
      gateWsOrigin({ headers: r.headers ?? {} }, s, {
        allowedOrigins: ALLOWED_ORIGINS,
        onReject: (origin) =>
          log(
            `rejecting ws upgrade: disallowed Origin ${JSON.stringify(origin)}`,
          ),
      })
    ) {
      return;
    }
    wss.handleUpgrade(
      req as Parameters<typeof wss.handleUpgrade>[0],
      socket as Parameters<typeof wss.handleUpgrade>[1],
      head as Parameters<typeof wss.handleUpgrade>[2],
      (ws) => wss.emit("connection", ws, req),
    );
  });

  const shutdown = (sig: string) => {
    log(`${sig}: destroying host sessions`);
    destroyAllSessions();
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
    const srv = httpServer as unknown as {
      closeAllConnections?: () => void;
      close: (cb?: () => void) => void;
    };
    srv.closeAllConnections?.();
    srv.close(() => process.exit(0));
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
