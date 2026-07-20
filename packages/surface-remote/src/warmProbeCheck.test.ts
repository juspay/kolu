/**
 * D1a RED pin (#1908) — the warm probe must ASK, not DO.
 *
 * `provisionAgent`'s warm fast-path (`nixCopy.ts:197-213`) runs ONE fused
 * `ssh $host nix-store --realise $drv --add-root $link --indirect`, narrated as
 * `checking for a cached agent…`. The intent is a fast presence check — but
 * `nix-store --realise` of an ABSENT-yet-SUBSTITUTABLE closure performs the real
 * substitution (network fetch, observed live from cache.nixos.asia) INSIDE what
 * the copy promises is a check. On the incident that fused child wedged ~10
 * minutes under a label that read "checking".
 *
 * The pin: the warm probe must be a bounded, seconds-scale TRUE check that neither
 * SUBSTITUTES (no bare `nix-store --realise <drv>` — the design picks a
 * non-substituting form: `--realise --dry-run` or `nix path-info`, chosen with
 * evidence at the gate) nor MUTATES the store (no `--add-root` GC-root
 * registration — a check doesn't pin). Substitution belongs to the provision step
 * and is narrated there as provisioning.
 *
 * Structured at the `provisionAgent` seam with the repo's injected-exec idiom
 * (mock `./process`, assert the exact probe argv). `it.fails` per the RED
 * convention: the fused realise substitutes today, so the assertions throw and
 * `it.fails` is GREEN on the RED commit; Phase C reshapes the probe and flips
 * `it.fails` → `it`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetControlMemo } from "./controlMaster";
import { provisionAgent } from "./nixCopy";
import { runCapture } from "./process";

vi.mock("./process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
  runProgress: vi.fn(),
}));

const STORE = "/nix/store/x8yvl9si8vb93vhwway7kf3zbvv4ahg1-agent";
const DRV = "/nix/store/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-agent.drv";

const tmpDirs: string[] = [];
beforeEach(() => {
  // buildSshProbeCommand renders the P2.8 control opts, which mkdirs the control
  // dir — point it at a throwaway private runtime dir so it renders
  // deterministically and leaves no /tmp residue.
  const xdg = mkdtempSync(join(tmpdir(), "kolu-ssh-warmprobe-test-"));
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

describe("D1a — the warm probe asks, never substitutes (#1908)", () => {
  it.fails("the warm 'cached agent' probe is a non-substituting, non-mutating check", async () => {
    // Warm host: the probe answers "present" (returns the out-path) and
    // provisioning short-circuits, so the probe is the sole runCapture call.
    vi.mocked(runCapture).mockResolvedValueOnce({
      ok: true,
      kind: "exit",
      code: 0,
      stdout: `${STORE}\n`,
    });

    await provisionAgent({
      host: "testhost",
      drvPath: DRV,
      onProgress: () => {},
    });

    const probeArgs = vi.mocked(runCapture).mock.calls[0]![1];

    // A bare `--realise <drv>` SUBSTITUTES (fetches/builds) — the wedge. The
    // probe must not realise the derivation unless it is a dry run (which
    // performs no substitution). Design-agnostic: a `nix path-info` probe has
    // no `--realise` at all and passes trivially.
    const realisesDrv =
      probeArgs.includes("--realise") && probeArgs.includes(DRV);
    const isDryRun = probeArgs.includes("--dry-run");
    expect(
      realisesDrv && !isDryRun,
      "warm probe performs a substituting realise inside a 'check'",
    ).toBe(false);

    // A true CHECK does not register a GC root — pinning belongs to the
    // provision step, not the probe.
    expect(
      probeArgs,
      "warm check must not register a GC root (--add-root)",
    ).not.toContain("--add-root");
  });
});
