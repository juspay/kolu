/**
 * Coverage for the GC-root pinning step (`provisionAgent` step 4) and
 * the `agentGcRootPath` "latest"-link derivation. Keeps off real ssh /
 * nix by mocking `./process`; the real `./host` builds the argv so the
 * assertions see exactly what would hit the wire.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentGcRootPath, provisionAgent } from "./nixCopy";
import { runCapture, runProgress } from "./process";

vi.mock("./process", () => ({
  runCapture: vi.fn(),
  runProgress: vi.fn(),
}));

const STORE = "/nix/store/x8yvl9si8vb93vhwway7kf3zbvv4ahg1-agent";
const DRV = "/nix/store/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-agent.drv";

/** Wire up the cold-provision happy path: the warm fast-path probe misses
 *  (the closure isn't on the host yet), then copy ok, realise prints the
 *  store path, pin prints the link path. Returns the `vi.fn()` handles for
 *  assertions. */
function mockHappyPath() {
  vi.mocked(runProgress).mockResolvedValue({ ok: true, code: 0 });
  vi.mocked(runCapture)
    .mockResolvedValueOnce({ ok: false, code: 1, stdout: "" }) // warm probe: not on host yet
    .mockResolvedValueOnce({ ok: true, code: 0, stdout: `${STORE}\n` }) // realise
    .mockResolvedValueOnce({ ok: true, code: 0, stdout: "/home/u/link\n" }); // pin
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("provisionAgent GC-root pinning", () => {
  it("pins the realised output with an indirect per-agent root", async () => {
    mockHappyPath();
    const res = await provisionAgent({
      host: "testhost",
      drvPath: DRV,
      onProgress: () => {},
    });

    expect(res).toEqual({ ok: true, agentPath: STORE });

    // After the warm-probe miss, the pin is the third runCapture; it
    // re-realises the *store path* (not the .drv) and registers an indirect
    // root.
    expect(runCapture).toHaveBeenCalledTimes(3);
    const pinArgs = vi.mocked(runCapture).mock.calls[2]![1];
    expect(pinArgs).toContain("--realise");
    expect(pinArgs).toContain(STORE);
    expect(pinArgs).toContain("--add-root");
    expect(pinArgs).toContain("--indirect");
    expect(pinArgs).toContain(
      ".local/state/kolu/surface-nix-host/gcroots/agent",
    );
    // …and it must not re-realise the derivation in the pin step.
    expect(pinArgs).not.toContain(DRV);
  });

  it("returns the immutable store path, not the moving root link", async () => {
    mockHappyPath();
    const res = await provisionAgent({
      host: "testhost",
      drvPath: DRV,
      onProgress: () => {},
    });
    expect(res.ok && res.agentPath).toBe(STORE);
  });

  it("treats a pin failure as non-fatal — the agent still provisions", async () => {
    vi.mocked(runProgress).mockResolvedValue({ ok: true, code: 0 });
    vi.mocked(runCapture)
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "" }) // warm probe: not on host
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: `${STORE}\n` }) // realise
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "" }); // pin fails

    const lines: string[] = [];
    const res = await provisionAgent({
      host: "testhost",
      drvPath: DRV,
      onProgress: (l) => lines.push(l),
    });

    expect(res).toEqual({ ok: true, agentPath: STORE });
    expect(lines.some((l) => l.includes("unpinned"))).toBe(true);
  });

  it("does not pin when the realise itself fails", async () => {
    vi.mocked(runProgress).mockResolvedValue({ ok: true, code: 0 });
    vi.mocked(runCapture)
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "" }) // warm probe: not on host
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "" }); // realise fails

    const res = await provisionAgent({
      host: "testhost",
      drvPath: DRV,
      onProgress: () => {},
    });

    expect(res.ok).toBe(false);
    expect(runCapture).toHaveBeenCalledTimes(2); // warm probe + realise, no pin
  });
});

describe("provisionAgent warm fast-path", () => {
  it("skips the nix copy when the closure is already realisable on the host", async () => {
    // Warm host: the fused realise + add-root probe succeeds (the .drv's
    // closure is already on the host), returning the out path — so no copy,
    // no separate realise/pin. This is the redundant work the fast-path removes.
    vi.mocked(runCapture).mockResolvedValueOnce({
      ok: true,
      code: 0,
      stdout: `${STORE}\n`,
    });

    const res = await provisionAgent({
      host: "testhost",
      drvPath: DRV,
      onProgress: () => {},
    });

    expect(res).toEqual({ ok: true, agentPath: STORE });
    // The whole point: a warm host never re-ships the closure.
    expect(runProgress).not.toHaveBeenCalled();
    // One ssh: the fused realise-the-drv + register-the-root probe.
    expect(runCapture).toHaveBeenCalledTimes(1);
    const probeArgs = vi.mocked(runCapture).mock.calls[0]![1];
    expect(probeArgs).toContain("--realise");
    expect(probeArgs).toContain(DRV); // realises the .drv (can rebuild), not the out
    expect(probeArgs).toContain("--add-root");
    expect(probeArgs).toContain("--indirect");
  });
});

// A store-path .drv with a 32-char base32 hash, like nix produces.
const drvOf = (name: string) => `/nix/store/${"a".repeat(32)}-${name}.drv`;

describe("agentGcRootPath", () => {
  it("strips the store hash so versions of one agent share a link", () => {
    const a = agentGcRootPath(false, drvOf("agent")); // hash all a's
    const b = agentGcRootPath(false, `/nix/store/${"b".repeat(32)}-agent.drv`);
    expect(a).toBe(b); // same agent name → one moving "latest" link
    expect(a).toBe(".local/state/kolu/surface-nix-host/gcroots/agent");
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
      "/home/tester/.local/state/kolu/surface-nix-host/gcroots/agent",
    );
  });

  it("returns null for localhost when $HOME is unset (no cwd-relative root)", () => {
    // Better unpinned than rooted in the wrong place — the caller skips
    // the best-effort pin on null rather than rooting under the cwd.
    vi.stubEnv("HOME", undefined);
    expect(agentGcRootPath(true, DRV)).toBeNull();
  });

  it("never returns null for a remote host (resolves against ssh $HOME)", () => {
    vi.stubEnv("HOME", undefined);
    expect(agentGcRootPath(false, DRV)).toBe(
      ".local/state/kolu/surface-nix-host/gcroots/agent",
    );
  });
});
