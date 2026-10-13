/**
 * Coverage for `provisionAgent`'s cold path: GC-root commit (step 3), the
 * ControlMaster/keepalive env on provisioning, cause classification, and the #1908
 * lifetime-policy handling (a `lifetime-expired`/`aborted` step is retryable and
 * budget-aware). Keeps off real ssh / nix by mocking `./process`; the real `./host`
 * builds the argv so the assertions see exactly what would hit the wire. The
 * ask-only warm-check SHAPE (D1a) is pinned in `warmProbeCheck.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CI_KEEPALIVE, provArgs, useControlDir } from "./controlDir.testutil";
import { agentBinaryCache } from "./agentBinaryCache";
import { directAgentDerivation, flakeAgentDerivation } from "./agentDerivation";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  agentGcRootPath,
  deliverClosure,
  makeProvisionBudgets,
  makeStepBudget,
  PROVISION_COPY_SILENCE_MS,
  PROVISION_STEP_SILENCE_BASE_MS,
  type ProvisionBudgets,
  provisionAgent,
} from "./nixCopy";
import { type CaptureResult, runCapture } from "./process";
import { sshKeepalive } from "./keepalive";
import {
  derivationShowAnswer,
  TEST_BINARY_CACHE,
} from "./agentDerivation.testutil";
import { nixErrorLine, nixJsonLine } from "./nixLog.testutil";

vi.mock("./process", async (importOriginal) => ({
  // Keep the real pure helpers (`describeExit`) and mock only the two
  // subprocess-spawning entry points.
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
}));

const STORE = "/nix/store/x8yvl9si8vb93vhwway7kf3zbvv4ahg1-agent";
/** `STORE`'s content-addressed form, as `make-content-addressed` names it. */
const CA_STORE = "/nix/store/c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4-agent";
const LINUX = "x86_64-linux";
const DARWIN = "aarch64-darwin";
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
const isRewrite = (args: readonly string[]): boolean =>
  args.includes("make-content-addressed");
const isDrvShow = (args: readonly string[]): boolean =>
  derivationShowAnswer(args) !== undefined;

/** `nix derivation show`'s answer for a `.drv` built for `system`. */
const drvShow = (system: string): CaptureResult =>
  derivationShowAnswer(["derivation", "show"], system) as CaptureResult;

