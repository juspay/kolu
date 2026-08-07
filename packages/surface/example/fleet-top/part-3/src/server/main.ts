/**
 * The fan-out parent — N boxes served as ONE surface map.
 *
 * Each host gets a `buildHostBinding` (its own ssh session + inward mirror + an
 * in-process dispatch). A hand-built `MapRegistry` is the ONE writer of
 * membership; its `resolve(host)` hands the map each host's dispatch + projected
 * connection state. `serveSurfaceMap` publishes the `entries` membership
 * collection and forwards every key-folded member call to the right host's
 * dispatch — so a dead box surfaces as exactly one `failed` chip, never a crash.
 * What it hands back is the same `{ group, handlers }` pair `implementSurface`
 * returns, which is what every transport takes.
 *
 *   HOST                          comma-separated ssh targets (default localhost)
 *   FLEET_TOP_AGENT_DRV (required) the fleet-top-agent .drv, shipped + realised
 *                                  on each target for its architecture
 *   PORT                          HTTP+WS port (default 7740)
 */

import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { gateWsOrigin, parseAllowedOrigins } from "@kolu/surface/ws-origin";
import {
  type ServableSocket,
  serveSurfaceSocket,
} from "@kolu/surface-app/server";
import { type MapRegistry, serveSurfaceMap } from "@kolu/surface-map/server";
import { Effect, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { WebSocketServer } from "ws";
import { type HostFailure, hostMap } from "../common/map";
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

const registry: MapRegistry<string, "copying", HostFailure> = {
  members: () => [...bindings.keys()],
  subscribe: (onChange) => {
    changeCbs.add(onChange);
    return () => changeCbs.delete(onChange);
  },
  has: (k) => bindings.has(k),
  resolve: (k) => {
    const b = bindings.get(k);
    if (b === undefined)
      return { kind: "fault", failure: { reason: `unknown host: ${k}` } };
    return { kind: "session", dispatch: b.dispatch, state: b.state() };
  },
};

const { group, handlers } = serveSurfaceMap(hostMap, registry);

// ── Serve the map over one WebSocket ────────────────────────────────────
// No http routes here either — the browser gets its UI from vite and this
// process answers only the `/rpc/ws` upgrade, so the router layer is empty and
// every plain request 404s. We own the `http.Server` so the ws seam below stays
// the ONLY `upgrade` listener.
const server = createServer();
const httpScope = Scope.makeUnsafe();
server.on(
  "request",
  await Effect.runPromise(
    Effect.gen(function* () {
      const httpEffect = yield* HttpRouter.toHttpEffect(Layer.empty);
      return yield* NodeHttpServer.makeHandler(httpEffect, {
        scope: httpScope,
      });
    }).pipe(
      Scope.provide(httpScope),
      Effect.provide(NodeHttpServer.layerHttpServices),
    ),
  ),
);
server.listen({ host: "0.0.0.0", port: PORT }, () => {
  process.stdout.write(
    `fleet-top part 3 serving ${bindings.size} host(s) on http://localhost:${PORT}\n`,
  );
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 8 * 1024 * 1024,
});
wss.on("connection", (peer) => {
  const serving = serveSurfaceSocket({
    group,
    handlers,
    socket: peer as unknown as ServableSocket,
  });
  serving.done.catch((err) => {
    process.stderr.write(`[ws] connection failed: ${String(err)}\n`);
  });
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
