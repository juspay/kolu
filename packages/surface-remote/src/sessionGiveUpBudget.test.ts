/**
 * The FIELD FALSIFIERS for the session's bounded give-up budget (juspay/kolu#2101).
 *
 * The incident: a laptop slept overnight with a remote host pinned. ~18 straight
 * `host unreachable` failures — the UNBOUNDED `"network"` class, the one the docs
 * promised "never counts toward the bounded give-up budget" — walked the session's
 * one shared `consecutiveFailures` counter to 18. At a macOS dark-wake the host
 * accepted the connection and then dozed mid-handshake: ONE `"remote"` failure. It
 * landed on a counter already ≥ 18, tripped `cause === "remote" && count >= 5`, and
 * the session went instantly terminal with a card reading "gave up after 5
 * consecutive failures". It was one. The morning `nudge()` correctly no-ops on
 * `failed`, so the host stayed dead until a human clicked Reconnect.
 *
 * Why no existing test saw it: every one of them drives a SINGLE cause. An
 * all-`"network"` run never evaluates the `cause === "remote"` arm however high the
 * counter climbs; an all-`"remote"` run has nothing inflating it unfairly. **No test
 * interleaved the causes** — the only shape that exposes the conflation. These do.
 *
 * The algebra behind the fix is pinned in the framework
 * (`@kolu/surface`'s `failureLedger.test.ts`); this file pins the FIELD SHAPE at the
 * session seam, against a real `makeSession` and a scripted connector.
 */
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectLogger } from "@kolu/log/loggerStubs.testutil";
import {
  type ClosedInfo,
  ConnectError,
  type Connection,
  type Connector,
  makeSession,
  type Session,
  type SessionState,
} from "./session";

/** Mirrors `MAX_CONSECUTIVE_FAILURES` in `session.ts` (module-private on purpose —
 *  it is not a knob). */
const MAX_CONSECUTIVE_FAILURES = 5;

/** The incident's own count: attempts that failed `"network"` overnight before the
 *  single dark-wake `"remote"` failure landed. Deliberately ≫ the remote ceiling. */
const OVERNIGHT_UNREACHABLE_ATTEMPTS = 18;

/** A minimal surface-shaped client: answers the reserved `system.identity` /
 *  `system.clockNow` so the connected path's probes don't reject noisily. */
type FakeClient = {
  surface: {
    system: {
      identity: () => Effect.Effect<{ kind: string }, never>;
      clockNow: () => Effect.Effect<{ epochMs: number }, never>;
    };
  };
};

const fakeClient = (): FakeClient => ({
  surface: {
    system: {
      identity: () => Effect.succeed({ kind: "anonymous" }),
      clockNow: () => Effect.succeed({ epochMs: 0 }),
    },
  },
});

/** What the NEXT dial does. `"ok"` hands back a live connection (adopted by the
 *  admit hook, so convergence is hands-off — no `markConnected()` from the test). */
type DialOutcome = "network" | "remote" | "ok";

/** A connector driven by a script of per-dial outcomes. When the script runs out it
 *  repeats its last entry forever, so a test only writes the prefix it cares about. */
function scriptedConnector(script: DialOutcome[]): {
  connectOnce: Connector<FakeClient, never>;
  dials: () => number;
  outcomes: () => DialOutcome[];
} {
  let n = 0;
  const seen: DialOutcome[] = [];
  const connectOnce: Connector<FakeClient, never> = async (
    ctx,
  ): Promise<Connection<FakeClient>> => {
    const outcome = script[Math.min(n, script.length - 1)] ?? "network";
    n += 1;
    seen.push(outcome);
    if (outcome === "network") {
      throw new ConnectError("host unreachable (scripted)", "network");
    }
    if (outcome === "remote") {
      throw new ConnectError(
        "stream ended before a readiness banner arrived (scripted)",
        "remote",
      );
    }
    let resolveClosed: (info: ClosedInfo) => void = () => {};
    const closed = new Promise<ClosedInfo>((r) => {
      resolveClosed = r;
    });
    ctx.connecting();
    return {
      client: fakeClient(),
      closed,
      isAlive: () => Promise.resolve(),
      teardown: () => resolveClosed({ kind: "exit", code: 0, signal: null }),
    };
  };
  return { connectOnce, dials: () => n, outcomes: () => [...seen] };
}

function buildSession(
  connectOnce: Connector<FakeClient, never>,
  onLine: (line: string) => void = () => {},
): Session<FakeClient, never> {
  return makeSession<FakeClient, never>({
    connectOnce,
    initialConnection: "connecting",
    // The admit hook adopts every connection, so a successful dial reaches
    // `connected` with no user verb — that is what "converges hands-off" means.
    admit: () => Promise.resolve({ kind: "adopt" as const }),
    reconnectDelayMs: 1000,
    liveness: false,
    label: "field",
    log: collectLogger(onLine),
  });
}

/** Flush a handful of microtasks so a settled/rejected dial's handlers run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** Advance to whatever timer is next until one more dial has started (or the
 *  session went terminal and no timer remains). Jumping timer-to-timer keeps this
 *  independent of the exponential backoff's exact ramp. */
async function runOneMoreDial(dials: () => number): Promise<void> {
  const start = dials();
  for (let i = 0; i < 50 && dials() === start; i++) {
    await vi.advanceTimersToNextTimerAsync();
    await flush();
  }
}

