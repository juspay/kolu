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
 * Configuration:
 *
 *   HOST           — ssh target (default: localhost — see plan §R-1.5
 *                    "Localhost is a valid target")
 *   AGENT_PATH     — pre-built agent /nix/store path; overrides
 *                    `nix build` (handy during `pnpm dev`)
 *   AGENT_FLAKE    — flake ref to build with; default
 *                    `.#process-monitor-agent`
 *   PORT           — HTTP+WS port (default 7720)
 *   KOLU_SURFACE_EXAMPLE_DIST  — when set, serve the prebuilt client
 *                    bundle from this dir (production mode)
 */

import { serve } from "@hono/node-server";
import { RPCHandler } from "@orpc/server/ws";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebSocketServer } from "ws";
import { destroyAllSessions, getHostSession } from "./hostSession";
import { resolveAgentPath } from "./nixCopy";
import { buildRouter } from "./router";

const HOST = process.env.HOST ?? "localhost";
const FLAKE = process.env.AGENT_FLAKE ?? ".#process-monitor-agent";
const PORT = Number(process.env.PORT ?? 7720);

async function main(): Promise<void> {
  process.stderr.write(
    `remote-process-monitor parent: host=${HOST}, resolving agent closure '${FLAKE}'…\n`,
  );

  const agentPath = await resolveAgentPath(FLAKE);
  if (agentPath === null) {
    process.stderr.write(
      `Cannot resolve agent closure for '${FLAKE}'. Set AGENT_PATH to a built /nix/store path, or run inside a flake with '#process-monitor-agent'.\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`agent closure: ${agentPath}\n`);

  const session = getHostSession({ host: HOST, agentPath });
  const { router } = buildRouter({ session });

  // ── HTTP server: serve client bundle in production ─────────────────
  const app = new Hono();
  const distDir = process.env.KOLU_SURFACE_EXAMPLE_DIST;
  if (distDir !== undefined && distDir.length > 0) {
    app.use("*", serveStatic({ root: distDir }));
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
      process.stderr.write(
        `remote-process-monitor listening on http://${info.address}:${info.port} (host=${HOST})\n`,
      );
    },
  );

  // ── WebSocket: oRPC over @orpc/server/ws ───────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: same Lazy<Router> spread typing dance as kolu/server.ts uses on its own appRouter.
  const wsHandler = new RPCHandler(router as any);
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => {
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
    const r = req as { url?: string };
    const s = socket as { destroy: () => void };
    if (r.url !== "/rpc/ws") {
      s.destroy();
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
    process.stderr.write(`${sig}: destroying host sessions\n`);
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
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
