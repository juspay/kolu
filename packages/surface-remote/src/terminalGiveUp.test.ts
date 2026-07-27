/**
 * #1908 arch-gate finding — a permanently silent provision must reach terminal
 * `failed` in a BOUNDED number of attempts. The bug the gate caught: a
 * budget-exhausted step emitted "one `remote` of five" toward the give-up counter,
 * which the pre-connected backstop reset before it ever counted — so a wedged step
 * looped forever. The fix makes a budget-exhausted step GENUINELY terminal
 * (`ConnectError.terminal`), decoupled from `MAX_CONSECUTIVE_FAILURES`.
 *
 * This drives the REAL chain end to end: a mocked `nix build` that always
 * lifetime-expires → `provisionAgent`'s provisioning budget doubling → terminal at
 * `PROVISION_STEP_MAX_EXPIRIES` → `sshConnector` throws a terminal `ConnectError` →
 * `makeSession` gives up at `failed`. The connector's budgets persist across the
 * campaign's retries (one connector closure), so the count is bounded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetControlMemo } from "./controlMaster";
import { silentLogger } from "./loggerStubs.testutil";
import { directAgentDerivation, PROVISION_STEP_MAX_EXPIRIES } from "./nixCopy";
import { type CaptureResult, runCapture } from "./process";
import { makeSession } from "./session";
import { sshConnector } from "./sshConnector";
import {
  makeTestAgentSourceDir,
  TEST_BINARY_CACHE,
} from "./agentDerivation.testutil";

vi.mock("./process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
}));

const STORE = "/nix/store/x8yvl9si8vb93vhwway7kf3zbvv4ahg1-agent";
const DRV = "/nix/store/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-agent.drv";

const EXPIRED_PROVISION: CaptureResult = {
  ok: false,
  kind: "lifetime-expired",
  policy: { kind: "progress-liveness", silenceMs: 120_000 },
  signal: "SIGTERM",
  stdout: "",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("XDG_RUNTIME_DIR", "/tmp");
  __resetControlMemo();
  // Cold host: outputs resolve locally, check-validity misses, and the one
  // provisioning command always expires silently.
  vi.mocked(runCapture).mockImplementation(async (_cmd, args) => {
    if (args.includes("--outputs"))
      return { ok: true, kind: "exit", code: 0, stdout: `${STORE}\n` };
    if (args.includes("--print-out-paths")) return EXPIRED_PROVISION;
    return { ok: false, kind: "exit", code: 1, stdout: "" }; // check-validity miss
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetControlMemo();
});

describe("#1908 — a permanently silent provision reaches `failed`, bounded", () => {
  it("publishes provisioning while a warm target's root commit is stalled", async () => {
    vi.mocked(runCapture).mockImplementation(
      async (_cmd, args, runOpts): Promise<CaptureResult> => {
        if (args.includes("--outputs")) {
          return {
            ok: true,
            kind: "exit",
            code: 0,
            stdout: `${STORE}\n`,
          };
        }
        if (args.includes("--check-validity")) {
          return { ok: true, kind: "exit", code: 0, stdout: "" };
        }
        if (args.includes("--add-root")) {
          return await new Promise<CaptureResult>((resolve) => {
            const settleAborted = (): void =>
              resolve({ ok: false, kind: "aborted", stdout: "" });
            if (runOpts.signal?.aborted) {
              settleAborted();
            } else {
              runOpts.signal?.addEventListener("abort", settleAborted, {
                once: true,
              });
            }
          });
        }
        throw new Error(`unexpected command: ${args.join(" ")}`);
      },
    );
    const session = makeSession({
      connectOnce: sshConnector({
        host: "warm-root-stall",
        binary: "agent",
        resolveDrvPath: () =>
          Promise.resolve(directAgentDerivation(DRV, TEST_BINARY_CACHE)),
        localEnv: {},
      }),
      initialConnection: "probing",
      liveness: false,
      log: silentLogger,
    });

    session.pin().catch(() => {});
    for (
      let i = 0;
      i < 10 && session.currentState().phase !== "provisioning";
      i++
    ) {
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(session.currentState().phase).toBe("provisioning");
    session.destroy();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("gives up terminally after the provisioning budget is exhausted", async () => {
    const connectOnce = sshConnector({
      host: "testhost",
      binary: "agent",
      resolveDrvPath: () =>
        Promise.resolve(directAgentDerivation(DRV, TEST_BINARY_CACHE)),
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
    // Drain each attempt + its tiny backoff. The mocked provision expires instantly
    // (no real timer), so we only advance the ~1ms backoffs — the baked backstop (20min)
    // never fires here, leaving the step budget to terminalise. Cap iterations so a
    // REGRESSION (infinite loop) fails loudly here instead of hanging.
    for (let i = 0; i < 40 && session.currentState().phase !== "failed"; i++) {
      await vi.advanceTimersByTimeAsync(5);
    }

    const final = session.currentState();
    expect(final.phase).toBe("failed");
    // The terminal `failed` carries the honest transport cause — a silent provision is
    // `"network"` (a wedged transport killed enough times), never rewritten to `"remote"`
    // to satisfy terminality (F3).
    expect(final.phase === "failed" && final.cause).toBe("network");
    // Bounded: exactly one provisioning command runs per charged expiry.
    const provisionCalls = vi
      .mocked(runCapture)
      .mock.calls.filter((call) => call[1].includes("--print-out-paths"));
    expect(provisionCalls.length).toBe(PROVISION_STEP_MAX_EXPIRIES);
    session.destroy();
  });

  it("carries evaluation-budget exhaustion to the session as terminal", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args) => {
      if (args.includes("builtins.currentSystem")) {
        return {
          ok: true,
          kind: "exit",
          code: 0,
          stdout: '"x86_64-linux"\n',
        };
      }
      if (args[0] === "eval") return EXPIRED_PROVISION;
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });
    // A REAL on-disk agent source (with its binary-cache sidecar): this suite
    // drives the real agentDrv module, whose resolve reads the sidecar before
    // spending the evaluation this test expires.
    const srcDir = makeTestAgentSourceDir();
    const connectOnce = sshConnector({
      host: "silent-evaluator",
      binary: "agent",
      resolveDrvPath: (ctx) => ctx.resolveAgentDrv(srcDir, "agent"),
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
    for (let i = 0; i < 40 && session.currentState().phase !== "failed"; i++) {
      await vi.advanceTimersByTimeAsync(5);
    }

    const final = session.currentState();
    expect(final.phase).toBe("failed");
    expect(final.phase === "failed" && final.cause).toBe("network");
    const evalCalls = vi
      .mocked(runCapture)
      .mock.calls.filter((call) => call[1][0] === "eval");
    expect(evalCalls).toHaveLength(PROVISION_STEP_MAX_EXPIRIES);
    session.destroy();
  });
});
