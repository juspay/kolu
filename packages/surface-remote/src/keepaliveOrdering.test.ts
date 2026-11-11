/**
 * The ORDERING of every bound on "how long may this link be silent" — pinned,
 * because the docs make claims about it, prose drifts, and an earlier round of
 * those docs got it wrong in a way arithmetic can catch.
 *
 * There are FOUR independent bounds:
 *
 *   1. **`makeSession`'s heartbeat** — ≈25s at its defaults, tunable via
 *      `MakeSessionOptions.liveness`. The LIVENESS AUTHORITY on a connected
 *      link: suspension-aware, and on a same-box arm consulting a process
 *      oracle before it cycles anything.
 *   2. **ssh's dead-peer policy** (`SshKeepalive`) — the transport's own death,
 *      30s at its defaults.
 *   3. **The link's keep-alive backstop** — `@kolu/surface` owns it
 *      (`keepAlive.ts`, the canonical account: a ping every 5s, fatal past
 *      `RPC_PING_TIMEOUT_MS` = 60s with no decoded frame, so 60–65s); measured
 *      by `links/stdioPingStall.test.ts`. It ends only a link nothing above has
 *      already judged.
 *   4. **The provisioning child-lifetime budget** — group-kills a child that
 *      goes quiet. NOT one number: 30s hard deadline for a quick probe, 120s of
 *      child silence for a required build that DOUBLES per expiry to a last
 *      budgeted 960s, and a fixed 600s for the speculative closure copies. ssh
 *      keepalives are protocol traffic and produce no child stdout, so they
 *      never reset any of them. It bounds a child that is not yet a connected
 *      link, so it does not compete with (1)–(3).
 *
 * The file exists to make the real ordering — heartbeat < ssh keepalive <
 * backstop at the defaults — the thing a regression breaks against, and to say
 * honestly where it stops holding: a heartbeat TUNED past the backstop gets no
 * vote, and the backstop decides. Sibling of `livenessOrdering.test.ts`, which
 * pins the pre-connected backstop the same way.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  MAX_HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_TIMEOUT_MS,
} from "@kolu/surface/heartbeat";
import {
  RPC_PING_FATAL_SILENCE_MS,
  RPC_PING_TIMEOUT_MS,
} from "@kolu/surface/keepAlive";
import { CI_KEEPALIVE } from "./controlDir.testutil";
import {
  DEFAULT_SSH_KEEPALIVE,
  keepaliveToleranceS,
  MAX_SSH_KEEPALIVE_TOLERANCE_S,
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
  it("is the framework watchdog, then ssh — the keep-alive is a backstop above both", () => {
    // The whole ordering, in one line: heartbeat < ssh keepalive < backstop.
    expect(defaultHeartbeatMs).toBeLessThan(
      keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE),
    );
    // The backstop's EARLIEST death (just past the timeout) is already above
    // the slowest default verdict — so neither is ever pre-empted.
    expect(keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE)).toBeLessThan(
      RPC_PING_TIMEOUT_MS,
    );
    // The derivation `keepAlive.ts` states: twice the slowest default verdict.
    expect(RPC_PING_TIMEOUT_MS).toBe(
      2 *
        Math.max(defaultHeartbeatMs, keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE)),
    );
    // The concrete numbers the docs quote, so a re-tune has to update all three.
    expect(defaultHeartbeatMs).toBe(25_000);
    expect(keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE)).toBe(30_000);
    expect(RPC_PING_FATAL_SILENCE_MS).toBe(65_000);
  });

  it("is the BACKSTOP once the heartbeat is tuned past it — up to the 420s maximum", () => {
    // Wind the heartbeat to its ceiling. It is still a legal tuning, and on a
    // connected link it no longer decides anything: total silence ends the link
    // at the backstop (≤ 65s) long before a 420s verdict. That is the honest
    // limit of "the watchdog is the authority" — it holds for every tuning
    // whose verdict lands before the backstop, and no further.
    const loosestHeartbeatMs = heartbeatVerdictMs(
      MAX_HEARTBEAT_INTERVAL_MS,
      MAX_HEARTBEAT_TIMEOUT_MS,
    );
    expect(loosestHeartbeatMs).toBe(420_000);
    expect(RPC_PING_FATAL_SILENCE_MS).toBeLessThan(loosestHeartbeatMs);
    // The same for the loosest ssh policy a consumer may state: a CONNECTED
    // link still ends at the backstop; the policy only bounds the transport.
    expect(RPC_PING_FATAL_SILENCE_MS).toBeLessThan(
      MAX_SSH_KEEPALIVE_TOLERANCE_S * 1_000,
    );
  });

  it("gives the heartbeat the vote at every tuning whose verdict lands before the backstop", () => {
    // The direction that matters, stated as a general fact: every heartbeat
    // verdict up to the backstop's earliest death decides first. Past it (the
    // case above) the backstop does. `MakeSessionOptions.liveness` is a
    // legitimate knob for its own reasons: a cheaper or quieter `system.live`
    // round-trip, a looser verdict for a known-slow host, or turning the
    // watchdog off.
    for (const [intervalMs, timeoutMs, decides] of [
      [DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS, true],
      [30_000, 20_000, true],
      [45_000, 20_000, false],
      [MAX_HEARTBEAT_INTERVAL_MS, MAX_HEARTBEAT_TIMEOUT_MS, false],
    ] as const) {
      const verdictMs = heartbeatVerdictMs(intervalMs, timeoutMs);
      expect(verdictMs < RPC_PING_TIMEOUT_MS).toBe(decides);
    }
  });
});

describe("what bounds a silence during PROVISIONING", () => {
  it("is the child's lifetime budget, not the ssh policy", () => {
    // ssh keepalives ride the protocol layer and produce no child stdout, so
    // they never reset any of these budgets: a blip during a required build is
    // group-killed at 120s however long the ssh policy would have waited.
    expect(PROVISION_STEP_SILENCE_BASE_MS).toBe(120_000);
    expect(keepaliveVerdictMs(CI_KEEPALIVE)).toBe(300_000);
    expect(PROVISION_STEP_SILENCE_BASE_MS).toBeLessThan(
      keepaliveVerdictMs(CI_KEEPALIVE),
    );
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
    expect(keepaliveVerdictMs(CI_KEEPALIVE)).toBeGreaterThan(
      granted[0] as number,
    );
    expect(keepaliveVerdictMs(CI_KEEPALIVE)).toBeLessThan(granted[3] as number);
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
    expect(keepaliveVerdictMs(CI_KEEPALIVE)).toBeGreaterThan(
      keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE),
    );
    // And the ceiling is a ceiling on going UNNOTICED, not a survival promise.
    expect(MAX_SSH_KEEPALIVE_TOLERANCE_S).toBe(3_600);
  });
});
