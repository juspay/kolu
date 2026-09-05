/**
 * The ORDERING of every bound on "how long may this link be silent" — pinned,
 * because the docs make claims about it, prose drifts, and the last round of
 * those docs got it wrong in a way arithmetic can catch.
 *
 * There are FOUR independent bounds, and `SshKeepalive` is only the last:
 *
 *   1. **Effect RPC's own pinger** — a ping every 5s, fatal the moment a tick
 *      finds the previous one unanswered, so 5–10s of silence ends a CONNECTED
 *      link. NOT a knob. Canonical account: the docstring beside
 *      `neverReconnect` in `@kolu/surface`'s `links/wire.ts`, measured by
 *      `links/stdioPingStall.test.ts`.
 *   2. **`makeSession`'s heartbeat** — ≈25s at its defaults, tunable via
 *      `MakeSessionOptions.liveness`. Per (1) it "never gets a vote, because the
 *      lower deadline always wins" (`wire.ts`, verbatim).
 *   3. **The provisioning progress-liveness budget** — 120s without CHILD
 *      output, which group-kills the child. ssh keepalives are protocol traffic
 *      and produce no child stdout, so they never reset it.
 *   4. **ssh's dead-peer policy** (`SshKeepalive`) — the transport's own death.
 *
 * The file exists to make the real ordering — pinger < heartbeat < ssh
 * keepalive, with the provisioning budget owning a blip during a build — the
 * thing a regression breaks against. Its previous shape pinned only (2) against
 * (4), which reads as though raising the heartbeat alongside the keepalive buys
 * a connected link something. It does not; (1) is below both. Sibling of
 * `livenessOrdering.test.ts`, which pins the pre-connected backstop the same way.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  MAX_HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_TIMEOUT_MS,
} from "@kolu/surface/heartbeat";
import {
  DEFAULT_SSH_KEEPALIVE,
  keepaliveToleranceS,
  MAX_SSH_KEEPALIVE_TOLERANCE_S,
  sshKeepalive,
} from "./keepalive";
import {
  PROVISION_STEP_MAX_EXPIRIES,
  PROVISION_STEP_SILENCE_BASE_MS,
} from "./nixCopy";

/** Effect's pinger cadence, and the worst-case silence it tolerates.
 *
 *  NOT imported, because `RpcClient.makeProtocolSocket` exposes no option for it
 *  and this repo invents no export to pretend otherwise — the SOURCE OF TRUTH is
 *  the docstring beside `neverReconnect` in `packages/surface/src/links/wire.ts`
 *  ("`makePinger` writes a ping every 5s and ends the socket run the moment a
 *  tick finds the previous ping unanswered — so 5–10s of silence is fatal, and
 *  the cadence is not a knob"), and `links/stdioPingStall.test.ts` is where the
 *  behaviour itself is measured. These two numbers transcribe that sentence; if
 *  Effect ever changes it, that docstring is what has to change first. */
const RPC_PING_INTERVAL_MS = 5_000;
const RPC_PING_FATAL_SILENCE_MS = 10_000;

/** Worst-case wall time before the heartbeat calls a connected link stale. */
const heartbeatVerdictMs = (intervalMs: number, timeoutMs: number): number =>
  intervalMs + timeoutMs;

/** Wall time before ssh calls the peer dead. The product is derived by
 *  `keepaliveToleranceS` — the same one the bound checks and both error
 *  messages print — so this test cannot drift from the value it is comparing. */
const keepaliveVerdictMs = (k: {
  readonly intervalS: number;
  readonly countMax: number;
}): number => keepaliveToleranceS(k) * 1_000;

/** The heartbeat at its defaults, the number every doc sentence quotes. */
const defaultHeartbeatMs = heartbeatVerdictMs(
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
);

