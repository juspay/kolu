/**
 * Effect RPC's own keep-alive cadence, as a LEAFLET — no imports, so the
 * arithmetic that must respect the cadence (frame budgeting, chunk sizing) can
 * depend on the numbers without pulling in a socket library or a Node stream.
 *
 * These are **Effect's numbers, OBSERVED — not knobs we own**.
 * `RpcClient.makeProtocolSocket` runs a pinger of its own: `makePinger` writes a
 * ping every {@link RPC_PING_INTERVAL_MS} and ends the socket run the moment a
 * tick finds the previous ping unanswered, so {@link RPC_PING_FATAL_SILENCE_MS}
 * of silence is fatal. `makeProtocolSocket` exposes no option for the cadence, so
 * nothing here sets it and nothing here can move it; these constants exist so the
 * repo's other reasoning about link silence can REFERENCE the fact instead of
 * transcribing it.
 *
 * The canonical account of the MECHANISM is `./links/wire.ts`'s
 * `keepAliveWentUnanswered`, which is the only code that acts on the death;
 * `stdioPingStall.test.ts` measures the behaviour. If Effect ever changes the
 * cadence, that docstring changes first and these two follow. `./links/wire.ts`
 * re-exports both under its public subpath for existing importers.
 */

/** How often `RpcClient.makeProtocolSocket`'s own pinger writes a ping. */
export const RPC_PING_INTERVAL_MS = 5_000;

/** The worst-case silence Effect's pinger tolerates on a CONNECTED link before
 *  it ends the socket run: one interval to notice the previous ping went
 *  unanswered, on top of the interval that sent it.
 *
 *  This is the bound that actually ends a connected link in this stack. Every
 *  other silence budget in the repo — the heartbeat watchdog, the provisioning
 *  child-lifetime budgets, `@kolu/surface-remote`'s ssh keepalive — sits above
 *  it and gets no vote while a link is connected. It is therefore also the
 *  deadline a slow-but-flowing link's frames must never be able to starve: see
 *  `./frameChunking.ts`'s `RPC_STREAM_CHUNK_BYTES`, sized so one outbound frame
 *  drains well inside this window. */
export const RPC_PING_FATAL_SILENCE_MS = RPC_PING_INTERVAL_MS * 2;
