/**
 * `padi --stdio` Lock-1 guard (juspay/kolu#1334, F6). The `--stdio` front's
 * detached-spawn path opens `padi.stderr.log` under the resolved state-root before the
 * re-exec'd durable child reaches its OWN Lock 1. A bare dev `--stdio` (no KOLU_ROLE, no
 * isolated state-root) must therefore be refused at the TOP of `runPadiStdioBridge`, via
 * `resolveBoundStateRoot`, before anything touches production's default root.
 *
 * Pure — the refusal throws before any probe/spawn/log-open, so nothing forks and no
 * daemon-test gate is needed. Runs under a sandboxed $HOME so the "default root" is a
 * temp path nothing real depends on.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { StateRootIsolationError } from "./role.ts";
import { defaultPadiStateRoot } from "./stateRoot.ts";
import { runPadiStdioBridge } from "./stdioBridge.ts";

let sandbox: string;
const saved = { ...process.env };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "stdio-bridge-test-"));
  process.env.HOME = join(sandbox, "home");
  process.env.XDG_RUNTIME_DIR = join(sandbox, "xdg");
  mkdirSync(process.env.HOME, { recursive: true, mode: 0o700 });
  mkdirSync(process.env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  delete process.env.KOLU_ROLE;
  delete process.env.KOLU_PADI_STATE_DIR;
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(sandbox, { recursive: true, force: true });
});

describe("runPadiStdioBridge — Lock 1 before any spawn/log (F6)", () => {
  test("a bare dev --stdio is REFUSED and leaves production's default root untouched", () => {
    const defaultRoot = defaultPadiStateRoot();
    // The guard runs synchronously at the top, so the call throws before returning a
    // promise — no probe, no detached spawn, no crash-log open under the default root.
    expect(() => runPadiStdioBridge()).toThrow(StateRootIsolationError);
    // The default root (and its padi.stderr.log) was never created.
    expect(existsSync(defaultRoot)).toBe(false);
    expect(existsSync(join(defaultRoot, "padi.stderr.log"))).toBe(false);
  });
});
