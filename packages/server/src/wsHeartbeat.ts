/**
 * WebSocket liveness heartbeat for the oRPC streaming server.
 *
 * `ws` (and partysocket on the client) ship NO application-level ping/pong, so a
 * SILENTLY half-open socket — the TCP died with no FIN/RST (a client's laptop
 * slept, Wi-Fi roamed, or a NAT/proxy evicted the idle connection) — never fires
 * `close` on the server either. The dead socket lingers in `wss.clients` holding
 * its per-terminal stream subscriptions open forever. This is the server half of
 * the half-open fix; the client half (`createHeartbeat` in `@kolu/surface-app`)
 * is what actually un-freezes a stuck tab. Here we ping accepted clients on an
 * interval and `terminate()` any that didn't pong since the last sweep, reaping
 * the server-side zombie.
 *
 * Liveness lives in a `WeakSet` the caller re-adds to on every `pong`, NOT
 * monkey-patched onto the socket object. The stale-tab gate
 * (`@kolu/surface-app/server`) runs AFTER the ws upgrade has accepted the socket
 * but BEFORE the oRPC upgrade and heartbeat registration, so a rejected stale tab
 * never enrols here (it is closing) and #1231's protection is untouched — the
 * non-OPEN skip in `heartbeatSweep` covers the brief window it lingers in
 * `wss.clients` while that close settles.
 */

import type { WebSocket, WebSocketServer } from "ws";

/** Default sweep cadence. A missed pong across one 30s window is a confident
 *  dead-signal for an idle streaming socket without being chatty. */
const DEFAULT_SERVER_HEARTBEAT_INTERVAL_MS = 30_000;

/** One heartbeat sweep over the accepted clients: `terminate()` any that didn't
 *  pong since the previous sweep (absent from `alive`), then `ping()` the rest
 *  and clear their flag so the NEXT sweep can detect a miss. Sockets that aren't
 *  `OPEN` are skipped — a stale tab the gate closed (before the oRPC upgrade) is
 *  mid-close and is neither pinged nor terminated here. Pure over its injected
 *  deps (no timers, no `wss`), so it's unit-testable without a real server. */
export function heartbeatSweep(
  clients: Iterable<WebSocket>,
  alive: WeakSet<WebSocket>,
): void {
  for (const ws of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}

/** Start the liveness heartbeat over a server's ACCEPTED sockets. `register(ws)`
 *  is called once per accepted connection (AFTER the stale-tab gate) — it marks
 *  the socket alive and wires its `pong` to re-mark it; a sweep every
 *  `intervalMs` reaps any socket that missed the prior ping. The interval is
 *  `unref`'d so the heartbeat never keeps the process alive on its own. Returns
 *  `stop()` to clear the interval. */
export function startWsHeartbeat(
  wss: WebSocketServer,
  opts: { intervalMs?: number } = {},
): { register: (ws: WebSocket) => void; stop: () => void } {
  const alive = new WeakSet<WebSocket>();
  const register = (ws: WebSocket): void => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  };
  const handle = setInterval(
    () => heartbeatSweep(wss.clients, alive),
    opts.intervalMs ?? DEFAULT_SERVER_HEARTBEAT_INTERVAL_MS,
  );
  handle.unref?.();
  return { register, stop: () => clearInterval(handle) };
}
