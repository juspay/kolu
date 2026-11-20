import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assertDaemonSpawnAllowed } from "./daemonSpawnGate.ts";

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.VITEST;
  delete process.env.NODE_ENV;
  delete process.env.KOLU_DAEMON_TESTS;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("kaval assertDaemonSpawnAllowed — test-context predicate parity (F18)", () => {
  test("VITEST=true + gate OFF → refuses", () => {
    process.env.VITEST = "true";
    expect(() => assertDaemonSpawnAllowed("a kaval daemon")).toThrow(
      /KOLU_DAEMON_TESTS/,
    );
  });

  test("NODE_ENV=test + gate OFF → refuses (the F18 drift: was reachable gate-off)", () => {
    process.env.NODE_ENV = "test";
    expect(() => assertDaemonSpawnAllowed("a kaval daemon")).toThrow(
      /KOLU_DAEMON_TESTS/,
    );
  });

  test("VITEST=true + gate ON → allowed", () => {
    process.env.VITEST = "true";
    process.env.KOLU_DAEMON_TESTS = "1";
    expect(() => assertDaemonSpawnAllowed("a kaval daemon")).not.toThrow();
  });

  test("NODE_ENV=test + gate ON → allowed", () => {
    process.env.NODE_ENV = "test";
    process.env.KOLU_DAEMON_TESTS = "1";
    expect(() => assertDaemonSpawnAllowed("a kaval daemon")).not.toThrow();
  });

  test("neither env (production) → strict no-op", () => {
    expect(() => assertDaemonSpawnAllowed()).not.toThrow();
  });
});
