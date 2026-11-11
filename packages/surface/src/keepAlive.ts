/**
 * Effect RPC's own keep-alive cadence, as a LEAFLET — no imports, so the
 * arithmetic that must respect the cadence (frame budgeting, chunk sizing) can
 * depend on the numbers without pulling in a socket library or a Node stream.
 *
 * These are **Effect's DEFAULTS, OBSERVED — not knobs we set**.
 * `RpcClient.makeProtocolSocket` runs a pinger of its own: `makePinger` writes a
 * ping every `pingInterval` ({@link RPC_PING_INTERVAL_MS}), counts ANY frame
 * decoded from the peer as liveness, and ends the socket run when a tick finds
 * its previous ping outstanding and no frame for longer than `pingTimeout`
 * (which defaults to the interval). This stack passes neither option, so the
 * defaults hold; these constants exist so the repo's other reasoning about link
 * silence can REFERENCE the fact instead of transcribing it.
 *
 * The canonical account of the MECHANISM is `./links/wire.ts`'s
 * `keepAliveWentUnanswered`, which is the only code that acts on the death;
 * `stdioPingStall.test.ts` measures the behaviour. If Effect's defaults change,
 * or this stack starts passing the options, that docstring changes first and
 * these two follow. `./links/wire.ts` re-exports both under its public subpath
 * for existing importers.
 */

/** How often `RpcClient.makeProtocolSocket`'s own pinger writes a ping. */
export const RPC_PING_INTERVAL_MS = 5_000;

/** The worst-case silence Effect's pinger tolerates on a CONNECTED link before
 *  it ends the socket run. A tick sends a ping; the NEXT tick, one interval
 *  later, ends the run if no frame has arrived for longer than the timeout (the
 *  interval again). The last frame can land just after a tick, so the silence
 *  that kills is between one and two intervals — this is the two.
 *
 *  This is the bound that actually ends a connected link in this stack. Every
 *  other silence budget in the repo — the heartbeat watchdog, the provisioning
 *  child-lifetime budgets, `@kolu/surface-remote`'s ssh keepalive — sits above
 *  it and gets no vote while a link is connected. It is therefore also the
 *  deadline a slow-but-flowing link's frames must never be able to starve: see
 *  `./frameChunking.ts`'s `RPC_STREAM_CHUNK_BYTES`, sized so one outbound frame
 *  drains well inside this window. */
export const RPC_PING_FATAL_SILENCE_MS = RPC_PING_INTERVAL_MS * 2;
