/**
 * Coverage for `provisionAgent`'s cold path: GC-root commit (step 3), the
 * ControlMaster/keepalive env on provisioning, cause classification, and the #1908
 * lifetime-policy handling (a `lifetime-expired`/`aborted` step is retryable and
 * budget-aware). Keeps off real ssh / nix by mocking `./process`; the real `./host`
 * builds the argv so the assertions see exactly what would hit the wire. The
 * ask-only warm-check SHAPE (D1a) is pinned in `warmProbeCheck.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CI_KEEPALIVE, provArgs, useControlDir } from "./controlDir.testutil";
import { agentBinaryCache } from "./agentBinaryCache";
import { directAgentDerivation, flakeAgentDerivation } from "./agentDerivation";
import {
  agentGcRootPath,
  makeProvisionBudgets,
  makeStepBudget,
  PROVISION_COPY_SILENCE_MS,
  PROVISION_STEP_SILENCE_BASE_MS,
  type ProvisionBudgets,
  provisionAgent,
} from "./nixCopy";
import { type CaptureResult, runCapture } from "./process";
import { sshKeepalive } from "./keepalive";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";

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

/** The two speculative closure copies, matched by SHAPE rather than position —
 *  both argv start with `-v` (per-path progress keeps a healthy transfer alive
 *  under progress-liveness), so an index-based match would silently stop
 *  matching the moment a flag is added. */
const isCopy = (args: readonly string[]): boolean => args.includes("copy");
const isPrefetch = (args: readonly string[]): boolean =>
  isCopy(args) && args.includes("--from");
const isShip = (args: readonly string[]): boolean =>
  isCopy(args) && args.includes("--to");

/** Route the mocked `runCapture` by the command it was handed (robust to call
 *  order): the sender-local `-q --outputs`, the ssh `--check-validity`, the
 *  `--realise … --add-root` pin, and the atomic `nix build` provision. */
