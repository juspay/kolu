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
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { daemonHome, resolveDaemonHome } from "./daemonHome.ts";

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
  // Unique app so concurrent runs never collide on a fixed /tmp name, and
  // afterEach only deletes a directory we created for this test.
  const app = `pulse-home-${randomUUID().slice(0, 8)}`;

  const home = daemonHome({ app, placement: "runtime" });
  scratchDirs.push(home.dir);

  expect(home.dir).toBe(`/tmp/${app}-${uid}`);
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

it("refuses a private-but-unusable (no owner rwx) pre-existing home", () => {
  if (process.getuid === undefined) return;
  const root = scratch();
  pinEnv("XDG_STATE_HOME", root);
  const dir = join(root, "pulse");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Owner-only but not usable (no owner bits) — privacy alone is not enough.
  chmodSync(dir, 0o000);

  expect(() => daemonHome({ app: "pulse", placement: "state" })).toThrow(
    /not a private owner-only directory/,
  );
  // Restore so afterEach can clean the scratch tree.
  chmodSync(dir, 0o700);
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

it("rejects an empty, dot, or multi-segment app name", () => {
  expect(() => daemonHome({ app: "", placement: "state" })).toThrow(/app must/);
  expect(() => daemonHome({ app: ".", placement: "state" })).toThrow(
    /app must/,
  );
  expect(() => daemonHome({ app: "..", placement: "state" })).toThrow(
    /app must/,
  );
  expect(() => daemonHome({ app: "a/b", placement: "state" })).toThrow(
    /app must/,
  );
});

it("file() rejects empty, dot, and multi-segment names", () => {
  const root = scratch();
  pinEnv("XDG_STATE_HOME", root);
  const home = daemonHome({ app: "pulse", placement: "state" });
  expect(() => home.file("../escape")).toThrow(/name must/);
  expect(() => home.file("..")).toThrow(/name must/);
  expect(() => home.file(".")).toThrow(/name must/);
  expect(() => home.file("")).toThrow(/name must/);
});

it("instance mode puts the home under <app>-<instance>/ with bare-stem gate/socket", () => {
  const root = scratch();
  pinEnv("XDG_RUNTIME_DIR", root);

  const home = daemonHome({
    app: "padi",
    placement: "runtime",
    instance: "abcdef0123456789",
  });

  expect(home.dir).toBe(join(root, "padi-abcdef0123456789"));
  expect(home.gatePath).toBe(join(home.dir, "padi.pid"));
  expect(home.socketPath).toBe(join(home.dir, "padi.sock"));
  // Stem stays bare — never padi-abcdef0123456789.pid
  expect(home.gatePath.endsWith("padi.pid")).toBe(true);
  expect(home.gatePath.includes("padi-abcdef0123456789.pid")).toBe(false);
});

it("socketFile overrides the socket basename (kaval's pty-host.sock)", () => {
  const root = scratch();
  pinEnv("XDG_RUNTIME_DIR", root);

  const home = daemonHome({
    app: "kaval",
    placement: "runtime",
    instance: "deadbeefcafebabe",
    socketFile: "pty-host.sock",
  });

  expect(home.dir).toBe(join(root, "kaval-deadbeefcafebabe"));
  expect(home.gatePath).toBe(join(home.dir, "kaval.pid"));
  expect(home.socketPath).toBe(join(home.dir, "pty-host.sock"));
  expect(home.file("kaval.log")).toBe(join(home.dir, "kaval.log"));
  expect(home.file("rc")).toBe(join(home.dir, "rc"));
  expect(home.file("state-root")).toBe(join(home.dir, "state-root"));
});

it("resolveDaemonHome is pure path algebra (no mkdir)", () => {
  const root = scratch();
  pinEnv("XDG_RUNTIME_DIR", root);
  const missing = join(root, "never-created");
  // Point at a namespace that does not exist yet.
  pinEnv("XDG_RUNTIME_DIR", missing);

  const resolved = resolveDaemonHome({
    app: "padi",
    placement: "runtime",
    instance: "abc",
  });
  expect(resolved.dir).toBe(join(missing, "padi-abc"));
  expect(existsSync(resolved.dir)).toBe(false);
});

it("rejects empty/dot/multi-segment instance and socketFile", () => {
  expect(() =>
    resolveDaemonHome({ app: "padi", placement: "runtime", instance: ".." }),
  ).toThrow(/instance must/);
  expect(() =>
    resolveDaemonHome({
      app: "kaval",
      placement: "runtime",
      socketFile: "a/b.sock",
    }),
  ).toThrow(/socketFile must/);
});
