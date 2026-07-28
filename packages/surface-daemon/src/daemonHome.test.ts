/**
 * `daemonHome` unit pins: 0700 creation, non-private-dir refusal, both
 * placements, and the gate/socket/file path algebra.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { daemonHome } from "./daemonHome.ts";

const scratchDirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "daemon-home-"));
  scratchDirs.push(d);
  return d;
}

function pinEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  // Isolate from the ambient host XDG so placement assertions are stable.
  pinEnv("XDG_STATE_HOME", undefined);
  pinEnv("XDG_RUNTIME_DIR", undefined);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
  for (const d of scratchDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

it("state placement creates a 0700 dir under XDG_STATE_HOME/<app>", () => {
  const root = scratch();
  pinEnv("XDG_STATE_HOME", root);

  const home = daemonHome({ app: "pulse", placement: "state" });

  expect(home.dir).toBe(join(root, "pulse"));
  expect(existsSync(home.dir)).toBe(true);
  const mode = lstatSync(home.dir).mode & 0o777;
  expect(mode).toBe(0o700);
  expect(home.gatePath).toBe(join(home.dir, "pulse.pid"));
  expect(home.socketPath).toBe(join(home.dir, "pulse.sock"));
  expect(home.file("history.ring.json")).toBe(
    join(home.dir, "history.ring.json"),
  );
});

it("state placement falls back to ~/.local/state/<app> when XDG_STATE_HOME is unset", () => {
  const fakeHome = scratch();
  pinEnv("XDG_STATE_HOME", undefined);
  pinEnv("HOME", fakeHome);

  const home = daemonHome({ app: "pulse", placement: "state" });

  expect(home.dir).toBe(join(fakeHome, ".local", "state", "pulse"));
  expect(lstatSync(home.dir).mode & 0o777).toBe(0o700);
});

it("runtime placement creates a 0700 dir under XDG_RUNTIME_DIR/<app>", () => {
  const root = scratch();
  pinEnv("XDG_RUNTIME_DIR", root);

  const home = daemonHome({ app: "pulse", placement: "runtime" });

  expect(home.dir).toBe(join(root, "pulse"));
  expect(lstatSync(home.dir).mode & 0o777).toBe(0o700);
  expect(home.gatePath).toBe(join(home.dir, "pulse.pid"));
  expect(home.socketPath).toBe(join(home.dir, "pulse.sock"));
});

it("runtime placement falls back to /tmp/<app>-$UID when XDG_RUNTIME_DIR is unset", () => {
  pinEnv("XDG_RUNTIME_DIR", undefined);
  const uid = process.getuid?.() ?? "shared";

  const home = daemonHome({ app: "pulse-home-test", placement: "runtime" });
  scratchDirs.push(home.dir); // so afterEach can clean the /tmp fallout

  expect(home.dir).toBe(`/tmp/pulse-home-test-${uid}`);
  expect(lstatSync(home.dir).mode & 0o777).toBe(0o700);
});

it("refuses a non-private (group/other-accessible) pre-existing home", () => {
  if (process.getuid === undefined) {
    // No uid semantics — privacy check is a no-op.
    return;
  }
  const root = scratch();
  pinEnv("XDG_STATE_HOME", root);
  const dir = join(root, "pulse");
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  chmodSync(dir, 0o755);

  expect(() => daemonHome({ app: "pulse", placement: "state" })).toThrow(
    /not a private owner-only directory/,
  );
});

it("returns SharedArtifact entries for gate and socket by construction", () => {
  const root = scratch();
  pinEnv("XDG_STATE_HOME", root);

  const home = daemonHome({ app: "pulse", placement: "state" });

  expect(home.artifacts).toHaveLength(2);
  const [gate, sock] = home.artifacts;
  expect(gate).toMatchObject({
    id: "pulse-gate",
    role: "gate",
    diskBasenames: ["pulse.pid"],
  });
  expect(sock).toMatchObject({
    id: "pulse-socket",
    role: "socket",
    diskBasenames: ["pulse.sock"],
  });
});

it("rejects an empty or multi-segment app name", () => {
  expect(() => daemonHome({ app: "", placement: "state" })).toThrow(/app must/);
  expect(() => daemonHome({ app: "a/b", placement: "state" })).toThrow(
    /app must/,
  );
});

it("file() rejects multi-segment names", () => {
  const root = scratch();
  pinEnv("XDG_STATE_HOME", root);
  const home = daemonHome({ app: "pulse", placement: "state" });
  expect(() => home.file("../escape")).toThrow(/name must/);
  expect(() => home.file("")).toThrow(/name must/);
});
