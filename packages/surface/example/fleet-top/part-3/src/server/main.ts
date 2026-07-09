/**
 * The fan-out parent — N boxes served as ONE surface map.
 *
 * Each host gets a `buildHostBinding` (its own ssh session + inward mirror + a
 * link). A hand-built `MapRegistry` is the ONE writer of membership; its
 * `resolve(host)` hands the map each host's link + projected connection state.
 * `serveSurfaceMap` publishes the `entries` membership collection and forwards
 * every key-folded member call to the right host's link — so a dead box surfaces
 * as exactly one `failed` chip, never a crash.
 *
 *   HOST                          comma-separated ssh targets (default localhost)
 *   FLEET_TOP_AGENT_DRV (required) the fleet-top-agent .drv, shipped + realised
 *                                  on each target for its architecture
 *   PORT                          HTTP+WS port (default 7740)
 */

import { serve } from "@hono/node-server";
import {
  gateHttpRpcOrigin,
  gateWsOrigin,
  parseAllowedOrigins,
} from "@kolu/surface/ws-origin";
import { type MapRegistry, serveSurfaceMap } from "@kolu/surface-map/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { hostMap } from "../common/map";
import { buildHostBinding, type HostBinding } from "./hosts";

const HOSTS = (process.env.HOST ?? "localhost")
  .split(",")
  .map((h) => h.trim())
  .filter((h) => h.length > 0);
const AGENT_DRV = process.env.FLEET_TOP_AGENT_DRV;
const PORT = Number(process.env.PORT ?? 7740);
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

if (AGENT_DRV === undefined || AGENT_DRV.length === 0) {
  process.stderr.write(
    "FLEET_TOP_AGENT_DRV is required (no fallback) — the fleet-top-agent .drv path.\n",
  );
  process.exit(1);
}

// ── One binding per host; a hand-built MapRegistry over them ────────────
const bindings = new Map<string, HostBinding>();
for (const host of HOSTS) bindings.set(host, buildHostBinding(host, AGENT_DRV));

const changeCbs = new Set<() => void>();
for (const b of bindings.values()) {
  b.onStateChange(() => {
    for (const cb of changeCbs) cb();
  });
}

const registry: MapRegistry<string, "copying", string> = {
  members: () => [...bindings.keys()],
  subscribe: (onChange) => {
    changeCbs.add(onChange);
    return () => changeCbs.delete(onChange);
  },
  has: (k) => bindings.has(k),
  resolve: (k) => {
    const b = bindings.get(k);
    if (b === undefined) return { kind: "fault", failed: `unknown host: ${k}` };
    return { kind: "session", link: b.link, state: b.state() };
  },
};

const { router } = serveSurfaceMap(hostMap, registry);

// ── Serve the map over HTTP + WebSocket ─────────────────────────────────
const app = new Hono();
// biome-ignore lint/suspicious/noExplicitAny: RPCHandler's router input type doesn't accept the finalized map router's loose type; the runtime shape is valid.
const httpHandler = new RPCHandler(router as any);
app.use("/rpc/*", async (c, next) => {
  const rejected = gateHttpRpcOrigin(c.req.raw, {
    allowedOrigins: ALLOWED_ORIGINS,
  });
  if (rejected) return rejected;
  const { matched, response } = await httpHandler.handle(c.req.raw, {
    prefix: "/rpc",
  });
  if (matched) return response;
  await next();
});

const server = serve(
  { fetch: app.fetch, port: PORT, hostname: "0.0.0.0" },
  (info) => {
    process.stdout.write(
      `fleet-top part 3 serving ${bindings.size} host(s) on http://localhost:${info.port}\n`,
    );
  },
);

// biome-ignore lint/suspicious/noExplicitAny: same loose-router cast as the HTTP handler above.
const wsHandler = new WsRPCHandler(router as any);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 8 * 1024 * 1024,
});
wss.on("connection", (peer) => {
  void wsHandler.upgrade(peer);
});
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/rpc/ws")) {
    if (gateWsOrigin(req, socket, { allowedOrigins: ALLOWED_ORIGINS })) return;
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } else {
    socket.destroy();
  }
});

const shutdown = (): void => {
  for (const b of bindings.values()) b.destroy();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
