/**
 * D1a pins (#1908) — the warm probe ASKS, never DOES.
 *
 * The old warm fast-path ran ONE fused `ssh $host nix-store --realise $drv
 * --add-root $link --indirect` narrated as `checking for a cached agent…`. On an
 * absent-but-SUBSTITUTABLE closure that `--realise` performed the substitution
 * (network fetch) INSIDE the "check" — the field wedge (~10 min).
 *
 * The fix (verified against real nix 2.34.7): compute the derivation's output
 * path(s) LOCALLY on the sender (`nix-store -q --outputs`, no network), then ask the
 * host, BOUNDED, whether they are already valid there (`nix-store --check-validity`)
 * — a pure store query that NEVER substitutes and NEVER mutates the store. These are
 * the flipped RED bodies (R9: body rewrites), now asserting the ask-only shape.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { provArgs, useControlDir } from "./controlDir.testutil";
import { directAgentDerivation } from "./agentDerivation";
import { provisionAgent } from "./nixCopy";
import { type CaptureResult, runCapture } from "./process";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";

vi.mock("./process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
}));

const STORE = "/nix/store/x8yvl9si8vb93vhwway7kf3zbvv4ahg1-agent";
const STORE2 = "/nix/store/y8yvl9si8vb93vhwway7kf3zbvv4ahg1-agent-dev";
const DRV = "/nix/store/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-agent.drv";

const okOut = (stdout: string): CaptureResult => ({
  ok: true,
  kind: "exit",
  code: 0,
  stdout,
});
const failOut: CaptureResult = { ok: false, kind: "exit", code: 1, stdout: "" };

/** A warm host: outputs computed locally, present on the host, pin ok. */
function mockWarmHit(outputsStdout = `${STORE}\n`): void {
  vi.mocked(runCapture).mockImplementation(async (_cmd, args) => {
    if (args.includes("--outputs")) return okOut(outputsStdout);
    if (args.includes("--check-validity")) return okOut("");
    if (args.includes("--add-root")) return okOut("/home/u/link\n");
    return failOut;
  });
}

/** The argv + opts of the check-validity call (the ssh presence query), if made. */
function checkValidityCall() {
  return vi
    .mocked(runCapture)
    .mock.calls.find((c) => c[1].includes("--check-validity"));
}

useControlDir("kolu-ssh-warmprobe-");
afterEach(() => {
  vi.clearAllMocks();
});

describe("D1a — the warm probe asks, never substitutes (#1908)", () => {
  it("checks presence with --check-validity, never a substituting realise of the drv", async () => {
    mockWarmHit();
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res).toEqual({ ok: true, agentPath: STORE });

    const check = checkValidityCall();
    expect(check, "a --check-validity presence query must run").toBeDefined();
    const args = check![1];
    // Queries the OUTPUT path, never realises the DERIVATION (a bare `--realise
    // <drv>` substitutes), never registers a GC root.
    expect(args).toContain(STORE);
    const realisesDrv = args.includes("--realise") && args.includes(DRV);
    expect(realisesDrv, "the check must not realise the derivation").toBe(
      false,
    );
    expect(args, "a check must not register a GC root").not.toContain(
      "--add-root",
    );
  });

  it("bounds the warm check with a hard deadline policy (R5e)", async () => {
    mockWarmHit();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(checkValidityCall()![2].policy.kind).toBe("deadline");
  });

  it("a warm HIT short-circuits — no remote-store build is issued", async () => {
    mockWarmHit();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(
      vi
        .mocked(runCapture)
        .mock.calls.some((call) => call[1].includes("--print-out-paths")),
    ).toBe(false);
  });

  it("enters provisioning before the mandatory warm root commit", async () => {
    mockWarmHit();
    const onProvisioning = vi.fn();
    await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      onProvisioning,
      ...provArgs(),
    });
    expect(onProvisioning).toHaveBeenCalledTimes(1);
    const rootIndex = vi
      .mocked(runCapture)
      .mock.calls.findIndex((call) => call[1].includes("--add-root"));
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    const phaseOrder = onProvisioning.mock.invocationCallOrder[0];
    const rootOrder = vi.mocked(runCapture).mock.invocationCallOrder[rootIndex];
    expect(phaseOrder).toBeDefined();
    expect(rootOrder).toBeDefined();
    if (phaseOrder !== undefined && rootOrder !== undefined) {
      expect(phaseOrder).toBeLessThan(rootOrder);
    }
  });

  it("a MULTI-output agent derivation fails loud — no silent wrong-output pick (F7)", async () => {
    // The agent is at `<out>/bin/<binary>`; `-q --outputs` neither names nor orders its
    // lines, so a multi-output drv is ambiguous. Rather than pick the first (which may be
    // `debug`/`dev`), it fails loud (a terminal `remote` config error) and never checks.
    mockWarmHit(`${STORE}\n${STORE2}\n`);
    const res = await provisionAgent({
      host: "testhost",
      derivation: directAgentDerivation(DRV, TEST_BINARY_CACHE),
      onProgress: () => {},
      ...provArgs(),
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.cause).toBe("remote");
    expect(res.ok === false && res.reason).toMatch(/multi-output/i);
    // No presence check was even issued for the ambiguous drv.
    expect(checkValidityCall()).toBeUndefined();
  });
});
