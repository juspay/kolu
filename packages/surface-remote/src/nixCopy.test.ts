/**
 * Coverage for `provisionAgent`'s cold path: GC-root pinning (step 4), the
 * ControlMaster/keepalive env on provisioning, cause classification, and the #1908
 * lifetime-policy handling (a `lifetime-expired`/`aborted` step is retryable and
 * budget-aware). Keeps off real ssh / nix by mocking `./process`; the real `./host`
 * builds the argv so the assertions see exactly what would hit the wire. The
 * ask-only warm-check SHAPE (D1a) is pinned in `warmProbeCheck.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetControlMemo } from "./controlMaster";
import {
  agentGcRootPath,
  directAgentDerivation,
  flakeAgentDerivation,
  makeProvisionBudgets,
  makeStepBudget,
  type ProvisionBudgets,
  provisionAgent,
} from "./nixCopy";
import { type CaptureResult, runCapture } from "./process";

vi.mock("./process", async (importOriginal) => ({
  // Keep the real pure helpers (`describeExit`) and mock only the two
  // subprocess-spawning entry points.
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
}));

const STORE = "/nix/store/x8yvl9si8vb93vhwway7kf3zbvv4ahg1-agent";
const DRV = "/nix/store/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-agent.drv";
const FLAKE_INSTALLABLE = "/nix/store/source#packages.x86_64-linux.agent";

const okOut = (stdout: string): CaptureResult => ({
  ok: true,
  kind: "exit",
  code: 0,
  stdout,
});
const failOut: CaptureResult = { ok: false, kind: "exit", code: 1, stdout: "" };

/** The fused budgets a `provisionAgent` call needs (the connector reconciles the
 *  campaign reset itself, so `provisionAgent` takes no epoch). Pass a custom `budgets`
 *  (e.g. a tight-terminal one) to override. */
function provArgs(budgets: ProvisionBudgets = makeProvisionBudgets()) {
  return { budgets };
}

/** Route the mocked `runCapture` by the command it was handed (robust to call
 *  order): the sender-local `-q --outputs`, the ssh `--check-validity`, the
 *  `--realise … --add-root` pin, and the atomic `nix build` provision. */
function mockNix(over?: {
  outputs?: CaptureResult;
  checkValidity?: CaptureResult;
  realise?: CaptureResult;
  pin?: CaptureResult;
}): void {
  vi.mocked(runCapture).mockImplementation(async (_cmd, args) => {
    if (args.includes("--outputs")) return over?.outputs ?? okOut(`${STORE}\n`);
    if (args.includes("--check-validity"))
      return over?.checkValidity ?? failOut; // cold: not on host yet
    if (args.includes("--add-root"))
      return over?.pin ?? okOut("/home/u/link\n");
    // Cold realise is `nix build -v --print-out-paths --no-link` (plain -v so
    // per-path lines reach the connect tail, #1962) — not classic `nix-store
    // --realise` (that remains on the pin).
    if (args.includes("--print-out-paths"))
      return over?.realise ?? okOut(`${STORE}\n`);
    if (args.includes("--realise")) return over?.realise ?? okOut(`${STORE}\n`);
    return failOut;
  });
}