/** Drive `count` dials from a freshly pinned session. */
async function runDials(
  session: Session<FakeClient, never>,
  dials: () => number,
  count: number,
): Promise<void> {
  session.pin().catch(() => {});
  await flush();
  while (dials() < count) {
    const before = dials();
    await runOneMoreDial(dials);
    if (dials() === before) return; // terminal: nothing left to fire
  }
}

const phaseOf = (s: SessionState<never>): string => s.phase;

describe("the give-up budget counts only failures of the class it bounds", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("(i) THE FIELD SHAPE — 18 unreachable attempts then ONE remote failure does not give up", async () => {
    const lines: string[] = [];
    const script: DialOutcome[] = [
      ...Array<DialOutcome>(OVERNIGHT_UNREACHABLE_ATTEMPTS).fill("network"),
      "remote",
      "ok",
    ];
    const { connectOnce, dials, outcomes } = scriptedConnector(script);
    const session = buildSession(connectOnce, (l) => lines.push(l));

    // The night: every attempt fails `"network"` (the class that retries forever).
    await runDials(session, dials, OVERNIGHT_UNREACHABLE_ATTEMPTS);
    expect(outcomes()).toHaveLength(OVERNIGHT_UNREACHABLE_ATTEMPTS);
    expect(phaseOf(session.currentState())).toBe("disconnected");

    // The dark-wake: ONE `"remote"` failure — ssh accepts, then the Mac dozes
    // mid-handshake and the readiness banner never arrives.
    await runOneMoreDial(dials);
    expect(outcomes().at(-1)).toBe("remote");

    // PRE-FIX this is `failed`, with "gave up after 5 consecutive failures" in the
    // journal after exactly ONE remote failure. The budget must count the remote
    // run, which is 1.
    expect(lines.filter((l) => l.includes("gave up"))).toEqual([]);
    expect(phaseOf(session.currentState())).not.toBe("failed");
    expect(phaseOf(session.currentState())).toBe("disconnected");

    // The morning: the host is really awake now. The session converges with no
    // user verb at all — the scheduled retry it was still allowed to make.
    await runOneMoreDial(dials);
    await flush();
    expect(phaseOf(session.currentState())).toBe("connected");

    session.destroy();
  });

  it("(ii) five consecutive REMOTE failures still give up, and the message names 5", async () => {
    const lines: string[] = [];
    const { connectOnce, dials } = scriptedConnector(["remote"]);
    const session = buildSession(connectOnce, (l) => lines.push(l));

    await runDials(session, dials, MAX_CONSECUTIVE_FAILURES + 2);

    const state = session.currentState();
    expect(phaseOf(state)).toBe("failed");
    expect(state.phase === "failed" && state.cause).toBe("remote");
    // Bounded: the terminal verdict lands at exactly the ceiling, not later.
    expect(dials()).toBe(MAX_CONSECUTIVE_FAILURES);

    const gaveUp = lines.filter((l) => l.includes("gave up"));
    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0]).toContain(`gave up after ${MAX_CONSECUTIVE_FAILURES}`);
    expect(gaveUp[0]).toContain("trusted-users");

    session.destroy();
  });

  it("(iii) the dark-wake ALTERNATION never reaches terminal", async () => {
    // (remote, network×3) × 12 — twelve dark-wakes across a long sleep, each
    // separated by a stretch of unreachable. Forty-eight failures, twelve of them
    // `"remote"`, and the session must still be retrying.
    const cycle: DialOutcome[] = ["remote", "network", "network", "network"];
    const cycles = 12;
    const script: DialOutcome[] = [];
    for (let i = 0; i < cycles; i++) script.push(...cycle);
    script.push("ok");
    const { connectOnce, dials } = scriptedConnector(script);
    const session = buildSession(connectOnce);

    await runDials(session, dials, cycle.length * cycles);
    expect(dials()).toBe(cycle.length * cycles);
    expect(phaseOf(session.currentState())).not.toBe("failed");

    session.destroy();
  });

  it("(iv) after the field shape, nudge() fires the immediate probe — the H2 path `failed` had made unreachable", async () => {
    const lines: string[] = [];
    const script: DialOutcome[] = [
      ...Array<DialOutcome>(OVERNIGHT_UNREACHABLE_ATTEMPTS).fill("network"),
      "remote",
      "ok",
    ];
    const { connectOnce, dials } = scriptedConnector(script);
    const session = buildSession(connectOnce, (l) => lines.push(l));

    await runDials(session, dials, OVERNIGHT_UNREACHABLE_ATTEMPTS + 1);
    expect(phaseOf(session.currentState())).toBe("disconnected");
    const dialsAtWake = dials();

    // The morning wake signal. On the pre-fix `failed` state this was a documented
    // no-op — the budget was spent and the verdict stood. Post-fix the session is
    // still in the retry loop, so the nudge fires the scheduled retry NOW.
    session.nudge();
    await flush();
    expect(dials()).toBe(dialsAtWake + 1);
    expect(
      lines.filter((l) => l.includes("firing the scheduled retry")),
    ).toHaveLength(1);
    await flush();
    expect(phaseOf(session.currentState())).toBe("connected");

    session.destroy();
  });
});
