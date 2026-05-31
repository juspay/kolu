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

/** Wire up the happy path: copy ok, realise prints the store path, pin
 *  prints the link path. Returns the `vi.fn()` handles for assertions. */
function mockHappyPath() {
  vi.mocked(runProgress).mockResolvedValue({ ok: true, code: 0 });
  vi.mocked(runCapture)
    .mockResolvedValueOnce({ ok: true, code: 0, stdout: `${STORE}\n` }) // realise
    .mockResolvedValueOnce({ ok: true, code: 0, stdout: "/home/u/link\n" }); // pin
}

afterEach(() => vi.clearAllMocks());

describe("provisionAgent GC-root pinning", () => {
  it("pins the realised output with an indirect per-agent root", async () => {
    mockHappyPath();
    const res = await provisionAgent({
      host: "testhost",
      drvPath: DRV,
      onProgress: () => {},
    });

    expect(res).toEqual({ ok: true, agentPath: STORE });

    // The pin is the second runCapture; it re-realises the *store path*
    // (not the .drv) and registers an indirect root.
    expect(runCapture).toHaveBeenCalledTimes(2);
    const pinArgs = vi.mocked(runCapture).mock.calls[1]?.[1] ?? [];
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
    vi.mocked(runCapture).mockResolvedValueOnce({
      ok: false,
      code: 1,
      stdout: "",
    });

    const res = await provisionAgent({
      host: "testhost",
      drvPath: DRV,
      onProgress: () => {},
    });

    expect(res.ok).toBe(false);
    expect(runCapture).toHaveBeenCalledTimes(1); // realise only, no pin
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
    withHome("/home/tester", () => {
      expect(agentGcRootPath(true, DRV)).toBe(
        "/home/tester/.local/state/kolu/surface-nix-host/gcroots/agent",
      );
    });
  });

  it("returns null for localhost when $HOME is unset (no cwd-relative root)", () => {
    // Better unpinned than rooted in the wrong place — the caller skips
    // the best-effort pin on null rather than rooting under the cwd.
    withHome(undefined, () => {
      expect(agentGcRootPath(true, DRV)).toBeNull();
    });
  });

  it("never returns null for a remote host (resolves against ssh $HOME)", () => {
    withHome(undefined, () => {
      expect(agentGcRootPath(false, DRV)).toBe(
        ".local/state/kolu/surface-nix-host/gcroots/agent",
      );
    });
  });
});

/** Run `fn` with `process.env.HOME` set to `value` (or unset for
 *  `undefined`), restoring the prior value afterwards. */
function withHome(value: string | undefined, fn: () => void) {
  const prev = process.env.HOME;
  if (value === undefined) delete process.env.HOME;
  else process.env.HOME = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
  }
}