function mockNix(over?: {
  outputs?: CaptureResult;
  checkValidity?: CaptureResult;
  localValidity?: CaptureResult;
  realise?: CaptureResult;
  pin?: CaptureResult;
  copy?: CaptureResult;
  ship?: CaptureResult;
}): void {
  vi.mocked(runCapture).mockImplementation(async (cmd, args) => {
    // Cache prefetch (2) / ship (3) — default MISS/refusal, so the suites
    // written before these steps existed keep exercising the narrated
    // source-realise fallback.
    if (isShip(args)) return over?.ship ?? failOut;
    if (isCopy(args)) return over?.copy ?? failOut;
    if (args.includes("--outputs")) return over?.outputs ?? okOut(`${STORE}\n`);
    // The LOCAL "do we even hold this closure?" query the ship is gated on
    // (a bare `nix-store`, unlike the remote warm check's `ssh …`). Default:
    // we don't — so a total prefetch miss skips the ship instead of narrating
    // trust levers about a path we never had.
    if (cmd === "nix-store" && args[0] === "--check-validity")
      return over?.localValidity ?? failOut;
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

useControlDir("kolu-ssh-nixcopy-");
afterEach(() => {
  vi.clearAllMocks();
});

describe("provisionAgent GC-root pinning (cold path)", () => {
  it("rejects a direct source that is not a derivation path", () => {
    expect(() =>
      directAgentDerivation("/nix/store/not-an-output", TEST_BINARY_CACHE),
    ).toThrow(/\.drv/);
  });

  it("pins the realised output with an indirect per-agent root", async () => {
    mockNix();
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
    // The socket is keyed by the keepalive policy — `10x3` is the default.
    expect(nixSshOpts).toMatch(/-o ControlPath=\S+\/%C-10x3(\s|$)/);
    expect(nixSshOpts).toContain("-o ControlPersist=10m");
    expect(nixSshOpts).toContain("-o ServerAliveInterval=10");
    expect(nixSshOpts).toContain("-o ServerAliveCountMax=3");
  });

  it("threads a custom keepalive into EVERY ssh the provisioning spawns", async () => {
    // The provisioning steps are where a long CI lane is most exposed to a
    // blip: a cold build can sit idle for minutes. So the dial's policy has to
    // reach the argv we spawn AND the `NIX_SSHOPTS` Nix's own ssh reads.
    mockNix();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(),
      keepalive: CI_KEEPALIVE,
    });
    const calls = vi.mocked(runCapture).mock.calls;

    // Every ssh argv we build ourselves (the warm check, the GC-root pin).
    const sshCalls = calls.filter(([command]) => command === "ssh");
    expect(sshCalls.length).toBeGreaterThan(0);
    for (const [, args] of sshCalls) {
      expect(args).toContain("ServerAliveInterval=30");
      expect(args).toContain("ServerAliveCountMax=10");
    }

    // …and every Nix command that MAY fork an ssh, whose fork is out of reach of
    // our argv. That includes the cache prefetch: `agentBinaryCache` restricts no
    // substituter scheme, so `ssh://` is a spellable declared cache and a
    // prefetch with no NIX_SSHOPTS would have zero dead-peer detection.
    const nixCalls = calls.filter(([command]) => command === "nix");
    expect(nixCalls.length).toBeGreaterThan(0);
    for (const [, args, o] of nixCalls) {
      // Localhost-only invocations legitimately pass no env; every call that can
      // reach another machine must carry the policy.
      if (o?.env === undefined) {
        throw new Error(
          `a nix invocation reached the wire with no NIX_SSHOPTS: ${args.join(" ")}`,
        );
      }
    }
    const envs = calls
      .map(([, , opts]) => opts?.env?.NIX_SSHOPTS)
      .filter((v): v is string => typeof v === "string");
    expect(envs.length).toBeGreaterThan(0);
    for (const env of envs) {
      expect(env).toContain("-o ServerAliveInterval=30");
      expect(env).toContain("-o ServerAliveCountMax=10");
      // Its own master, never the interactive one (the opener wins for life).
      expect(env).toMatch(/-o ControlPath=\S+\/%C-30x10(\s|$)/);
    }
  });

  it("REFUSES an out-of-range keepalive rather than clamping it", () => {
    // The refusal now lands at the LITERAL rather than several provisioning
    // steps in: `sshKeepalive` is the only producer of the branded value
    // `ProvisionOptions.keepalive` requires, so an out-of-range policy cannot
    // reach `provisionAgent` at all — it never becomes a value, so it is not an
    // escape from the otherwise-total `ProvisionResult` either.
    // 300 × 60 = 5 hours — no longer dead-peer detection at all.
    expect(() => sshKeepalive(300, 60)).toThrow(/ssh keepalive/);
  });

  it("uses one remote-store Nix build for transfer and realisation", async () => {
    mockNix();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
      derivation: flakeAgentDerivation(
        DRV,
        FLAKE_INSTALLABLE,
        TEST_BINARY_CACHE,
      ),
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
      derivation: flakeAgentDerivation(
        DRV,
        FLAKE_INSTALLABLE,
        TEST_BINARY_CACHE,
      ),
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res.ok && res.agentPath).toBe(STORE);
  });

  it("does not expose an agent path when the durable root cannot be established", async () => {
    const res = await (() => {
      mockNix({ pin: failOut });
      return provisionAgent({
        host: "testhost",
        derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
        onProgress: () => {},
        ...provArgs(),
      });
    })();
    expect(res).toEqual({
      ok: false,
      reason:
        "testhost: could not establish the agent GC root: exited with code 1",
      cause: "remote",
    });
  });

  it("does not pin when the realise itself fails", async () => {
    mockNix({ realise: failOut });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(b),
    });
    expect(res.ok === false && res.cause).toBe("network");
    expect(spy).not.toHaveBeenCalled();
  });

  it("resets its budget only after the rooted transaction succeeds", async () => {
    const b = makeProvisionBudgets();
    const spy = vi.spyOn(b.provisioning, "reset");
    mockNix();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(b),
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const pinIndex = vi
      .mocked(runCapture)
      .mock.calls.findIndex((call) => call[1].includes("--add-root"));
    expect(pinIndex).toBeGreaterThanOrEqual(0);
    const resetOrder = spy.mock.invocationCallOrder[0];
    const pinOrder = vi.mocked(runCapture).mock.invocationCallOrder[pinIndex];
    expect(resetOrder).toBeDefined();
    expect(pinOrder).toBeDefined();
    if (resetOrder !== undefined && pinOrder !== undefined) {
      expect(resetOrder).toBeGreaterThan(pinOrder);
    }
  });

  it("a warm rooted hit resets a previously charged provisioning budget", async () => {
    const b = makeProvisionBudgets();
    b.provisioning.recordExpiry();
    const spy = vi.spyOn(b.provisioning, "reset");
    mockNix({ checkValidity: okOut("") });
    const result = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(b),
    });
    expect(result).toEqual({ ok: true, agentPath: STORE });
    expect(spy).toHaveBeenCalledTimes(1);
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
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.cause).toBe("network");
    expect(res.ok === false && res.reason).toMatch(/aborted/i);
  });

  it("a silent GC-root commit charges the provisioning budget", async () => {
    const b = makeProvisionBudgets();
    const spy = vi.spyOn(b.provisioning, "recordExpiry");
    mockNix({ pin: EXPIRED_PROVISION });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(b),
    });
    expect(res.ok === false && res.cause).toBe("network");
    expect(res.ok === false && res.terminal).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a budget-exhausted silent GC-root commit becomes terminal", async () => {
    const b = budgetsWithProvisioning(makeStepBudget(120_000, 1));
    mockNix({ pin: EXPIRED_PROVISION });
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(b),
    });
    expect(res.ok === false && res.cause).toBe("network");
    expect(res.ok === false && res.terminal).toBe(true);
    expect(res.ok === false && res.reason).toMatch(/giving up/i);
  });

  it("provisioning aborted before it starts does no work and returns network (F6)", async () => {
    mockNix();
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
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

describe("cache prefetch + ship (steps 2 and 3)", () => {
  const flakeDrv = () =>
    flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, TEST_BINARY_CACHE);

  it("prefetches the agent closure from the declared cache before the cold build", async () => {
    mockNix({ copy: okOut("") });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    const calls = vi.mocked(runCapture).mock.calls;
    const copyIdx = calls.findIndex(([, args]) => isCopy(args));
    const buildIdx = calls.findIndex(([, args]) =>
      args.includes("--print-out-paths"),
    );
    expect(copyIdx).toBeGreaterThanOrEqual(0);
    expect(copyIdx).toBeLessThan(buildIdx);
    // The exact wire shape: closure of the LOCAL output path, from the
    // declared substituter, with the declared keys trusted for this copy.
    expect(calls[copyIdx]?.[1]).toEqual([
      "-v",
      "copy",
      "--from",
      TEST_BINARY_CACHE.substituters[0],
      "--extra-trusted-public-keys",
      TEST_BINARY_CACHE.trustedPublicKeys.join(" "),
      STORE,
    ]);
  });

  it("a prefetch miss narrates and the dial still succeeds from source", async () => {
    mockNix(); // copy defaults to failure
    const onProgress = vi.fn();
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress,
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    expect(
      onProgress.mock.calls.some(([line]) =>
        /no declared cache had the agent closure — realising from source instead/.test(
          String(line),
        ),
      ),
    ).toBe(true);
  });

  it("a per-URL miss never claims a fall back to source while another cache is still to be tried", async () => {
    // The give-up verdict is a property of the LOOP, not of one iteration:
    // announcing "realising from source" after cache #1 and then trying cache
    // #2 tells the user something that is simply not happening yet.
    const cache = agentBinaryCache({
      substituters: ["https://a.test.invalid", "https://b.test.invalid"],
      trustedPublicKeys: ["k:0000000000000000000000000000000000000000000="],
    });
    mockNix(); // every --from fails
    const onProgress = vi.fn();
    await provisionAgent({
      host: "build-host",
      derivation: flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, cache),
      onProgress,
      ...provArgs(),
    });
    const lines = onProgress.mock.calls.map(([l]) => String(l));
    const giveUps = lines.filter((l) => /realising from source/.test(l));
    expect(giveUps).toHaveLength(1);
    expect(giveUps[0]).toMatch(/no declared cache had the agent closure/);
    // The per-URL lines stay factual about that one URL.
    expect(
      lines.filter((l) => /no agent closure at https:\/\//.test(l)),
    ).toHaveLength(2);
  });

  it("tries each declared substituter in order until one delivers", async () => {
    const cache = agentBinaryCache({
      substituters: ["https://a.test.invalid", "https://b.test.invalid"],
      trustedPublicKeys: ["k:0000000000000000000000000000000000000000000="],
    });
    vi.mocked(runCapture).mockImplementation(async (_cmd, args) => {
      // The substituter URL is exactly the `--from` value (args[2]) — an exact
      // compare, not a substring scan (which CodeQL would flag as URL
      // sanitization).
      if (isShip(args)) return okOut("");
      if (isCopy(args))
        return args[args.indexOf("--from") + 1] === "https://a.test.invalid"
          ? failOut
          : okOut("");
      if (args.includes("--outputs")) return okOut(`${STORE}\n`);
      if (args.includes("--check-validity")) return failOut;
      if (args.includes("--add-root")) return okOut("/home/u/link\n");
      if (args.includes("--print-out-paths")) return okOut(`${STORE}\n`);
      return failOut;
    });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, cache),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    const froms = vi
      .mocked(runCapture)
      .mock.calls.filter(([, args]) => isPrefetch(args))
      .map(([, args]) => args[args.indexOf("--from") + 1]);
    expect(froms).toEqual(["https://a.test.invalid", "https://b.test.invalid"]);
  });

  it("the drv-path arm prefetches too — downstream binders inherit the path", async () => {
    mockNix({ copy: okOut("") });
    const res = await provisionAgent({
      host: "build-host",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    expect(
      vi.mocked(runCapture).mock.calls.some(([, args]) => isCopy(args)),
    ).toBe(true);
  });

  it("SHIPS the local closure to the remote store — the build alone never would", async () => {
    mockNix({ copy: okOut(""), ship: okOut("") });
    await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    const calls = vi.mocked(runCapture).mock.calls;
    const shipIdx = calls.findIndex(([, args]) => isShip(args));
    expect(shipIdx).toBeGreaterThanOrEqual(0);
    expect(calls[shipIdx]?.[1]).toEqual([
      "-v",
      "copy",
      "--to",
      "ssh-ng://build-host",
      STORE,
    ]);
    // The ship rides the ControlMaster like every other remote-store command.
    expect(calls[shipIdx]?.[2]?.env?.NIX_SSHOPTS).toContain(
      "-o ControlMaster=auto",
    );
  });

  it("ships even when every cache missed — IF the warm binder store already holds the closure", async () => {
    // copy (--from) defaults to failure; the LOCAL validity query says we have it.
    mockNix({ ship: okOut(""), localValidity: okOut("") });
    await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(
      vi.mocked(runCapture).mock.calls.some(([, args]) => isShip(args)),
    ).toBe(true);
  });

  it("skips the ship — and says so honestly — when there is no local copy to ship", async () => {
    // Every cache missed AND the closure is not valid locally. `nix copy --to`
    // would fail for a reason that has nothing to do with trust, so shipping
    // anyway would narrate two remedies ("trust the key there", "add the cache
    // to the host's nix.conf") that fix nothing.
    mockNix({ ship: okOut("") }); // copy + local validity both default to failure
    const onProgress = vi.fn();
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress,
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    expect(
      vi.mocked(runCapture).mock.calls.some(([, args]) => isShip(args)),
    ).toBe(false);
    expect(
      onProgress.mock.calls.some(([line]) =>
        /no local copy of the agent to ship/.test(String(line)),
      ),
    ).toBe(true);
  });

  it("localhost never ships — the prefetch already filled the store the build realises in", async () => {
    mockNix({ copy: okOut(""), ship: okOut("") });
    await provisionAgent({
      host: "localhost",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    const calls = vi.mocked(runCapture).mock.calls;
    expect(calls.some(([, args]) => isPrefetch(args))).toBe(true);
    expect(calls.some(([, args]) => isShip(args))).toBe(false);
  });

  it("a ship refusal narrates the real levers and the dial still succeeds", async () => {
    mockNix({ copy: okOut("") }); // ship defaults to failure
    const onProgress = vi.fn();
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress,
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    expect(
      onProgress.mock.calls.some(([line]) =>
        /could not ship the agent closure.*host will realise it itself/s.test(
          String(line),
        ),
      ),
    ).toBe(true);
  });

  it("speculative-step network noise never reclassifies the required build's failure", async () => {
    // The regression: an unreachable CACHE (or an untrusting host refusing the
    // ship) emits connection stderr; if that fed the cause scanner, a genuine
    // REMOTE rejection of the build below would read as retryable "network"
    // and the session would retry a deterministic fault forever.
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (isCopy(args)) {
        opts.onProgress?.(
          "error: unable to download: Couldn't connect to server",
        );
        return failOut;
      }
      if (args.includes("--outputs")) return okOut(`${STORE}\n`);
      if (args.includes("--check-validity")) return failOut;
      // The required build fails for a genuinely REMOTE reason: a plain
      // non-255 exit with no transport words anywhere in its output.
      if (args.includes("--print-out-paths"))
        return { ok: false, kind: "exit", code: 1, stdout: "" };
      return failOut;
    });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res).toMatchObject({ ok: false, cause: "remote" });
  });

  it("an abort mid-prefetch settles the standard aborted result", async () => {
    mockNix({ copy: { ok: false, kind: "aborted", stdout: "" } });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res).toMatchObject({
      ok: false,
      cause: "network",
      reason: expect.stringMatching(/aborted during the cache prefetch/),
    });
  });

  it("an abort mid-SHIP names the ship — not the prefetch it already finished", async () => {
    mockNix({
      copy: okOut(""), // the prefetch DELIVERED
      ship: { ok: false, kind: "aborted", stdout: "" },
    });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res).toMatchObject({
      ok: false,
      cause: "network",
      reason: expect.stringMatching(/aborted during the closure ship/),
    });
  });

  it("the speculative copies run under their OWN silence bound, never the build's escalated one", async () => {
    // A budget that has already doubled three times (the required build was
    // legitimately slow). The speculative copies charge no expiry, so granting
    // them that 16-minute window would let a dead cache endpoint wedge the dial.
    const budgets = makeProvisionBudgets();
    for (let i = 0; i < 3; i++) budgets.provisioning.recordExpiry();
    // The ship is REFUSED, so the build still runs and its escalated grant is
    // observable alongside the copies' fixed one.
    mockNix({ copy: okOut("") });
    await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(budgets),
    });
    const copyPolicies = vi
      .mocked(runCapture)
      .mock.calls.filter(([, args]) => isCopy(args))
      .map(([, , opts]) => opts.policy);
    expect(copyPolicies).toHaveLength(2); // prefetch + ship
    for (const policy of copyPolicies) {
      expect(policy).toEqual({
        kind: "progress-liveness",
        silenceMs: PROVISION_COPY_SILENCE_MS,
      });
    }
    // …while the required build still gets the escalated grant it earned.
    const buildPolicy = vi
      .mocked(runCapture)
      .mock.calls.find(([, args]) =>
        args.includes("--print-out-paths"),
      )?.[2].policy;
    expect(buildPolicy).toEqual({
      kind: "progress-liveness",
      silenceMs: PROVISION_STEP_SILENCE_BASE_MS * 2 ** 3,
    });
  });

  it("skips the prefetch when the local output query fails — the build owns realisation", async () => {
    mockNix({ outputs: failOut });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    expect(
      vi.mocked(runCapture).mock.calls.some(([, args]) => isCopy(args)),
    ).toBe(false);
  });

  it("rejects a cache-blind declaration where it is CONSTRUCTED — so no arm can carry one", () => {
    // The nominal `AgentBinaryCache` moves this gate off both derivation
    // constructors and onto the one smart constructor: a declaration that
    // could not act never becomes a value, so neither arm needs to re-check.
    expect(() =>
      agentBinaryCache({ substituters: [], trustedPublicKeys: ["k"] }),
    ).toThrow(/cache-blind/);
    expect(() =>
      agentBinaryCache({
        substituters: ["https://c"],
        trustedPublicKeys: [" "],
      }),
    ).toThrow(/cache-blind/);
    // …and an unvalidated literal is a COMPILE error at both arms.
    // @ts-expect-error — only `agentBinaryCache()` produces an AgentBinaryCache.
    directAgentDerivation(DRV, {
      substituters: ["u"],
      trustedPublicKeys: ["k"],
    });
    // @ts-expect-error — same gate on the flake arm.
    flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, {
      substituters: ["u"],
      trustedPublicKeys: ["k"],
    });
  });
});

