/**
 * The ORDERING of every bound on "how long may this link be silent" — pinned,
 * because the docs make claims about it, prose drifts, and the last round of
 * those docs got it wrong in a way arithmetic can catch.
 *
 * There are FOUR independent bounds, and `SshKeepalive` is only the last:
 *
 *   1. **Effect RPC's own pinger** — fatal the moment a tick finds the previous
 *      ping unanswered, so `RPC_PING_FATAL_SILENCE_MS` of silence ends a
 *      CONNECTED link. NOT a knob. Canonical account: the docstring beside
 *      `neverReconnect` in `@kolu/surface`'s `links/wire.ts`, which is also
 *      where those two constants are declared; measured by
 *      `links/stdioPingStall.test.ts`.
 *   2. **`makeSession`'s heartbeat** — ≈25s at its defaults, tunable via
 *      `MakeSessionOptions.liveness`. At its defaults and at every RAISED tuning
 *      it "never gets a vote, because the lower deadline always wins" (`wire.ts`,
 *      verbatim). Tuned BELOW the pinger's 10s it does fire first — `heartbeat.ts`
 *      sets no floor — which is why the test below pins the raised direction.
 *   3. **The provisioning child-lifetime budget** — group-kills a child that
 *      goes quiet. NOT one number: 30s hard deadline for a quick probe, 120s of
 *      child silence for a required build that DOUBLES per expiry to a last
 *      budgeted 960s, and a fixed 600s for the speculative closure copies. ssh
 *      keepalives are protocol traffic and produce no child stdout, so they
 *      never reset any of them.
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
import { RPC_PING_FATAL_SILENCE_MS } from "@kolu/surface/links/wire";
import {
  DEFAULT_SSH_KEEPALIVE,
  keepaliveToleranceS,
  MAX_SSH_KEEPALIVE_TOLERANCE_S,
  sshKeepalive,
} from "./keepalive";
import {
  makeStepBudget,
  PROVISION_COPY_SILENCE_MS,
  PROVISION_PROBE_DEADLINE_MS,
  PROVISION_STEP_MAX_EXPIRIES,
  PROVISION_STEP_SILENCE_BASE_MS,
} from "./nixCopy";

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
  it("is the child's lifetime budget, not the ssh policy", () => {
    // ssh keepalives ride the protocol layer and produce no child stdout, so
    // they never reset any of these budgets: a blip during a required build is
    // group-killed at 120s however long the ssh policy would have waited.
    expect(PROVISION_STEP_SILENCE_BASE_MS).toBe(120_000);
    const ci = sshKeepalive(30, 10); // the policy the docs print: 300s
    expect(keepaliveVerdictMs(ci)).toBe(300_000);
    expect(PROVISION_STEP_SILENCE_BASE_MS).toBeLessThan(keepaliveVerdictMs(ci));
  });

  it("is 120s only INITIALLY — the required build's budget escalates", () => {
    // The docs must not print 120s as a standing cliff. `makeStepBudget` grants
    // `base × 2^expiries`, so a step already killed once gets 240s, then 480s,
    // with 960s the last budgeted silence before it turns terminal. A raised ssh
    // tolerance is therefore inert only past the CURRENT grant, not past 120s.
    const budget = makeStepBudget(
      PROVISION_STEP_SILENCE_BASE_MS,
      PROVISION_STEP_MAX_EXPIRIES,
    );
    const granted: number[] = [];
    for (let i = 0; i < PROVISION_STEP_MAX_EXPIRIES; i += 1) {
      const policy = budget.policy();
      // The escalating steps are `progress-liveness`; the quick probes are the
      // other kind (a hard deadline), asserted separately below.
      if (policy.kind !== "progress-liveness")
        throw new Error(`unexpected policy kind: ${policy.kind}`);
      granted.push(policy.silenceMs);
      budget.recordExpiry();
    }
    expect(granted).toEqual([120_000, 240_000, 480_000, 960_000]);
    // A CI policy the docs print (300s) outlives the FIRST grant and not the
    // later ones — which is exactly why "past 120s is inert" was false.
    expect(keepaliveVerdictMs(sshKeepalive(30, 10))).toBeGreaterThan(
      granted[0] as number,
    );
    expect(keepaliveVerdictMs(sshKeepalive(30, 10))).toBeLessThan(
      granted[3] as number,
    );
    // Even the escalated ceiling is a bound on the CHILD, not on ssh — and the
    // ssh ceiling sits above it, so no policy is refused for being longer.
    expect(MAX_SSH_KEEPALIVE_TOLERANCE_S * 1_000).toBeGreaterThan(
      granted[3] as number,
    );
  });

  it("gives the SPECULATIVE copies their own fixed budget, not the build's", () => {
    // The copies charge no expiry, so they must not inherit the build's doubled
    // allowance — they run under one flat number that never escalates. Looser
    // than the build's base and tighter than its ceiling, which is the whole
    // reason the docs cannot describe "the provisioning budget" as one value.
    expect(PROVISION_COPY_SILENCE_MS).toBe(600_000);
    expect(PROVISION_COPY_SILENCE_MS).toBeGreaterThan(
      PROVISION_STEP_SILENCE_BASE_MS,
    );
    expect(PROVISION_COPY_SILENCE_MS).toBeLessThan(
      PROVISION_STEP_SILENCE_BASE_MS * 2 ** (PROVISION_STEP_MAX_EXPIRIES - 1),
    );
  });

  it("bounds the QUICK probes by wall clock, well under any of those", () => {
    // The third distinct number: a hard deadline, not a silence budget. A raised
    // ssh tolerance is inert past THIS for an arch probe or a warm validity
    // check — 30s, long before either provisioning number.
    expect(PROVISION_PROBE_DEADLINE_MS).toBe(30_000);
    expect(PROVISION_PROBE_DEADLINE_MS).toBeLessThan(
      PROVISION_STEP_SILENCE_BASE_MS,
    );
  });
});

describe("what the ssh keepalive DOES bound", () => {
  it("is the transport's own death — a window the caller states and pays for", () => {
    // The one honest reading of the option: symmetric cost. Whatever silence a
    // policy tolerates on a slow peer, it also spends parked on a dead one
    // before the reconnect loop can retry.
    const ci = sshKeepalive(30, 10);
    expect(keepaliveVerdictMs(ci)).toBeGreaterThan(
      keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE),
    );
    // And the ceiling is a ceiling on going UNNOTICED, not a survival promise.
    expect(MAX_SSH_KEEPALIVE_TOLERANCE_S).toBe(3_600);
  });
});
