/**
 * #1908 arch-gate finding — a PERMANENTLY-SILENT copy/build must reach terminal
 * `failed` in a BOUNDED number of attempts. The bug the gate caught: a
 * budget-exhausted step emitted "one `remote` of five" toward the give-up counter,
 * which the pre-connected backstop reset before it ever counted — so a wedged step
 * looped forever. The fix makes a budget-exhausted step GENUINELY terminal
 * (`ConnectError.terminal`), decoupled from `MAX_CONSECUTIVE_FAILURES`.
 *
 * This drives the REAL chain end to end: a mocked `nix copy` that always
 * lifetime-expires → `provisionAgent`'s copy budget doubling → terminal at
 * `PROVISION_STEP_MAX_EXPIRIES` → `sshConnector` throws a terminal `ConnectError` →
 * `makeSession` gives up at `failed`. The connector's budgets persist across the
 * campaign's retries (one connector closure), so the count is bounded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetControlMemo } from "./controlMaster";
import { silentLogger } from "./loggerStubs.testutil";
import { PROVISION_STEP_MAX_EXPIRIES } from "./nixCopy";
import { type ExitResult, runCapture, runProgress } from "./process";
import { makeSession } from "./session";
import { sshConnector } from "./sshConnector";

vi.mock("./process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
  runProgress: vi.fn(),
}));

const STORE = "/nix/store/x8yvl9si8vb93vhwway7kf3zbvv4ahg1-agent";
const DRV = "/nix/store/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-agent.drv";

const EXPIRED_COPY: ExitResult = {
  ok: false,
  kind: "lifetime-expired",
  policy: { kind: "progress-liveness", silenceMs: 120_000 },
  signal: "SIGTERM",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("XDG_RUNTIME_DIR", "/tmp");
  __resetControlMemo();
  // Cold host: outputs resolve locally, check-validity misses → falls through to copy,
  // which ALWAYS lifetime-expires (a permanently-silent transfer).
  vi.mocked(runCapture).mockImplementation(async (_cmd, args) => {
    if (args.includes("--outputs"))
      return { ok: true, kind: "exit", code: 0, stdout: `${STORE}\n` };
    return { ok: false, kind: "exit", code: 1, stdout: "" }; // check-validity miss
  });
  vi.mocked(runProgress).mockResolvedValue(EXPIRED_COPY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetControlMemo();
});

describe("#1908 — a permanently-silent copy reaches `failed`, bounded", () => {
  it("gives up terminally after the copy budget is exhausted, not looping forever", async () => {
    const connectOnce = sshConnector({
      host: "testhost",
      binary: "agent",
      resolveDrvPath: () => Promise.resolve(DRV),
      localEnv: {},
    });
    const session = makeSession({
      connectOnce,
      initialConnection: "probing",
      liveness: false,
      reconnectDelayMs: 1,
      log: silentLogger,
    });

    session.pin().catch(() => {});
    // Drain each attempt + its tiny backoff. The mocked copy lifetime-expires INSTANTLY
    // (no real timer), so we only advance the ~1ms backoffs — the baked backstop (20min)
    // never fires here, leaving the step budget to terminalise. Cap iterations so a
    // REGRESSION (infinite loop) fails loudly here instead of hanging.
    for (let i = 0; i < 40 && session.currentState().phase !== "failed"; i++) {
      await vi.advanceTimersByTimeAsync(5);
    }

    expect(session.currentState().phase).toBe("failed");
    // Bounded: the copy budget terminalises at PROVISION_STEP_MAX_EXPIRIES expiries, so
    // `nix copy` (runProgress) ran that many times, never unbounded.
    expect(vi.mocked(runProgress).mock.calls.length).toBe(
      PROVISION_STEP_MAX_EXPIRIES,
    );
    session.destroy();
  });
});
