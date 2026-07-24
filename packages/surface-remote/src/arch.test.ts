/**
 * Coverage for `resolveSystem`'s dial-owned host probe. Every dial asks the
 * target because a hostname can change identity while Kolu remains open, and
 * cancellation must never leak across a recheck.
 * Mocks `./process` so no ssh is ever spawned; each test uses a distinct
 * host so the module-level cache never bleeds across tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSystem } from "./arch";
import { __resetControlMemo } from "./controlMaster";
import { type CaptureResult, runCapture } from "./process";

vi.mock("./process", async (importOriginal) => ({
  // Keep the real pure helpers (`describeExit`) and mock only the two
  // subprocess-spawning entry points.
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
  runProgress: vi.fn(),
}));

const tmpDirs: string[] = [];
beforeEach(() => {
  // The argv builder appends ControlMaster opts (which mkdir a control dir);
  // point it at a throwaway private runtime dir per test so the suite never
  // touches the real one and leaves no residue. The mocked runCapture means
  // no ssh runs regardless.
  const xdg = mkdtempSync(join(tmpdir(), "kolu-ssh-arch-test-"));
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

const okSystem = (sys: string) =>
  ({ ok: true, kind: "exit", code: 0, stdout: `"${sys}"\n` }) as const;
const opts = () => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

describe("resolveSystem host probe", () => {
  it("re-probes a host on every dial", async () => {
    vi.mocked(runCapture).mockResolvedValue(okSystem("x86_64-linux"));
    const a = await resolveSystem("h-memo", opts());
    const b = await resolveSystem("h-memo", opts());
    expect(a).toBe("x86_64-linux");
    expect(b).toBe("x86_64-linux");
    expect(runCapture).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent first probes in their owning dial lifetimes", async () => {
    vi.mocked(runCapture).mockResolvedValue(okSystem("aarch64-darwin"));
    const [a, b] = await Promise.all([
      resolveSystem("h-race", opts()),
      resolveSystem("h-race", opts()),
    ]);
    expect(a).toBe("aarch64-darwin");
    expect(b).toBe("aarch64-darwin");
    expect(runCapture).toHaveBeenCalledTimes(2);
  });

  it("re-probes after a failed dial", async () => {
    vi.mocked(runCapture)
      .mockResolvedValueOnce({ ok: false, kind: "exit", code: 1, stdout: "" }) // unreachable
      .mockResolvedValueOnce(okSystem("x86_64-linux")); // host answers now
    await expect(resolveSystem("h-reject", opts())).rejects.toThrow();
    const sys = await resolveSystem("h-reject", opts());
    expect(sys).toBe("x86_64-linux");
    expect(runCapture).toHaveBeenCalledTimes(2); // the failure was not cached
  });

  it("keeps an unresolved probe owned by its dial's abort signal", async () => {
    const first = new AbortController();
    vi.mocked(runCapture)
      .mockImplementationOnce(
        async (_command, _args, runOpts): Promise<CaptureResult> =>
          await new Promise<CaptureResult>((resolve) => {
            runOpts.signal?.addEventListener(
              "abort",
              () => resolve({ ok: false, kind: "aborted", stdout: "" }),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(okSystem("aarch64-darwin"));

    const abandoned = resolveSystem("h-abort-owner", {
      signal: first.signal,
      onProgress: vi.fn(),
    });
    first.abort();
    await expect(abandoned).rejects.toThrow(/aborted/);

    await expect(resolveSystem("h-abort-owner", opts())).resolves.toBe(
      "aarch64-darwin",
    );
    expect(runCapture).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runCapture).mock.calls[0]?.[2]?.signal).toBe(first.signal);
  });
});