describe("the speculative copies' liveness and honesty", () => {
  const flakeDrv = () =>
    flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, TEST_BINARY_CACHE);

  it("both copies pass -v — without it a healthy transfer reads as silence", () => {
    // Regression: `runCapture` pipes stderr, so a copy without `-v` reports
    // nothing per path. Under progress-liveness that healthy transfer gets
    // killed and narrated as a MISS, and the host compiles from source — the
    // exact outcome this feature exists to prevent, produced by a timeout.
    mockNix({ copy: okOut(""), ship: okOut("") });
    return provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    }).then(() => {
      const copies = vi
        .mocked(runCapture)
        .mock.calls.filter(([, args]) => isCopy(args));
      expect(copies.length).toBeGreaterThanOrEqual(2);
      for (const [, args] of copies) expect(args).toContain("-v");
    });
  });

  it("an abort during the local validity check settles aborted, not 'nothing to ship'", async () => {
    // The probe's abort must not fold into "absent": narrating "no local copy
    // of the agent to ship" for a dial the user just cancelled is a false
    // statement about the store.
    vi.mocked(runCapture).mockImplementation(async (cmd, args) => {
      if (isCopy(args)) return failOut; // every declared cache misses
      if (args.includes("--outputs")) return okOut(`${STORE}\n`);
      if (args.includes("--check-validity")) {
        // The host's warm check runs through ssh (cmd === "ssh"); the LOCAL
        // probe spawns nix-store directly — that is the one being aborted.
        return cmd === "nix-store"
          ? { ok: false, kind: "aborted", stdout: "" }
          : failOut;
      }
      return failOut;
    });
    const onProgress = vi.fn();
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress,
      ...provArgs(),
    });
    expect(res).toMatchObject({
      ok: false,
      cause: "network",
      reason: expect.stringMatching(/aborted during the local validity check/),
    });
    expect(
      onProgress.mock.calls.some(([line]) =>
        /no local copy of the agent to ship/.test(String(line)),
      ),
    ).toBe(false);
  });

  it("says the check is SKIPPED when the local output path is unknown", async () => {
    mockNix({ outputs: failOut });
    const onProgress = vi.fn();
    await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress,
      ...provArgs(),
    });
    const lines = onProgress.mock.calls.map(([l]) => String(l));
    expect(lines.some((l) => /skipping the cached-agent check/.test(l))).toBe(
      true,
    );
    // The line announcing a check that never runs must not appear.
    expect(lines.some((l) => /checking for a cached agent/.test(l))).toBe(
      false,
    );
  });
});

