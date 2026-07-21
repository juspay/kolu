/**
 * The production spawn-leash predicate (juspay/kolu#1334/#1375, F18).
 *
 * kaval's `assertDaemonSpawnAllowed` is the PRODUCTION-tier twin of the
 * `@kolu/daemon-test-gate` leaf's leash. The two live in different dependency tiers
 * (the leaf zero-dep for tests; this a production module the real driver funnels wrap),
 * so they keep SEPARATE copies of the "is this a test context" predicate — but the
 * SEMANTICS must never drift. F18 closed a drift where kaval refused only on
 * `VITEST=true` while the leaf refused on `VITEST=true` OR `NODE_ENV=test`, so a
 * `NODE_ENV=test` process could reach the funnels gate-off. These tests pin BOTH
 * spellings on the production tier so the deliberate duplication can't diverge again.
 *
 * Pure env reads — forks nothing, so no daemon-test gate is needed.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { assertDaemonSpawnAllowed } from "./daemonSpawnGate.ts";

const saved = { ...process.env };

beforeEach(() => {
  // Start from a clean slate every case so one spelling's setup can't mask another.
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
