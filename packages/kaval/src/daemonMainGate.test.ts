/**
 * F2 (juspay/kolu#1334): kaval stamps its ephemeral role ONLY as the winning gate
 * holder. A dev kaval that races a live PRODUCTION digest must LOSE the gate and exit
 * WITHOUT overwriting the live holder's `role` marker — otherwise the prod holder's
 * dir would read `dev` and the adopt/kill guard would wrongly permit a dev process to
 * SIGTERM it.
 *
 * This is a pure GATE-race test (the losing racer returns `already-running` before any
 * fork), so it needs no daemon-test gate — nothing is spawned.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquirePidGate, type GateAcquisition } from "@kolu/surface-daemon";
import { afterEach, beforeEach, expect, test } from "vitest";
import { runKavalDaemon } from "./daemonMain.ts";
import { ephemeralRolePath, writeEphemeralRole } from "./role.ts";
import { KAVAL_GATE_FILE } from "./socketPath.ts";

const silentLog = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  // biome-ignore lint/suspicious/noExplicitAny: a minimal Logger stand-in for the test.
} as any;

let sandbox: string;
const savedRole = process.env.KOLU_ROLE;
const savedBindPid = process.env.KOLU_DAEMON_BIND_PID;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "kaval-gate-race-"));
});
afterEach(() => {
  if (savedRole === undefined) delete process.env.KOLU_ROLE;
  else process.env.KOLU_ROLE = savedRole;
  if (savedBindPid === undefined) delete process.env.KOLU_DAEMON_BIND_PID;
  else process.env.KOLU_DAEMON_BIND_PID = savedBindPid;
  rmSync(sandbox, { recursive: true, force: true });
});

test("a losing dev racer does NOT overwrite the live production holder's ephemeral role", async () => {
  const socketPath = join(sandbox, "pty-host.sock");
  const gatePath = join(sandbox, KAVAL_GATE_FILE);

  // The WINNING production holder claims the gate first and stamps its role — exactly
  // what a real production kaval does on top of the gate it just won.
  const winner: GateAcquisition = acquirePidGate(gatePath);
  expect(winner.kind).toBe("acquired");
  writeEphemeralRole(sandbox, "production");

  // A losing DEV kaval races the SAME rendezvous. It must see the gate is held and
  // yield WITHOUT touching the marker.
  delete process.env.KOLU_ROLE;
  const exit = await runKavalDaemon({
    socketOverride: socketPath,
    log: silentLog,
  });

  expect(exit).toEqual({ kind: "already-running", pid: process.pid });
  // The live holder's marker is UNTOUCHED — the dev loser never wrote `dev` over it.
  expect(readFileSync(ephemeralRolePath(sandbox), "utf8").trim()).toBe(
    "production",
  );

  if (winner.kind === "acquired") winner.release();
});

test("F17: a pre-transfer boot throw (malformed KOLU_DAEMON_BIND_PID) releases the gate for a same-process retry", async () => {
  const socketPath = join(sandbox, "pty-host.sock");
  const gatePath = join(sandbox, KAVAL_GATE_FILE);

  // Moving the gate acquire to the top (F2) means kaval OWNS the gate before it parses
  // the lifetime. A malformed KOLU_DAEMON_BIND_PID throws in `daemonLifetimeFromEnv` —
  // after acquire, before the spine `daemonMain` takes cleanup ownership. Pre-fix that
  // leaked the gate (still naming THIS live pid) so no in-process retry could ever run.
  process.env.KOLU_DAEMON_BIND_PID = "not-a-pid";
  delete process.env.KOLU_ROLE;

  await expect(
    runKavalDaemon({ socketOverride: socketPath, log: silentLog }),
  ).rejects.toThrow(/KOLU_DAEMON_BIND_PID/);

  // The gate was RELEASED on the pre-transfer throw (F17): a fresh acquire on the same
  // path SUCCEEDS. Were it leaked, the file would still name this live pid → `held`.
  const retry = acquirePidGate(gatePath);
  expect(retry.kind).toBe("acquired");
  if (retry.kind === "acquired") retry.release();
});
