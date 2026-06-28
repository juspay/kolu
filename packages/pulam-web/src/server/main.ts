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
 * A uniform per-host `HostHandle` map (`hosts`) is the single source of truth
 * for which hosts exist: both the ssh `HostRegistry` and the local-kolu
 * mirror(s) adapt into it, so every parent-side consumer (the `?host=` dispatch,
 * `/api/hosts`, the reconnect route, socket tracking, shutdown) reads ONE
 * receptacle instead of folding two planes by hand. R4.8a has no admin surface
 * and no on-disk store: the static set is seeded from `PULAM_WEB_HOSTS` and
 * never mutates at runtime (`buildHostRegistry` runs with no `persist` hook).
 * The R4.8a UI renders a plain terminal list grouped by host — no git status,
 * no drill-in (R4.8b).
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
import {
  buildHostRegistry,
  type ClosableSocket,
  destroyAllSessions,
  isLocalHost,
} from "@kolu/surface-nix-host";
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
  readKoluUrl,
} from "./config.ts";
import {
  type PulamContract,
  type HostEntry,
  makeBuildEntry,
} from "./hostEntry.ts";
import { type LocalKoluMirror, startLocalKoluMirror } from "./localKolu.ts";
import { registerReconnectRoute } from "./reconnectRoute.ts";

const log = (line: string): void => {
  process.stderr.write(`[pulam-web] ${line}\n`);
};

/** One host's uniform face — what every parent-side consumer (the `?host=`
 *  dispatcher, `/api/hosts`, the reconnect route, socket tracking, shutdown)
 *  plugs into, regardless of whether the host is an ssh-dialed `HostSession` or
 *  the local-kolu mirror. The two sources each adapt into this one shape, so
 *  `main` reads a single map and never folds two planes by hand. */
