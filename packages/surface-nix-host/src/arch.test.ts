/**
 * Coverage for the in-memory per-host arch cache in `resolveSystem`: a
 * host's nix-system is probed once per process, concurrent first-probes
 * coalesce onto one ssh, and a FAILED probe is not cached (the next dial
 * re-probes — a transient-unreachable host must not poison the cache).
 * Mocks `./process` so no ssh is ever spawned; each test uses a distinct
 * host so the module-level cache never bleeds across tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSystem } from "./arch";
import { runCapture } from "./process";

vi.mock("./process", () => ({
  runCapture: vi.fn(),
  runProgress: vi.fn(),
}));

beforeEach(() => {
  // The argv builder appends ControlMaster opts (which mkdir a control dir);
  // point it at a throwaway runtime dir so this suite never touches the real
  // one. The mocked runCapture means no ssh runs regardless.
  vi.stubEnv("XDG_RUNTIME_DIR", "/tmp/kolu-ssh-arch-test");
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

const okSystem = (sys: string) => ({ ok: true, code: 0, stdout: `"${sys}"\n` });

describe("resolveSystem arch cache", () => {
  it("probes a host once and memoizes for the process", async () => {
    vi.mocked(runCapture).mockResolvedValue(okSystem("x86_64-linux"));
    const a = await resolveSystem("h-memo");
    const b = await resolveSystem("h-memo");
    expect(a).toBe("x86_64-linux");
    expect(b).toBe("x86_64-linux");
    expect(runCapture).toHaveBeenCalledTimes(1); // one ssh for both dials
    // A distinct host is a distinct cache key → a fresh probe.
    await resolveSystem("h-memo-2");
    expect(runCapture).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent first-probes onto one ssh", async () => {
    vi.mocked(runCapture).mockResolvedValue(okSystem("aarch64-darwin"));
    const [a, b] = await Promise.all([
      resolveSystem("h-race"),
      resolveSystem("h-race"),
    ]);
    expect(a).toBe("aarch64-darwin");
    expect(b).toBe("aarch64-darwin");
    expect(runCapture).toHaveBeenCalledTimes(1); // shared in-flight promise
  });

  it("does not cache a failed probe — the next dial re-probes", async () => {
    vi.mocked(runCapture)
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "" }) // unreachable
      .mockResolvedValueOnce(okSystem("x86_64-linux")); // host answers now
    await expect(resolveSystem("h-reject")).rejects.toThrow();
    const sys = await resolveSystem("h-reject");
    expect(sys).toBe("x86_64-linux");
    expect(runCapture).toHaveBeenCalledTimes(2); // the failure was not cached
  });
});
