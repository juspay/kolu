/**
 * Coverage for the ssh ControlMaster opt construction (`controlOptPairs`):
 * the path is the kolu-private `%C` socket (never `~/.ssh`), the control
 * dir is created `0700` and the concern is memoized, and any unsafe setup
 * (a non-private dir, a whitespace path) degrades to NO control opts rather
 * than corrupting the ssh options. All FS work is confined to a fresh
 * `os.tmpdir()` subdir per test; no ssh / nix is spawned.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetControlMemo, controlOptPairs } from "./controlMaster";

const tmpDirs: string[] = [];
function freshXdg(): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-ssh-test-"));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  __resetControlMemo();
});
afterEach(() => {
  __resetControlMemo();
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

/** The `ControlPath` value out of the rendered pairs (undefined if absent). */
function controlPathValue(): string | undefined {
  return controlOptPairs().find(([k]) => k === "ControlPath")?.[1];
}
function optMap(): Record<string, string> {
  return Object.fromEntries(controlOptPairs().map(([k, v]) => [k, v]));
}

describe("controlOptPairs path shape", () => {
  it("is the kolu-private %C socket under the runtime dir, never ~/.ssh", () => {
    const xdg = freshXdg();
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();
    const path = controlPathValue();
    expect(path).toBeDefined();
    const p = path as string;
    expect(p.endsWith("/%C")).toBe(true); // ssh expands %C per host at connect
    expect(p).toContain("kolu-ssh");
    expect(p.startsWith(xdg)).toBe(true);
    expect(p).not.toContain(".ssh"); // never the user's ssh-config dir
    expect(/\s/.test(p)).toBe(false); // NIX_SSHOPTS word-split contract
  });

  it("carries ControlMaster=auto and a cross-invocation ControlPersist", () => {
    vi.stubEnv("XDG_RUNTIME_DIR", freshXdg());
    __resetControlMemo();
    const opts = optMap();
    expect(opts.ControlMaster).toBe("auto");
    expect(opts.ControlPersist).toBe("10m");
  });

  it("agrees on one path: the mkdir'd dir is dirname(ControlPath), token-free", () => {
    vi.stubEnv("XDG_RUNTIME_DIR", freshXdg());
    __resetControlMemo();
    const path = controlPathValue() as string;
    const dir = dirname(path);
    expect(dir).not.toContain("%C"); // the real dir has no ssh token
    // single-source-of-truth: that exact dir is the one that got created.
    expect(statSync(dir).isDirectory()).toBe(true);
  });
});

describe("controlOptPairs ensure-dir", () => {
  it("creates the control dir 0700 and memoizes the result", () => {
    const xdg = freshXdg();
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();
    const first = controlOptPairs();
    if (process.getuid !== undefined) {
      expect(statSync(join(xdg, "kolu-ssh")).mode & 0o777).toBe(0o700);
    }
    // memoized: a second call returns the very same array — no recompute.
    expect(controlOptPairs()).toBe(first);
  });

  it("degrades to [] when the control dir is not owner-only", () => {
    if (process.getuid === undefined) return; // no uid semantics — skip
    const xdg = freshXdg();
    // Pre-create the computed control dir with group/other bits set.
    // chmod (not mkdir mode) so the loose perms survive any test umask.
    const dir = join(xdg, "kolu-ssh");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();
    expect(controlOptPairs()).toEqual([]);
  });

  it("degrades to [] when the path would contain whitespace", () => {
    const xdg = freshXdg();
    vi.stubEnv("XDG_RUNTIME_DIR", `${xdg} with space`);
    __resetControlMemo();
    // Upholds the NIX_SSHOPTS word-split contract: a space-bearing path
    // drops ALL control pairs rather than corrupt the env form.
    expect(controlOptPairs()).toEqual([]);
  });
});