const tmpDirs: string[] = [];
beforeEach(() => {
  const xdg = mkdtempSync(join(tmpdir(), "kolu-ssh-nixcopy-test-"));
  tmpDirs.push(xdg);
  vi.stubEnv("XDG_RUNTIME_DIR", xdg);
  __resetControlMemo();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  __resetControlMemo();
  for (const d of tmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

describe("provisionAgent GC-root pinning (cold path)", () => {
  it("rejects a direct source that is not a derivation path", () => {
    expect(() => directAgentDerivation("/nix/store/not-an-output")).toThrow(
      /\.drv/,
    );
  });

  it("pins the realised output with an indirect per-agent root", async () => {
    mockNix();
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res).toEqual({ ok: true, agentPath: STORE });

    // The pin re-realises the *store path* (not the .drv) and registers an indirect
    // root — find that call among the mocked runCaptures.
    const pinArgs = vi
      .mocked(runCapture)
      .mock.calls.map((c) => c[1])
      .find((args) => args.includes("--add-root"));
    expect(pinArgs).toBeDefined();
    expect(pinArgs).toContain("--realise");
    expect(pinArgs).toContain(STORE);
    expect(pinArgs).toContain("--indirect");
    expect(pinArgs).toContain(".local/state/kolu/surface-remote/gcroots/agent");
    expect(pinArgs).not.toContain(DRV);
  });

  it("rides the P2.8 ControlMaster in the remote store's NIX_SSHOPTS env", async () => {
    mockNix();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    const provisionCall = vi
      .mocked(runCapture)
      .mock.calls.find((call) => call[1].includes("--print-out-paths"));
    expect(provisionCall).toBeDefined();
    const opts = provisionCall![2];
    const nixSshOpts = opts.env?.NIX_SSHOPTS ?? "";
    expect(nixSshOpts).toContain("-o ControlMaster=auto");
    expect(nixSshOpts).toMatch(/-o ControlPath=\S+\/%C(\s|$)/);
    expect(nixSshOpts).toContain("-o ControlPersist=10m");
    expect(nixSshOpts).toContain("-o ServerAliveInterval=10");
  });

  it("uses one remote-store Nix build for transfer and realisation", async () => {
    mockNix();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    const buildArgs = vi
      .mocked(runCapture)
      .mock.calls.map((c) => c[1])
      .find((args) => args.includes("--print-out-paths"));
    expect(buildArgs).toBeDefined();
    expect(buildArgs).toContain("-v");
    expect(buildArgs).not.toContain("--log-format");
    expect(buildArgs).toContain("build");
    expect(buildArgs).toEqual(
      expect.arrayContaining([
        "--eval-store",
        "auto",
        "--store",
        "ssh-ng://testhost",
      ]),
    );
    expect(buildArgs).toContain("--no-link");
    expect(buildArgs).toContain(`${DRV}^*`);
  });

  it("builds a flake installable so Nix owns evaluation through realisation", async () => {
    mockNix();
    await provisionAgent({
      host: "testhost",
      derivation: flakeAgentDerivation(DRV, FLAKE_INSTALLABLE),
      onProgress: () => {},
      ...provArgs(),
    });

    const buildArgs = vi
      .mocked(runCapture)
      .mock.calls.map((c) => c[1])
      .find((args) => args.includes("--print-out-paths"));
    expect(buildArgs).toContain(FLAKE_INSTALLABLE);
    expect(buildArgs).not.toContain(`${DRV}^*`);
  });

  it("localhost realise keeps the installable unquoted (direct spawn, no shell)", async () => {
    mockNix();
    await provisionAgent({
      host: "localhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    const buildArgs = vi
      .mocked(runCapture)
      .mock.calls.map((c) => c[1])
      .find((args) => args.includes("--print-out-paths"));
    expect(buildArgs).toBeDefined();
    expect(buildArgs).toContain(`${DRV}^*`);
  });

  it("re-evaluates the flake installable for a localhost cold build", async () => {
    mockNix();
    await provisionAgent({
      host: "localhost",
      derivation: flakeAgentDerivation(DRV, FLAKE_INSTALLABLE),
      onProgress: () => {},
      ...provArgs(),
    });

    const buildArgs = vi
      .mocked(runCapture)
      .mock.calls.map((c) => c[1])
      .find((args) => args.includes("--print-out-paths"));
    expect(buildArgs).toContain(FLAKE_INSTALLABLE);
    expect(buildArgs).not.toContain(`${DRV}^*`);
  });

  it("returns the immutable store path, not the moving root link", async () => {
    mockNix();
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res.ok && res.agentPath).toBe(STORE);
  });

  it("treats a pin failure as non-fatal — the agent still provisions", async () => {
    const lines: string[] = [];
    const res = await (() => {
      mockNix({ pin: failOut });
      return provisionAgent({
        host: "testhost",
        derivation: directAgentDerivation(DRV),
        onProgress: (l) => lines.push(l),
        ...provArgs(),
      });
    })();
    expect(res).toEqual({ ok: true, agentPath: STORE });
    expect(lines.some((l) => l.includes("unpinned"))).toBe(true);
  });

  it("does not pin when the realise itself fails", async () => {
    mockNix({ realise: failOut });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res.ok).toBe(false);
    // No pin call was issued.
    const pinned = vi
      .mocked(runCapture)
      .mock.calls.some((c) => c[1].includes("--add-root"));
    expect(pinned).toBe(false);
  });
});

describe("provisionAgent cause classification", () => {
  it("classifies a transport 255 on the build as network", async () => {
    mockNix({ realise: { ok: false, kind: "exit", code: 255, stdout: "" } });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res.ok === false && res.cause).toBe("network");
  });

  it("does not let a stale warm-probe network blip poison cold provisioning", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (args.includes("--outputs")) return okOut(`${STORE}\n`);
      if (args.includes("--check-validity")) {
        opts?.onProgress?.(
          "ssh: connect to host testhost port 22: No route to host",
        );
        return { ok: false, kind: "exit", code: 255, stdout: "" };
      }
      if (args.includes("--print-out-paths")) return failOut; // genuine remote failure
      if (args.includes("--realise")) return failOut;
      return failOut;
    });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res.ok === false && res.cause).toBe("remote");
  });
});

const EXPIRED_PROVISION = {
  ok: false as const,
  kind: "lifetime-expired" as const,
  policy: { kind: "progress-liveness" as const, silenceMs: 120_000 },
  signal: "SIGTERM" as const,
  stdout: "",
};