interface HostHandle {
  /** The oRPC handler a `?host=` upgrade dispatches the browser socket onto. */
  handler: HostEntry["handler"];
  /** Re-arm the host (the `/api/reconnect` button): re-spawn the ssh session, or
   *  re-open the kolu link. */
  reconnect(): void;
  /** Tear the host down (server shutdown). */
  destroy(): void;
  /** Track an open browser socket so a host removal can close it. Present ONLY
   *  for the (removable) ssh hosts; a static local mirror tracks nothing and
   *  omits it (an absent capability, not a remembered guard). */
  registerConnection?(ws: ClosableSocket): void;
  /** Stop tracking a socket once it has closed on its own. */
  unregisterConnection?(ws: ClosableSocket): void;
}

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
  // Split the host set by KIND. A `localhost` / `127.0.0.1` / `::1` host is NOT
  // ssh-dialed: as of R9a pulam-web MIRRORS the local kolu's already-served
  // awareness (kolu serves `terminalWorkspaceSurface` cross-process since R8)
  // instead of spawning a second `pulam` sensor set against the same kaval — the
  // working-in-pulam-web vs idle-in-Dock desync. Every OTHER host stays an ssh
  // remote dialed through the `HostSession` registry.
  const localHosts = initialHosts.filter(isLocalHost);
  const sshHosts = initialHosts.filter((h) => !isLocalHost(h));

  // kolu's /rpc/ws URL the localhost mirror dials — read + validated only when a
  // local host is actually configured.
  const koluUrl = localHosts.length > 0 ? readKoluUrl() : null;
  log(
    `hosts (${initialHosts.length}): ssh=[${sshHosts.join(", ") || "—"}] local=[${localHosts.join(", ") || "—"}]`,
  );

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

  // ── The localhost mirror(s): the local kolu's served awareness (R9a) ─────
  // One sensor (kolu's in-process sink), two readers (kolu's Dock + this
  // dashboard) — never a second pulam. `koluUrl` is non-null whenever
  // `localHosts` is non-empty.
  const localMirrors = new Map<string, LocalKoluMirror>();
  for (const host of localHosts) {
    localMirrors.set(
      host,
      startLocalKoluMirror({
        koluUrl: koluUrl as string,
        log: (line) => log(`[${host}] ${line}`),
      }),
    );
  }

  // ── One host plane every consumer plugs into ─────────────────────────────
  // The parent's FULL host set is the ssh registry PLUS the local mirrors, both
  // adapted into a uniform `HostHandle` keyed by host. Every consumer below
  // (`/api/hosts`, the `?host=` dispatch, the reconnect route, socket tracking,
  // shutdown) reads THIS one map — never folds two planes. The browser leg is
  // already uniform (it dials `?host=<id>` the same for a local or remote host);
  // this makes the parent leg symmetric.
  const hosts = new Map<string, HostHandle>();

  // ssh hosts: build the registry ONLY when there's at least one to dial. A
  // localhost-only deployment then never eagerly reads PULAM_AGENT_DRVS_JSON (the
  // `makeResolveDrvPath()` parse, which throws if the Nix wrapper didn't bake it)
  // it has no use for — so the missing map is impossible to reach, not a guarded
  // reject-thunk. No `persist`: the host set is static (env-seeded). `buildEntry`
  // is sync, so an unreachable boot host surfaces as a per-host `failed` state,
  // never a throw that takes the port down. The registry stays block-local —
  // every consumer reaches its hosts through `hosts`.
  if (sshHosts.length > 0) {
    const buildEntry = makeBuildEntry({
      resolveDrvPath: makeResolveDrvPath(),
      kavalSockets,
      log,
    });
    const registry = buildHostRegistry<PulamContract, HostEntry["handler"]>({
      initialHosts: sshHosts,
      buildEntry,
      log,
    });
    for (const host of registry.hosts()) {
      const handler = registry.getHandler(host);
      const session = registry.getSession(host);
      // `registry.hosts()` just listed `host`, and `getHandler`/`getSession` read
      // the same `entries` map, so both are present — the guard only narrows the
      // `| undefined` the registry's getters carry for an unknown host.
      if (handler === undefined || session === undefined) continue;
      hosts.set(host, {
        handler,
        reconnect: () => registry.reconnect(host),
        destroy: () => session.destroy(),
        // Only the (removable) ssh hosts track sockets, so `registry.remove()`
        // can close a removed host's open browser sockets.
        registerConnection: (ws) => registry.registerConnection(host, ws),
        unregisterConnection: (ws) => registry.unregisterConnection(host, ws),
      });
    }
  }

  // local mirrors: a static localhost source (R9a) — never removed, so its handle
  // omits socket tracking (nothing to close on a removal that can't happen).
  for (const [host, mirror] of localMirrors) {
    hosts.set(host, {
      handler: mirror.handler,
      reconnect: () => mirror.reconnect(),
      destroy: () => mirror.destroy(),
    });
  }

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
  // the live host set (insertion order preserved) AND this server's `processId`,
  // so the client can echo it as the `?pid=` stale-tab token on every per-host
  // (re)connect. After a parent restart the live `processId` changes; a tab still
  // carrying the OLD one is rejected by `gateStaleSocket` below (and retired
  // client-side) instead of silently replaying onto a fresh instance. The
  // first-ever connect omits `pid` and always passes.
  app.get("/api/hosts", (c) => c.json({ hosts: [...hosts.keys()], processId }));

  // `POST /api/reconnect?host=<id>` — the failed-card Reconnect button. A
  // session that gave up into the terminal `failed` state only retries on an
  // explicit re-arm (or a parent restart); `reconnect()` is that re-arm, here
  // exposed to the browser. The route's gate / unknown-host-404 / fail-loud
  // missing-session / rearm branches live in `reconnectRoute.ts` so each is
  // reachable from a route-level test (`reconnectRoute.test.ts`).
  // Every `HostHandle` — ssh session or local mirror — exposes `reconnect()`, so
  // the route reads the ONE `hosts` map: a handle IS the `{ reconnect() }` slice
  // the route uses, so a localhost card's Reconnect button is live, not a no-op.
  registerReconnectRoute(app, {
    registry: {
      has: (host) => hosts.has(host),
      getSession: (host) => hosts.get(host),
    },
    allowedOrigins,
    log,
  });

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
    if (!hosts.has(host)) {
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
        const handle = hosts.get(host);
        if (handle === undefined) {
          // Race: host removed between the `has` check above and here.
          ws.close(1008, `unknown host: ${host}`);
          return;
        }
        // Track the socket if this host supports removal (ssh) so a removal can
        // close it; a static local mirror has no `registerConnection` capability
        // and tracks nothing — the optional call is the structural form of the
        // old `if (registry.has(host))` guard.
        handle.registerConnection?.(ws);
        log(`browser ws connect (host=${host})`);
        ws.on("close", (code, reason) => {
          handle.unregisterConnection?.(ws);
          log(
            `browser ws disconnect (host=${host}) (code=${code} reason=${reason.toString() || "<none>"})`,
          );
        });
        void handle.handler.upgrade(
          ws as Parameters<typeof handle.handler.upgrade>[0],
        );
      });
    });
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = (sig: string): void => {
    log(`${sig}: destroying host sessions`);
    // One loop over the one host plane — each handle tears down its own source
    // (an ssh session's `destroy()`, or the local mirror's). `destroyAllSessions`
    // then drains the shared ssh session pool.
    for (const handle of hosts.values()) handle.destroy();
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
