import { afterEach, describe, expect, test } from "vitest";
import { assertDaemonSpawnAllowed, daemonTestsEnabled } from "./index.ts";
import { DAEMON_LOCATOR_ENV, scrubDaemonLocatorEnv } from "./setup.ts";

// Restore the gate env each case so cases don't leak into one another.
const savedGate = process.env.KOLU_DAEMON_TESTS;
afterEach(() => {
  if (savedGate === undefined) delete process.env.KOLU_DAEMON_TESTS;
  else process.env.KOLU_DAEMON_TESTS = savedGate;
  process.env.VITEST = "true";
});

describe("the spawn leash (assertDaemonSpawnAllowed)", () => {
  test("throws in a test context when the gate is OFF", () => {
    delete process.env.KOLU_DAEMON_TESTS;
    process.env.VITEST = "true";
    expect(() => assertDaemonSpawnAllowed("a kaval daemon")).toThrow(
      /KOLU_DAEMON_TESTS/,
    );
  });

  test("permits the fork when the gate is ON", () => {
    process.env.KOLU_DAEMON_TESTS = "1";
    expect(() => assertDaemonSpawnAllowed("a kaval daemon")).not.toThrow();
  });

  test("is a no-op outside a test context (production never carries VITEST)", () => {
    delete process.env.KOLU_DAEMON_TESTS;
    const savedVitest = process.env.VITEST;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    delete process.env.NODE_ENV;
    try {
      expect(() => assertDaemonSpawnAllowed()).not.toThrow();
    } finally {
      if (savedVitest !== undefined) process.env.VITEST = savedVitest;
      if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
    }
  });

  test("daemonTestsEnabled tracks the env var", () => {
    process.env.KOLU_DAEMON_TESTS = "1";
    expect(daemonTestsEnabled()).toBe(true);
    delete process.env.KOLU_DAEMON_TESTS;
    expect(daemonTestsEnabled()).toBe(false);
  });
});

describe("the env scrub (scrubDaemonLocatorEnv)", () => {
  test("deletes every daemon-locator var and pins a private XDG drawer", () => {
    process.env.KAVAL_SOCKET = "/run/user/1000/kaval-prod/pty-host.sock";
    process.env.PADI_SOCKET = "/run/user/1000/padi-prod/padi.sock";
    process.env.KOLU_KAVAL_SOCKET = "/run/user/1000/kaval-prod/pty-host.sock";
    process.env.KOLU_PADI_STATE_DIR = "/home/dev/.local/state/padi";

    const drawer = scrubDaemonLocatorEnv();

    for (const key of DAEMON_LOCATOR_ENV) {
      expect(process.env[key], `${key} must be scrubbed`).toBeUndefined();
    }
    expect(process.env.XDG_RUNTIME_DIR).toBe(drawer);
    expect(drawer).toContain("kolu-vitest-xdg-");
  });

  test("scrubs KOLU_ROLE (forward-looking — a leaked `production` would no-op the future bind/act refusals)", () => {
    process.env.KOLU_ROLE = "production";
    scrubDaemonLocatorEnv();
    expect(process.env.KOLU_ROLE).toBeUndefined();
  });

  test("leaves KOLU_STATE_DIR untouched (the harness's own isolation)", () => {
    process.env.KOLU_STATE_DIR = "/tmp/kolu-unit-test/state";
    scrubDaemonLocatorEnv();
    expect(process.env.KOLU_STATE_DIR).toBe("/tmp/kolu-unit-test/state");
  });
});