/** A fused ProvisionBudgets with an overridable provisioning step. */
function budgetsWithProvisioning(
  provisioning: ReturnType<typeof makeStepBudget>,
): ProvisionBudgets {
  return {
    evaluation: makeStepBudget(120_000, 4),
    provisioning,
    onCampaign: () => {},
  };
}

describe("provisionAgent lifetime-policy handling (#1908)", () => {
  it("a lifetime-expired provision is retryable and records the budget", async () => {
    const b = makeProvisionBudgets();
    const spy = vi.spyOn(b.provisioning, "recordExpiry");
    mockNix({ realise: EXPIRED_PROVISION });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(b),
    });
    expect(res.ok === false && res.cause).toBe("network");
    expect(res.ok === false && res.terminal).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a budget-exhausted silent provision becomes terminal", async () => {
    // A tight budget: one expiry exhausts it.
    const b = budgetsWithProvisioning(makeStepBudget(120_000, 1));
    mockNix({ realise: EXPIRED_PROVISION });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(b),
    });
    // A silent-then-killed step is a transport fault, so `cause` stays `network`; the
    // give-up axis is the orthogonal `terminal` flag the session's gate keys off.
    expect(res.ok === false && res.cause).toBe("network");
    expect(res.ok === false && res.terminal).toBe(true);
    expect(res.ok === false && res.reason).toMatch(/giving up/i);
  });

  it("an aborted provision is retryable and does not touch the budget", async () => {
    const b = makeProvisionBudgets();
    const spy = vi.spyOn(b.provisioning, "recordExpiry");
    mockNix({ realise: { ok: false, kind: "aborted", stdout: "" } });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(b),
    });
    expect(res.ok === false && res.cause).toBe("network");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a successful provision resets its budget's doubling", async () => {
    const b = makeProvisionBudgets();
    const spy = vi.spyOn(b.provisioning, "reset");
    mockNix();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(b),
    });
    expect(spy).toHaveBeenCalled();
  });

  it("onCampaign is MONOTONIC — a stale older epoch does not reset a newer campaign (F6)", () => {
    const b = makeProvisionBudgets();
    const provisioningReset = vi.spyOn(b.provisioning, "reset");
    b.onCampaign(2); // establish campaign 2
    provisioningReset.mockClear();
    b.onCampaign(1); // a STALE dial from campaign 1 resolving late → must be IGNORED
    expect(provisioningReset).not.toHaveBeenCalled();
    b.onCampaign(3); // a genuinely newer campaign still resets
    expect(provisioningReset).toHaveBeenCalledTimes(1);
  });

  it("an abort DURING the GC-root pin is a retryable failure, not a false success (F9)", async () => {
    // Cold path succeeds through realise; the user aborts during the final pin.
    mockNix({ pin: { ok: false, kind: "aborted", stdout: "" } });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.cause).toBe("network");
    expect(res.ok === false && res.reason).toMatch(/aborted/i);
  });

  it("provisioning aborted before it starts does no work and returns network (F6)", async () => {
    mockNix();
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV),
      onProgress: () => {},
      ...provArgs(),
      signal: AbortSignal.abort(),
    });
    expect(res.ok === false && res.cause).toBe("network");
    // No work done — the already-aborted dial spawns nothing.
    expect(runCapture).not.toHaveBeenCalled();
  });
});

// A store-path .drv with a 32-char base32 hash, like nix produces.
const drvOf = (name: string) => `/nix/store/${"a".repeat(32)}-${name}.drv`;

describe("agentGcRootPath", () => {
  it("strips the store hash so versions of one agent share a link", () => {
    const a = agentGcRootPath(false, drvOf("agent"));
    const b = agentGcRootPath(false, `/nix/store/${"b".repeat(32)}-agent.drv`);
    expect(a).toBe(b);
    expect(a).toBe(".local/state/kolu/surface-remote/gcroots/agent");
  });

  it("keeps distinct agents on distinct links", () => {
    const mon = agentGcRootPath(false, drvOf("process-monitor-agent"));
    const term = agentGcRootPath(false, drvOf("kolu-terminal-agent"));
    expect(mon).not.toBe(term);
    expect(mon).toMatch(/gcroots\/process-monitor-agent$/);
  });

  it("anchors to $HOME for localhost (no ssh chdir to rely on)", () => {
    vi.stubEnv("HOME", "/home/tester");
    expect(agentGcRootPath(true, DRV)).toBe(
      "/home/tester/.local/state/kolu/surface-remote/gcroots/agent",
    );
  });

  it("returns null for localhost when $HOME is unset (no cwd-relative root)", () => {
    vi.stubEnv("HOME", undefined);
    expect(agentGcRootPath(true, DRV)).toBeNull();
  });

  it("never returns null for a remote host (resolves against ssh $HOME)", () => {
    vi.stubEnv("HOME", undefined);
    expect(agentGcRootPath(false, DRV)).toBe(
      ".local/state/kolu/surface-remote/gcroots/agent",
    );
  });
});
