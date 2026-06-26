/**
 * pulam-web parent server (multi-host) — the Node entry.
 *
 * Three-tier bridge, repeated once per configured pulam host:
 *
 *   browser  ─WS oRPC─▶  this server  ─stdio oRPC over ssh─▶  remote pulam
 *
 * The browser opens one WebSocket per host at `/rpc/ws?host=<id>`; the upgrade
 * handler dispatches to that host's `RPCHandler` (the re-serve of its awareness
 * surface), or closes 1008 on an unknown host. Host identity lives ONLY at the
 * transport layer — every host re-serves the same `terminalWorkspaceSurface`.
 *
 * The `HostRegistry` is the single source of truth for which hosts exist. R4.8a
 * has no admin surface and no on-disk store: the static set is seeded from
 * `PULAM_WEB_HOSTS` and never mutates at runtime (`buildHostRegistry` runs with
 * no `persist` hook). The R4.8a UI renders a plain terminal list grouped by
 * host — no git status, no drill-in (R4.8b).
 *
 * Mirrors kolu's own Node server (`packages/server/src/index.ts`) for the
 * `@hono/node-server` `serve()` + `WebSocketServer({ noServer })` +
 * `server.on("upgrade")` shape, and drishti's `main.ts` for the `?host=`
 * dispatch + the gate ordering (origin gate → stale-tab gate → heartbeat
 * register → connection register → handler upgrade).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { gateWsOrigin, parseAllowedOrigins } from "@kolu/surface/ws-origin";
import {
  acceptSurfaceSocket,
  installFreshStatic,
  installPwaManifest,
  surfaceAppServer,
} from "@kolu/surface-app/server";
import { buildHostRegistry, destroyAllSessions } from "@kolu/surface-nix-host";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import {
  DEFAULT_PORT,
  makeResolveDrvPath,
  PULAM_WEB_HOSTS_ENV,
  PULAM_WEB_KAVAL_SOCKETS_ENV,
  parsePort,
  readInitialHosts,
  readKavalSockets,
} from "./config.ts";
import {
  type PulamContract,
  type HostEntry,
  makeBuildEntry,
} from "./hostEntry.ts";
import { registerReconnectRoute } from "./reconnectRoute.ts";

const log = (line: string): void => {
  process.stderr.write(`[pulam-web] ${line}\n`);
};

// The colour the pulam shell paints behind everything (the PWA splash/background).
// Named once here — mirroring the kolu twin's `PWA_BACKGROUND_COLOR`
// (packages/server/src/index.ts) — so the manifest can't drift from intent. NOT
// `--color-surface-0` (#0c0c0e): pulam-web uses a distinct shell background. The
// <body> in index.html carries the same literal (`bg-[#0b0d10]`); static HTML
// can't read this const, so the two stay paired by value, not by this comment.
const SHELL_BG = "#0b0d10";

// The PWA theme colour — the teal `--color-accent` (packages/theme/theme.css:26)
// the dashboard already paints, which is the authority. Named once here so the
// manifest's theme_color is the only literal to keep in step with the token,
// matching kolu's twin which likewise keeps themeColor server-side.
const PULAM_THEME_COLOR = "#5a9ea0";

async function main(): Promise<void> {
  // ── Static config (fail-fast at boot, no fallback) ───────────────────────
  const initialHosts = readInitialHosts();
  if (initialHosts.length === 0) {
    log(
      `${PULAM_WEB_HOSTS_ENV} is empty — set it to a comma-separated list of pulam ssh hosts (e.g. ${PULAM_WEB_HOSTS_ENV}=nix@box-a,nix@box-b). A parent with no hosts has nothing to serve.`,
    );
    process.exit(1);
  }
  // Parses + validates PULAM_AGENT_DRVS_JSON eagerly; throws here (caught below)
  // if the Nix wrapper didn't bake the drv map.
  const resolveDrvPath = makeResolveDrvPath();
  log(`hosts (${initialHosts.length}): ${initialHosts.join(", ")}`);

  // Per-host kaval socket overrides (for a multi-kaval host). A socket named for
  // a host we don't dial is a typo — fail loud (matching pulam-tui's --kaval
  // host validation) rather than silently ignoring it.
  const kavalSockets = readKavalSockets();
  for (const host of kavalSockets.keys()) {
    if (!initialHosts.includes(host)) {
      log(
        `${PULAM_WEB_KAVAL_SOCKETS_ENV}: '${host}' is not in ${PULAM_WEB_HOSTS_ENV} — fix the host or drop the override.`,
      );
      process.exit(1);
    }
  }

  // The per-process id the stale-tab gate and the (unused-in-R4.8a) identity
  // probe single-source. Mints internally; we read it back for `gateStaleSocket`.
  const { processId } = surfaceAppServer();

  // ── The per-host session + handler registry ──────────────────────────────
  // No `persist` — the host set is static (env-seeded). `buildEntry` is sync, so
  // an unreachable boot host surfaces as a per-host `failed` state, never a
  // throw that takes the port down.
  const buildEntry = makeBuildEntry({ resolveDrvPath, kavalSockets, log });
  const registry = buildHostRegistry<PulamContract, HostEntry["handler"]>({
    initialHosts,
    buildEntry,
    log,
  });

  // The RPC surface is unauthenticated; allowlist extra browser origins (a
  // reverse-proxy FQDN) via `PULAM_WEB_ALLOWED_ORIGINS` for the proxied case.
  // Declared up here (not just before `serve`) because the mutating
  // `POST /api/reconnect` route below must apply the SAME CSWSH Origin gate the
  // ws upgrade does — so the policy has to exist before the routes are wired.
  const allowedOrigins = parseAllowedOrigins(
    process.env.PULAM_WEB_ALLOWED_ORIGINS,
  );

  // ── HTTP app: the host-list API + the built client bundle ────────────────
  const app = new Hono();

  // `/api/hosts` — the client fetches this, then opens one ws per host. Returns
  // the registry's live host set (insertion order preserved) AND this server's
  // `processId`, so the client can echo it as the `?pid=` stale-tab token on
  // every per-host (re)connect. After a parent restart the live `processId`
  // changes; a tab still carrying the OLD one is rejected by `gateStaleSocket`
  // below (and retired client-side) instead of silently replaying onto a fresh
  // instance. The first-ever connect omits `pid` and always passes.
  app.get("/api/hosts", (c) => c.json({ hosts: registry.hosts(), processId }));

  // `POST /api/reconnect?host=<id>` — the failed-card Reconnect button. A
  // session that gave up into the terminal `failed` state only retries on an
  // explicit re-arm (or a parent restart); `reconnect()` is that re-arm, here
  // exposed to the browser. The route's gate / unknown-host-404 / fail-loud
  // missing-session / rearm branches live in `reconnectRoute.ts` so each is
  // reachable from a route-level test (`reconnectRoute.test.ts`).
  registerReconnectRoute(app, { registry, allowedOrigins, log });

  // PWA manifest — served dynamically so it's one source of truth with the
  // server (the kolu twin: `packages/server/src/index.ts`). pulam-web is a
  // single fleet view, not a per-host instance, so the identity is static (no
  // hostname-hashed name/theme like kolu's): the teal `--color-accent` the
  // dashboard already paints is the theme colour, and the shell background
  // (`SHELL_BG`) is the splash colour. `display: standalone` + the maskable icon
  // make it installable. Registered BEFORE `installFreshStatic` so the manifest
  // route wins over the static `/` catch-all.
  installPwaManifest(app, {
    name: "pulam-web — every agent, every host",
    short_name: "pulam",
    description:
      "One browser view over every coding agent on every host in your fleet — sorted by what needs you.",
    themeColor: PULAM_THEME_COLOR,
    backgroundColor: SHELL_BG,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  });

  // Serve the built Vite client. `PULAM_WEB_DIST_DIR` overrides the default
  // `../../dist` (relative to this file's runtime location), so the Nix wrapper
  // can point at a prebuilt bundle. `serviceWorker: "notify"` keeps the
  // freshness contract (no-store shell, immutable hashed assets, 404 on a miss)
  // AND serves the fetch-less `/sw.js` the client registers (see `main.tsx`).
  const distDir = process.env.PULAM_WEB_DIST_DIR
    ? process.env.PULAM_WEB_DIST_DIR
    : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");
  installFreshStatic(app, { root: distDir, serviceWorker: "notify" });

  // Fail-fast on a malformed/0 port rather than silently binding the default.
  const port = parsePort(
    "PULAM_WEB_PORT",
    process.env.PULAM_WEB_PORT,
    DEFAULT_PORT,
  );
  const bind = process.env.PULAM_WEB_BIND ?? "127.0.0.1";

  const server = serve({ fetch: app.fetch, port, hostname: bind }, (info) => {
    log(`listening on http://${info.address}:${info.port}`);
    if (["127.0.0.1", "localhost", "::1"].includes(bind)) {
      log(`open http://localhost:${info.port}/`);
    } else {
      log(
        `WARNING: bound to ${bind} (not loopback) — the RPC surface is unauthenticated; anyone who can reach this port can read fleet awareness. Prefer 127.0.0.1 unless firewalled or behind a trusted proxy.`,
      );
    }
  });

  // ── WebSocket: one server, dispatch by `?host=<id>` ──────────────────────
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8 * 1024 * 1024,
  });

  // The acceptance seam owns the liveness reaper AND bundles the per-socket
  // stale-tab gate + reaper enrolment into one sequenced `accept(...)` call — so a
  // socket can't be dispatched to a host handler without first being gated and
  // enrolled. (Reaps the server-side zombie a half-open browser would leak.)
  const acceptor = acceptSurfaceSocket({
    server: wss,
    liveProcessId: processId,
    onError: (err, url) =>
      log(
        `browser ws error (host=${url.searchParams.get("host")}): ${err.message}`,
      ),
    onReject: (_pid, url) =>
      log(
        `rejecting stale browser ws (host=${url.searchParams.get("host")}) — parent restarted`,
      ),
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    if (url.pathname !== "/rpc/ws") {
      socket.destroy();
      return;
    }
    // CSWSH gate: reject a cross-site browser Origin before any RPC handler sees
    // the socket. Non-browser clients send no Origin and pass; same-origin UI
    // passes. `gateWsOrigin` destroys the socket on reject and returns true.
    if (
      gateWsOrigin(req, socket, {
        allowedOrigins,
        onReject: (origin) =>
          log(
            `rejecting ws upgrade: disallowed Origin ${JSON.stringify(origin)}`,
          ),
      })
    ) {
      return;
    }
    const host = url.searchParams.get("host");
    if (host === null || host.length === 0) {
      socket.destroy();
      return;
    }
    if (!registry.has(host)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // `accept` runs the stale-tab gate (installs the `error` listener first, the
      // one crash-free order; closes a stale tab carrying a previous process's
      // `pid`) → enrols the socket in the liveness reaper → then runs our dispatch.
      // The dispatch never runs for a stale tab, and the socket can't be
      // dispatched un-enrolled.
      acceptor.accept(ws, url, () => {
        const handler = registry.getHandler(host);
        if (handler === undefined) {
          // Race: host removed between the `has` check above and here.
          ws.close(1008, `unknown host: ${host}`);
          return;
        }
        registry.registerConnection(host, ws);
        log(`browser ws connect (host=${host})`);
        ws.on("close", (code, reason) => {
          registry.unregisterConnection(host, ws);
          log(
            `browser ws disconnect (host=${host}) (code=${code} reason=${reason.toString() || "<none>"})`,
          );
        });
        void handler.upgrade(ws as Parameters<typeof handler.upgrade>[0]);
      });
    });
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = (sig: string): void => {
    log(`${sig}: destroying host sessions`);
    registry.destroyAll();
    destroyAllSessions();
    acceptor.stop();
    wss.close();
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log(`fatal: ${(err as Error).message}`);
  process.exit(1);
});