/** `make-content-addressed --json`'s answer: `STORE` rewritten to `CA_STORE`. */
const rewriteOut = okOut(JSON.stringify({ rewrites: { [STORE]: CA_STORE } }));

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
  /** The target's system, as the `.drv` names it — Linux unless a darwin
   *  route is the subject. */
  system?: string;
  rewrite?: CaptureResult;
}): void {
  vi.mocked(runCapture).mockImplementation(async (cmd, args) => {
    if (isDrvShow(args)) return drvShow(over?.system ?? LINUX);
    // The content-addressed rewrite (a Linux target's step 2) — default MISS,
    // like the prefetch below.
    if (isRewrite(args)) return over?.rewrite ?? failOut;
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
    if (cmd === "nix-store" && args.includes("--check-validity"))
      return over?.localValidity ?? failOut;
    if (args.includes("--check-validity"))
      return over?.checkValidity ?? failOut; // cold: not on host yet
    if (args.includes("--add-root")) {
      simulateLocalRoot(cmd, args);
      return over?.pin ?? okOut("/home/u/link\n");
    }
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
/** A fresh `$HOME` per test: the sender roots each content-addressed rewrite
 *  under it, and that root is the record a later delivery reads back. */
let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kolu-nixcopy-home-"));
  vi.stubEnv("HOME", home);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

/** The sender's root for `STORE`'s content-addressed form. */
const caRoot = () =>
  join(
    home,
    ".local/state/kolu/surface-remote/content-addressed/agent",
    STORE.slice("/nix/store/".length, "/nix/store/".length + 32),
  );

/** What a LOCAL `nix-store --realise <p> --add-root <abs link> --indirect`
 *  leaves behind: the link, pointing at the path. */
function simulateLocalRoot(cmd: string, args: readonly string[]): void {
  const link = args[args.indexOf("--add-root") + 1];
  const target = args[args.indexOf("--realise") + 1];
  if (cmd !== "nix-store" || link === undefined || !link.startsWith("/"))
    return;
  if (target === undefined) return;
  mkdirSync(dirname(link), { recursive: true });
  rmSync(link, { force: true });
  symlinkSync(target, link);
}

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
    // (`nix derivation show` reads the local `.drv` and reaches nothing.)
    const nixCalls = calls.filter(
      ([command, args]) => command === "nix" && !isDrvShow(args),
    );
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
    // Nix's tagged log is what the failure report and the transport verdict
    // are read from (`nixLog.ts`) — never raw `-v` text.
    expect(buildArgs?.slice(0, 2)).toEqual(["--log-format", "internal-json"]);
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
  it("classifies the build's ssh-ng connection failure as network", async () => {
    // What real nix does when its ssh to the remote store fails: ssh's own raw
    // stderr, Nix's own error, and exit 1 — never 255 (that is OUR ssh's code).
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (args.includes("--outputs")) return okOut(`${STORE}\n`);
      if (args.includes("--print-out-paths")) {
        opts?.onProgress?.(
          "ssh: connect to host testhost port 22: Connection timed out",
        );
        opts?.onProgress?.(
          nixJsonLine({
            action: "msg",
            level: 0,
            msg: "error: failed to start SSH connection to 'testhost'",
            raw_msg: "failed to start SSH connection to 'testhost'",
          }),
        );
        return failOut;
      }
      return failOut;
    });
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

describe("cache prefetch + ship (steps 2 and 3) — a darwin target, signed and input-addressed", () => {
  const flakeDrv = () =>
    flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, TEST_BINARY_CACHE);

  it("prefetches the agent closure from the declared cache before the cold build", async () => {
    mockNix({ system: DARWIN, copy: okOut("") });
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
      "--log-format",
      "internal-json",
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
    mockNix({ system: DARWIN }); // copy defaults to failure
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
        /no declared cache delivered the agent closure/.test(String(line)),
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
    mockNix({ system: DARWIN }); // every --from fails
    const onProgress = vi.fn();
    await provisionAgent({
      host: "build-host",
      derivation: flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, cache),
      onProgress,
      ...provArgs(),
    });
    const lines = onProgress.mock.calls.map(([l]) => String(l));
    const giveUps = lines.filter((l) =>
      /no declared cache delivered the agent closure/.test(l),
    );
    expect(giveUps).toHaveLength(1);
    // The per-URL lines stay factual about that one URL.
    expect(
      lines.filter((l) =>
        /could not fetch the agent closure from https:\/\//.test(l),
      ),
    ).toHaveLength(2);
  });

  it("tries each declared substituter in order until one delivers", async () => {
    const cache = agentBinaryCache({
      substituters: ["https://a.test.invalid", "https://b.test.invalid"],
      trustedPublicKeys: ["k:0000000000000000000000000000000000000000000="],
    });
    vi.mocked(runCapture).mockImplementation(async (_cmd, args) => {
      if (isDrvShow(args)) return drvShow(DARWIN);
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
    mockNix({ system: DARWIN, copy: okOut("") });
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
    mockNix({ system: DARWIN, copy: okOut(""), ship: okOut("") });
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
      "--log-format",
      "internal-json",
      "-v",
      "copy",
      "--no-check-sigs",
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
    mockNix({ system: DARWIN, ship: okOut(""), localValidity: okOut("") });
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
    mockNix({ system: DARWIN, ship: okOut("") }); // copy + local validity both default to failure
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
    mockNix({ system: DARWIN, copy: okOut(""), ship: okOut("") });
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

  it("a ship refusal narrates what failed and the dial still succeeds", async () => {
    mockNix({ system: DARWIN, copy: okOut("") }); // ship defaults to failure
    const onProgress = vi.fn();
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress,
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    const lines = onProgress.mock.calls.map(([line]) => String(line));
    expect(
      lines.some((l) => /could not ship the agent closure: /.test(l)),
    ).toBe(true);
    expect(
      lines.some((l) =>
        /the host will realise the agent with its own substituters/.test(l),
      ),
    ).toBe(true);
  });

  it("speculative-step network noise never reclassifies the required build's failure", async () => {
    // The regression: an unreachable CACHE (or an untrusting host refusing the
    // ship) emits connection stderr; if that fed the cause scanner, a genuine
    // REMOTE rejection of the build below would read as retryable "network"
    // and the session would retry a deterministic fault forever.
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (isDrvShow(args)) return drvShow(DARWIN);
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
    mockNix({
      system: DARWIN,
      copy: { ok: false, kind: "aborted", stdout: "" },
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
      reason: expect.stringMatching(/aborted during the cache prefetch/),
    });
  });

  it("an abort mid-SHIP names the ship — not the prefetch it already finished", async () => {
    mockNix({
      system: DARWIN,
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
    mockNix({ system: DARWIN, copy: okOut("") });
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

  it("names why the local output query failed, in Nix's own words", async () => {
    // The query runs through `runNix` like every other Nix step, so a GC'd or
    // unreadable `.drv` is on record rather than thrown away.
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (isDrvShow(args)) return drvShow(DARWIN);
      if (args.includes("--outputs")) {
        opts.onProgress?.(
          nixJsonLine({
            action: "msg",
            level: 0,
            msg: "error: path '/nix/store/zzz-agent.drv' is not valid",
            raw_msg: "path '/nix/store/zzz-agent.drv' is not valid",
          }),
        );
        return failOut;
      }
      if (args.includes("--print-out-paths")) return okOut(`${STORE}\n`);
      if (args.includes("--add-root")) return okOut("/home/u/link\n");
      return failOut;
    });
    const onProgress = vi.fn();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress,
      ...provArgs(),
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.stringMatching(
        /agent output path unknown locally \(path '\/nix\/store\/zzz-agent\.drv' is not valid\)/,
      ),
    );
  });

  it("skips the prefetch when the local output query fails — the build owns realisation", async () => {
    mockNix({ system: DARWIN, outputs: failOut });
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

describe("the speculative copies' liveness and honesty — a darwin target, signed and input-addressed", () => {
  const flakeDrv = () =>
    flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, TEST_BINARY_CACHE);

  it("both copies pass -v — without it a healthy transfer reads as silence", () => {
    // Regression: `runCapture` pipes stderr, so a copy without `-v` reports
    // nothing per path. Under progress-liveness that healthy transfer gets
    // killed and narrated as a MISS, and the host compiles from source — the
    // exact outcome this feature exists to prevent, produced by a timeout.
    mockNix({ system: DARWIN, copy: okOut(""), ship: okOut("") });
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
      if (isDrvShow(args)) return drvShow(DARWIN);
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
    mockNix({ system: DARWIN, outputs: failOut });
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

describe("staging replaces the build when it can (steps 2/3 → 4a) — a darwin target, signed and input-addressed", () => {
  const flakeDrv = () =>
    flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, TEST_BINARY_CACHE);

  it("a delivered ship SKIPS the cold build — the payoff the cache exists for", async () => {
    mockNix({ system: DARWIN, copy: okOut(""), ship: okOut("") });
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
      if (isDrvShow(args)) return drvShow(DARWIN);
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
    mockNix({ system: DARWIN, copy: okOut("") }); // ship defaults to refused
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
    mockNix({ system: DARWIN, copy: okOut("") });
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

/** An ANSI SGR sequence, the way Nix colours its messages even into a pipe. */
const sgr = (code: string): string => `\u001b[${code}m`;

describe("honest failure reporting (the sheetal-codex incident)", () => {
  const flakeDrv = () =>
    flakeAgentDerivation(DRV, FLAKE_INSTALLABLE, TEST_BINARY_CACHE);
  const CRATE_DRV =
    "/nix/store/d44gl7h40dgahrrg3w8n3rg9d6bp1kxf-crate-humantime-2.4.0.tar.gz.drv";
  const KOLU_DRV = "/nix/store/rz6j476k358bj3madirm98i34bb7ykl7-kolu-2.2.0.drv";

  /** A remote build that failed the way it did on the incident host: the crate
   *  fetch's own curl output (a builder LOG), then Nix's root error, then a
   *  dependent's cascade. */
  const failedCrateBuild = (line: (l: string) => void): void => {
    line(
      nixJsonLine({
        action: "start",
        id: 7,
        level: 3,
        parent: 0,
        type: 105,
        text: `building '${CRATE_DRV}'`,
        fields: [CRATE_DRV, "", 1, 1],
      }),
    );
    line(
      nixJsonLine({
        action: "result",
        id: 7,
        type: 101,
        fields: [
          "curl: (7) Failed to connect to crates.io port 443 after 2 ms: Couldn't connect to server",
        ],
      }),
    );
    line(
      nixJsonLine({
        action: "result",
        id: 7,
        type: 101,
        fields: [
          "error: cannot download crate-humantime-2.4.0.tar.gz from any mirror",
        ],
      }),
    );
    line(
      nixJsonLine({
        action: "msg",
        level: 0,
        msg: `${sgr("31;1")}error:${sgr("0")} Cannot build '${sgr("35;1")}${CRATE_DRV}${sgr("0")}'.\n       Reason: ${sgr("31;1")}builder failed with exit code 1${sgr("0")}.`,
      }),
    );
    line(
      nixJsonLine({
        action: "msg",
        level: 0,
        msg: `${sgr("31;1")}error:${sgr("0")} Cannot build '${KOLU_DRV}'.\n       Reason: 1 dependency failed.`,
        raw_msg: `Cannot build '${KOLU_DRV}'.\nReason: 1 dependency failed.`,
      }),
    );
  };

  /** Route a cold build that fails like the incident's. */
  const mockFailedBuild = (): void => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (args.includes("--outputs")) return okOut(`${STORE}\n`);
      if (args.includes("--print-out-paths")) {
        failedCrateBuild((l) => opts?.onProgress?.(l));
        return failOut;
      }
      return failOut;
    });
  };

  it("every stderr line of a long step reaches onActivity — even the ones never narrated", async () => {
    // The session's pre-connected backstop listens to narration AND activity; the
    // child's own silence policy listens to raw bytes. Filtered build-log lines and
    // transfer progress must feed the backstop, or a healthy long build is cycled.
    const filtered = [
      nixJsonLine({ action: "result", id: 7, type: 105, fields: [1, 2, 0, 0] }),
      nixJsonLine({
        action: "result",
        id: 7,
        type: 101,
        fields: ["compiling…"],
      }),
      nixJsonLine({ action: "msg", level: 4, msg: "evaluating file 'x'" }),
    ];
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (args.includes("--outputs")) return okOut(`${STORE}\n`);
      if (args.includes("--print-out-paths")) {
        for (const l of filtered) opts?.onProgress?.(l);
        return okOut(`${STORE}\n`);
      }
      if (args.includes("--add-root")) return okOut("/home/u/link\n");
      return failOut;
    });
    const onProgress = vi.fn();
    const onActivity = vi.fn();
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress,
      ...provArgs(),
      onActivity,
    });
    expect(res.ok).toBe(true);
    expect(onActivity.mock.calls.length).toBeGreaterThanOrEqual(
      filtered.length,
    );
    for (const l of ["compiling…", "evaluating file 'x'"]) {
      expect(onProgress).not.toHaveBeenCalledWith(l);
    }
  });

  it("ships a darwin target's signed closure with --no-check-sigs, so a host that trusts the ssh user accepts it", async () => {
    mockNix({ system: DARWIN, localValidity: okOut(""), ship: okOut("") });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res.ok).toBe(true);
    const ship = vi
      .mocked(runCapture)
      .mock.calls.find(([, args]) => isShip(args));
    expect(ship?.[1]).toContain("--no-check-sigs");
  });

  it("a failed build reports Nix's root error, never an exit code", async () => {
    mockFailedBuild();
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    const reason = res.ok ? "" : res.reason;
    expect(reason).not.toMatch(/exited with code/);
    expect(reason).toContain(`Cannot build '${CRATE_DRV}'`);
    expect(reason).toContain(
      "cannot download crate-humantime-2.4.0.tar.gz from any mirror",
    );
    // The dependent's cascade is fallout, never the headline.
    expect(reason).not.toContain(KOLU_DRV);
  });

  it("a builder's own curl output never makes the host 'unreachable'", async () => {
    mockFailedBuild();
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res.ok === false && res.cause).toBe("remote");
  });

  it("the root error is the last thing narrated, so the failure card's tail keeps it", async () => {
    mockFailedBuild();
    const onProgress = vi.fn();
    await provisionAgent({
      host: "build-host",
      derivation: flakeDrv(),
      onProgress,
      ...provArgs(),
    });
    const lines = onProgress.mock.calls.map(([l]) => String(l));
    expect(lines.at(-1)).toContain(
      "cannot download crate-humantime-2.4.0.tar.gz from any mirror",
    );
    // Nix's colour codes never reach the screen.
    expect(lines.some((l) => l.includes("\u001b"))).toBe(false);
  });
});

describe("deliverClosure — the route without a build", () => {
  const deliver = (host: string, system = LINUX, onProgress = vi.fn()) =>
    deliverClosure({
      host,
      system: async () => system,
      outPath: STORE,
      binaryCache: TEST_BINARY_CACHE,
      rootPath: ".local/state/kolu/agent-distro/gcroots/vanilla",
      onProgress,
      onActivity: () => {},
      budget: makeStepBudget(PROVISION_STEP_SILENCE_BASE_MS, 2),
      keepalive: sshKeepalive(10, 3),
    });
  const isBuild = (args: readonly string[]) =>
    args.includes("--print-out-paths");
  const argvs = () => vi.mocked(runCapture).mock.calls.map((c) => c[1]);
  const pinned = () => argvs().find((a) => a.includes("--add-root"));
  const refusal = `cannot add path '${STORE}' because it lacks a signature by a trusted key`;

  it("a host that already holds the path is rooted and never copied to", async () => {
    mockNix({ checkValidity: okOut("") });
    const res = await deliver("croissant");
    expect(res).toEqual({ ok: true, outPath: STORE });
    expect(argvs().some(isCopy)).toBe(false);
    expect(argvs().some(isRewrite)).toBe(false);
    expect(pinned()).toContain(
      ".local/state/kolu/agent-distro/gcroots/vanilla",
    );
  });

  it("a Linux host gets the content-addressed closure: rewritten from the cache, shipped without a signature, rooted — never built", async () => {
    mockNix({ rewrite: rewriteOut, ship: okOut("") });
    const res = await deliver("ci@croissant");
    expect(res).toEqual({ ok: true, outPath: CA_STORE });
    // Not in this store, so the rewrite reads the declared cache directly.
    const rewrite = argvs().find(isRewrite);
    expect(rewrite).toEqual([
      "--log-format",
      "internal-json",
      "-v",
      "store",
      "make-content-addressed",
      "--json",
      "--from",
      TEST_BINARY_CACHE.substituters[0],
      STORE,
    ]);
    // The ship is the CA path, asking nothing of the host's trust settings.
    const ship = argvs().find(isShip);
    expect(ship).toContain(CA_STORE);
    expect(ship).not.toContain("--no-check-sigs");
    expect(argvs().some(isPrefetch)).toBe(false);
    expect(pinned()).toContain(CA_STORE);
    expect(argvs().some(isBuild)).toBe(false);
  });

  it("a closure this store already holds is rewritten from the local store, not the cache", async () => {
    mockNix({
      rewrite: rewriteOut,
      ship: okOut(""),
      localValidity: okOut(""),
    });
    await deliver("ci@croissant");
    const rewrite = argvs().find(isRewrite);
    expect(rewrite).not.toContain("--from");
  });

  it("the rewrite is rooted in the sender's store, keyed by the output, and older outputs of the name are let go", async () => {
    const older = join(dirname(caRoot()), "0".repeat(32));
    mkdirSync(dirname(older), { recursive: true });
    symlinkSync("/nix/store/old-agent", older);
    mockNix({ rewrite: rewriteOut, ship: okOut("") });
    await deliver("ci@croissant");
    // `nix-store --realise CA --add-root <link> --indirect`, on this machine.
    const senderRoot = vi
      .mocked(runCapture)
      .mock.calls.find(
        ([cmd, args]) => cmd === "nix-store" && args.includes(caRoot()),
      );
    expect(senderRoot?.[1]).toEqual(
      expect.arrayContaining(["--realise", CA_STORE, "--indirect"]),
    );
    expect(readlinkSync(caRoot())).toBe(CA_STORE);
    expect(existsSync(older)).toBe(false);
  });

  it("the rooted rewrite is the record: after a restart the host is asked about the content-addressed path, and nothing is rewritten", async () => {
    mkdirSync(dirname(caRoot()), { recursive: true });
    symlinkSync(CA_STORE, caRoot());
    vi.mocked(runCapture).mockImplementation(async (cmd, args) => {
      // This store still holds it (rooted); the host does too.
      if (args.includes("--check-validity"))
        return args.includes(CA_STORE) ? okOut("") : failOut;
      if (args.includes("--add-root")) return okOut("");
      throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
    });
    const system = vi.fn(async () => LINUX);
    const res = await deliverClosure({
      host: "other-host",
      system,
      outPath: STORE,
      binaryCache: TEST_BINARY_CACHE,
      rootPath: ".local/state/kolu/agent-distro/gcroots/vanilla",
      onProgress: vi.fn(),
      onActivity: () => {},
      budget: makeStepBudget(PROVISION_STEP_SILENCE_BASE_MS, 2),
      keepalive: sshKeepalive(10, 3),
    });
    expect(res).toEqual({ ok: true, outPath: CA_STORE });
    // The FIRST question the host gets is about the content-addressed path.
    const hostChecks = vi
      .mocked(runCapture)
      .mock.calls.filter(
        ([cmd, args]) => cmd === "ssh" && args.includes("--check-validity"),
      );
    expect(hostChecks[0]?.[1]).toContain(CA_STORE);
    expect(argvs().some(isRewrite)).toBe(false);
    expect(argvs().some(isShip)).toBe(false);
    // A warm hit never asks what system the host is.
    expect(system).not.toHaveBeenCalled();
  });

  it("the store's hard-link noise never reaches the narration, nor stands in for the rewrite's cause", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (isRewrite(args)) {
        for (let i = 0; i < 50; i++)
          opts.onProgress?.(
            nixErrorLine(
              `linking '/nix/store/${i}-x/lib/a.so' to '/nix/store/.links/${i}abc': File exists`,
            ),
          );
        opts.onProgress?.(nixErrorLine("unable to download 'https://cache'"));
        return failOut;
      }
      return failOut;
    });
    const onProgress = vi.fn();
    const res = await deliver("ci@croissant", LINUX, onProgress);
    expect(res).toMatchObject({
      kind: "not-delivered",
      why: "uncached",
      reason: expect.stringContaining("unable to download"),
    });
    expect(res.ok === false && "reason" in res && res.reason).not.toMatch(
      /\.links/,
    );
    expect(
      onProgress.mock.calls.some(([l]) => String(l).includes("/.links/")),
    ).toBe(false);
  });

  it("on the local arm the rewrite itself lands the closure: rooted, never shipped", async () => {
    mockNix({ rewrite: rewriteOut });
    const res = await deliver("localhost");
    expect(res).toEqual({ ok: true, outPath: CA_STORE });
    expect(argvs().some(isShip)).toBe(false);
    expect(pinned()).toContain(CA_STORE);
  });

  it("a closure no declared cache holds is `uncached`, and nothing is shipped or built", async () => {
    mockNix(); // the rewrite misses, nothing held locally
    const res = await deliver("croissant");
    expect(res).toMatchObject({
      ok: false,
      kind: "not-delivered",
      why: "uncached",
    });
    expect(argvs().some(isShip)).toBe(false);
    expect(argvs().some(isBuild)).toBe(false);
  });

  it("a darwin host gets the signed closure: copied from the cache, shipped, and rooted as is", async () => {
    mockNix({ copy: okOut(""), ship: okOut("") });
    const res = await deliver("mac", DARWIN);
    expect(res).toEqual({ ok: true, outPath: STORE });
    expect(argvs().some(isPrefetch)).toBe(true);
    expect(argvs().find(isShip)).toContain("--no-check-sigs");
    expect(argvs().some(isRewrite)).toBe(false);
    expect(argvs().some(isBuild)).toBe(false);
  });

  it("a darwin host whose Nix trusts neither the login nor the key is `refused`, and nothing is built or rooted", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (isShip(args)) {
        opts.onProgress?.(nixErrorLine(refusal));
        return failOut;
      }
      if (isCopy(args)) return okOut("");
      if (args.includes("--check-validity")) return failOut;
      return okOut("");
    });
    const res = await deliver("mac", DARWIN);
    expect(res).toMatchObject({
      ok: false,
      kind: "not-delivered",
      why: "refused",
      reason: expect.stringMatching(/lacks a signature by a trusted key/),
    });
    expect(argvs().some(isBuild)).toBe(false);
    expect(argvs().some((a) => a.includes("--add-root"))).toBe(false);
  });

  it("the sender's OWN refusal of the cache is `sender-refused` — never blamed on the host, nor on the cache", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (isPrefetch(args)) {
        opts.onProgress?.(nixErrorLine(refusal));
        return failOut;
      }
      if (args.includes("--check-validity")) return failOut;
      return okOut("");
    });
    expect(await deliver("mac", DARWIN)).toMatchObject({
      ok: false,
      kind: "not-delivered",
      why: "sender-refused",
      reason: expect.stringMatching(/lacks a signature/),
    });
    expect(argvs().some(isShip)).toBe(false);
    // On the local arm the sender's store IS the target: its refusal is the
    // target's.
    expect(await deliver("localhost", DARWIN)).toMatchObject({
      ok: false,
      kind: "not-delivered",
      why: "refused",
    });
  });
});

describe("provisionAgent on a Linux target — the content-addressed route", () => {
  it("runs the agent from the content-addressed path delivery rooted, with no build", async () => {
    mockNix({ rewrite: rewriteOut, ship: okOut("") });
    const res = await provisionAgent({
      host: "build-host",
      derivation: flakeAgentDerivation(
        DRV,
        FLAKE_INSTALLABLE,
        TEST_BINARY_CACHE,
      ),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res).toEqual({ ok: true, agentPath: CA_STORE });
    const calls = vi.mocked(runCapture).mock.calls.map((c) => c[1]);
    expect(calls.some((a) => a.includes("--print-out-paths"))).toBe(false);
  });

  it("a closure the host already holds input-addressed is used as is — a step-4 build stays warm", async () => {
    mockNix({ checkValidity: okOut("") });
    const res = await provisionAgent({
      host: "build-host",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: vi.fn(),
      ...provArgs(),
    });
    expect(res).toEqual({ ok: true, agentPath: STORE });
    const calls = vi.mocked(runCapture).mock.calls.map((c) => c[1]);
    expect(calls.some(isRewrite)).toBe(false);
    // A warm host is a root refresh: the `.drv`'s system is never read.
    expect(calls.some(isDrvShow)).toBe(false);
  });
});
