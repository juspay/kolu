/**
 * The link's keep-alive: the numbers every wire link passes to Effect RPC's
 * pinger, and the canonical account of why they are what they are. Everything
 * else that mentions the keep-alive points here. A LEAFLET (no imports), so
 * the arithmetic that must respect these numbers (frame budgeting, chunk
 * sizing, the silence bounds above the link) can depend on them without
 * pulling in a socket library or a Node stream. Published as
 * `@kolu/surface/keepAlive`.
 *
 * THE MECHANISM. `RpcClient.makeProtocolSocket` runs a pinger: it writes a
 * ping every `pingInterval`, ANY frame this side decodes from the peer counts
 * as liveness, and a tick that finds its ping outstanding and no frame for
 * longer than `pingTimeout` ends the socket run. Both call sites
 * (`./links/wire.ts`'s `duplexWireLink`, `./links/websocket.ts`) pass the two
 * numbers below explicitly, so no leg rides Effect's defaults. They are baked
 * framework constants: no link factory takes a timing parameter. On a duplex
 * leg the run ending is the link ending (it cannot be retried through, see
 * `neverReconnect`), and the leg names it `keepAliveUnanswered` through
 * `onPingTimeout` (`../errors.ts` says what that means about the peer). On
 * the websocket leg it is an ordinary socket loss, and the socket is redialled.
 *
 * THE RULE THEY ENCODE: the pinger is a BACKSTOP. A peer that really dies on
 * a stdio or unix-socket leg is reported by the OS (EOF) at once, so all the
 * pinger adds is "alive but silent", and on every leg that has a liveness
 * watchdog (`./heartbeat.ts`), that is the watchdog's call. Every watchdog
 * is suspension-aware. What else it knows depends on the leg:
 *
 *   - the browser's websocket (`createLiveSignal`) is also wake-aware and
 *     PROGRESS-aware: any inbound frame voids a timed-out probe, within a
 *     budget;
 *   - a session leg (`@kolu/surface-remote`'s `makeSession`, over ssh stdio or
 *     a same-box unix socket) is progress-BLIND: a probe answer queued behind
 *     a large frame reads as silence. On a same-box arm a timed-out probe
 *     consults the process oracle (`processAlive`) and keeps probing while the
 *     peer runs. On an ssh arm it force-cycles, and ssh's own dead-peer policy
 *     is a second bound beside it.
 *
 * A link with no watchdog (a supervisor daemon's link to the daemon it
 * supervises, a CLI's own connection) has the backstop as its only bound on
 * silence. Where a watchdog or ssh does vote, the backstop must never decide
 * before them.
 * `stdioPingStall.test.ts` measures the whole of it.
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