describe("what actually ends a CONNECTED link", () => {
  it("is Effect's pinger — below the heartbeat and below any ssh keepalive", () => {
    expect(RPC_PING_FATAL_SILENCE_MS).toBe(RPC_PING_INTERVAL_MS * 2);
    // The whole ordering, in one line: pinger < heartbeat < ssh keepalive.
    expect(RPC_PING_FATAL_SILENCE_MS).toBeLessThan(defaultHeartbeatMs);
    expect(defaultHeartbeatMs).toBeLessThan(
      keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE),
    );
    // The concrete numbers the docs quote, so a re-tune has to update both.
    expect(defaultHeartbeatMs).toBe(25_000);
    expect(keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE)).toBe(30_000);
  });

  it("dominates even the LOOSEST pairing a consumer can express", () => {
    // Both knobs wound to their ceilings, which is the most a consumer can ask
    // for. The pinger is still the first verdict, by two orders of magnitude —
    // which is why the docs must never advise "raise liveness alongside
    // keepalive to survive a blip". There is no pairing that survives one.
    const loosestHeartbeatMs = heartbeatVerdictMs(
      MAX_HEARTBEAT_INTERVAL_MS,
      MAX_HEARTBEAT_TIMEOUT_MS,
    );
    expect(loosestHeartbeatMs).toBe(420_000);
    expect(RPC_PING_FATAL_SILENCE_MS).toBeLessThan(loosestHeartbeatMs);
    expect(RPC_PING_FATAL_SILENCE_MS).toBeLessThan(
      MAX_SSH_KEEPALIVE_TOLERANCE_S * 1_000,
    );
  });

  it("leaves the heartbeat with no vote at every RAISED tuning", () => {
    // The direction that matters, stated as a general fact rather than one
    // example: raising the heartbeat can only move it further above the pinger's
    // deadline, so no `liveness` a consumer reaches for in order to tolerate
    // MORE silence ever gets to decide anything. (Tuned the other way — below
    // 10s — the heartbeat does fire first; that is tightening, not surviving,
    // and `heartbeat.ts` sets no floor. `MakeSessionOptions.liveness` is a
    // legitimate knob for its own reasons: a cheaper or quieter `system.live`
    // round-trip, or turning the watchdog off. Never for riding out a blip.)
    for (const [intervalMs, timeoutMs] of [
      [DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS],
      [60_000, 30_000],
      [MAX_HEARTBEAT_INTERVAL_MS, MAX_HEARTBEAT_TIMEOUT_MS],
    ] as const) {
      const verdictMs = heartbeatVerdictMs(intervalMs, timeoutMs);
      expect(verdictMs).toBeGreaterThanOrEqual(defaultHeartbeatMs);
      expect(RPC_PING_FATAL_SILENCE_MS).toBeLessThan(verdictMs);
    }
  });
});

describe("what bounds a silence during PROVISIONING", () => {
  it("is the child's progress-liveness budget, not the ssh policy", () => {
    // ssh keepalives ride the protocol layer and produce no child stdout, so
    // they never reset this budget: a blip during a build is group-killed at
    // 120s however long the ssh policy would have waited.
    expect(PROVISION_STEP_SILENCE_BASE_MS).toBe(120_000);
    const ci = sshKeepalive(30, 10); // the policy the docs print: 300s
    expect(keepaliveVerdictMs(ci)).toBe(300_000);
    expect(PROVISION_STEP_SILENCE_BASE_MS).toBeLessThan(keepaliveVerdictMs(ci));
  });

  it("records the escalated ceiling a raised policy still cannot reach past", () => {
    // The budget doubles per consecutive expiry, so the LAST budgeted silence is
    // base × 2^(N-1). Even that is a bound on the child, not on ssh: a keepalive
    // raised beyond it buys the build nothing, and one raised below it means the
    // transport dies first and the dial retries.
    const lastBudgetedMs =
      PROVISION_STEP_SILENCE_BASE_MS * 2 ** (PROVISION_STEP_MAX_EXPIRIES - 1);
    expect(lastBudgetedMs).toBe(960_000);
    expect(MAX_SSH_KEEPALIVE_TOLERANCE_S * 1_000).toBeGreaterThan(
      lastBudgetedMs,
    );
  });
});

describe("what the ssh keepalive DOES bound", () => {
  it("is the transport's own death — a window the caller states and pays for", () => {
    // The one honest reading of the option: symmetric cost. Whatever silence a
    // policy tolerates on a slow peer, it also spends parked on a dead one
    // before the reconnect loop can retry.
    const ci = sshKeepalive(30, 10);
    expect(keepaliveVerdictMs(ci)).toBe(
      keepaliveToleranceS({ intervalS: 30, countMax: 10 }) * 1_000,
    );
    expect(keepaliveVerdictMs(ci)).toBeGreaterThan(
      keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE),
    );
    // And the ceiling is a ceiling on going UNNOTICED, not a survival promise.
    expect(MAX_SSH_KEEPALIVE_TOLERANCE_S).toBe(3_600);
  });
});