describe("staging replaces the build when it can (steps 2/3 → 4a)", () => {
  const flakeDrv = () =>
    flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, TEST_BINARY_CACHE);

  it("a delivered ship SKIPS the cold build — the payoff the cache exists for", async () => {
    mockNix({ copy: okOut(""), ship: okOut("") });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    // Success comes from the staged closure, not a remote realisation: the
    // build it skips is a full flake evaluation plus an ssh-ng round trip.
    expect(res).toEqual({ ok: true, agentPath: STORE });
    const calls = vi.mocked(runCapture).mock.calls;
    expect(calls.some(([, args]) => args.includes("--print-out-paths"))).toBe(
      false,
    );
    // The required root commit still runs — staged is not the same as rooted.
    expect(calls.some(([, args]) => args.includes("--add-root"))).toBe(true);
  });

  it("a locally-valid closure skips the cache fetch entirely — cheap question first", async () => {
    vi.mocked(runCapture).mockImplementation(async (cmd, args) => {
      if (isShip(args)) return okOut("");
      if (isCopy(args)) return failOut;
      if (args.includes("--outputs")) return okOut(`${STORE}\n`);
      // Absent on the HOST (asked over ssh), already valid in our own store.
      if (args.includes("--check-validity"))
        return cmd === "nix-store" ? okOut("") : failOut;
      if (args.includes("--add-root")) return okOut("/home/u/link\n");
      return failOut;
    });
    await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    const calls = vi.mocked(runCapture).mock.calls;
    // No network `nix copy --from` spent per declared cache for a closure the
    // binder already holds — a warm binder is the common case.
    expect(calls.some(([, args]) => isPrefetch(args))).toBe(false);
    expect(calls.some(([, args]) => isShip(args))).toBe(true);
  });

  it("a refused ship still builds on the host — staging is optional by outcome", async () => {
    mockNix({ copy: okOut("") }); // ship defaults to refused
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res).toEqual({ ok: true, agentPath: STORE });
    expect(
      vi
        .mocked(runCapture)
        .mock.calls.some(([, args]) => args.includes("--print-out-paths")),
    ).toBe(true);
  });

  it("localhost stages without shipping, and a hit still skips the build", async () => {
    mockNix({ copy: okOut("") });
    const res = await provisionAgent({
      host: "localhost",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    const calls = vi.mocked(runCapture).mock.calls;
    expect(calls.some(([, args]) => isShip(args))).toBe(false);
    // The prefetch filled the very store the build would realise in, so there
    // is nothing left to build.
    expect(calls.some(([, args]) => args.includes("--print-out-paths"))).toBe(
      false,
    );
  });
});
