/**
 * The keep-alive numbers every wire link passes to Effect RPC's pinger, as a
 * LEAFLET — no imports, so the arithmetic that must respect them (frame
 * budgeting, chunk sizing, the silence bounds above the link) can depend on the
 * numbers without pulling in a socket library or a Node stream.
 *
 * These are **OURS**. Every `RpcClient.makeProtocolSocket` call site
 * (`./links/wire.ts`'s `duplexWireLink`, `./links/websocket.ts`) passes
 * `pingInterval: RPC_PING_INTERVAL_MS` and `pingTimeout: RPC_PING_TIMEOUT_MS`
 * explicitly, so no leg rides Effect's defaults. They are baked framework
 * constants, not consumer options: no link factory takes a timing parameter.
 *
 * THE RULE THEY ENCODE: Effect's pinger is a BACKSTOP, above the framework's own
 * watchdog (`./heartbeat.ts`), which is the liveness authority. The watchdog is
 * suspension-aware, progress-aware, and on a same-box arm consults a process
 * oracle; the pinger knows none of that. So it must never decide first while
 * the watchdog — or, on an ssh leg, ssh's own dead-peer policy — would still
 * vote. A peer that really dies on a stdio or unix-socket leg is reported by
 * the OS (EOF) at once; the pinger only ever adds "alive but silent", and that
 * is the watchdog's call to make.
 *
 * The canonical account of the MECHANISM is `./links/wire.ts`'s
 * `duplexWireLink` docstring; `stdioPingStall.test.ts` measures it.
 * `./links/wire.ts` re-exports these under its public subpath.
 *
 * BETA-ASSUMPTION(4.1.4): the pinger ends a run at the first tick that finds its ping outstanding and no decoded frame for longer than `pingTimeout`.
 * In effect@4.1.4 `rpc/RpcClient.ts` `makePinger`, every decoded server frame
 * (not only `Pong`) refreshes `lastSeen` and clears `awaitingResponse`; each
 * tick either ends the run (ping outstanding, `now - lastSeen > pingTimeout`)
 * or writes a ping. {@link RPC_PING_FATAL_SILENCE_MS} is derived from exactly
 * that, and `stdioPingStall.test.ts` measures the death landing inside it.
 */

/** How often a link's pinger writes a ping. Kept at Effect's old default: a
 *  ping every 5s is cheap, and it is also the floor `probeDaemonIdentity`'s
 *  silence bound stands on (a peer of this epoch answers it below its
 *  handlers, so a merely slow peer has spoken within one interval). */
export const RPC_PING_INTERVAL_MS = 5_000;

/** How long a link may go with NO decoded frame before its pinger ends it.
 *
 *  Derived from the bounds it must sit above, at their defaults:
 *
 *    heartbeat verdict   15s interval + 10s timeout          = 25s
 *    ssh dead-peer       ServerAliveInterval 10 × CountMax 3 = 30s
 *    pinger backstop     2 × the slowest of those            = 60s
 *
 *  Twice the slowest default verdict, so the pinger cannot pre-empt either one
 *  even when both fire late. (`@kolu/surface-remote`'s
 *  `keepaliveOrdering.test.ts` pins the ordering; this package cannot import
 *  the ssh default, which lives above it.) */
export const RPC_PING_TIMEOUT_MS = 60_000;

/** The worst-case silence a CONNECTED link survives before its pinger ends it.
 *  The last frame can land just after a tick; the run ends at the first tick
 *  past {@link RPC_PING_TIMEOUT_MS} of silence, and ticks are
 *  {@link RPC_PING_INTERVAL_MS} apart — so death lands in
 *  (`RPC_PING_TIMEOUT_MS`, `RPC_PING_TIMEOUT_MS + RPC_PING_INTERVAL_MS`]:
 *  60–65s. `stdioPingStall.test.ts` measures it.
 *
 *  Every other silence budget in the repo — the heartbeat watchdog, ssh's
 *  dead-peer policy at its defaults — sits BELOW it and decides first. The
 *  provisioning child-lifetime budgets sit above it, but they bound a child
 *  that is not yet a connected link. */
export const RPC_PING_FATAL_SILENCE_MS =
  RPC_PING_TIMEOUT_MS + RPC_PING_INTERVAL_MS;
