/**
 * F17 (juspay/kolu#1334) — the pre-transfer ownership scope of `runPadiDaemon`.
 *
 * `runPadiDaemon` claims padi's single-instance gate FIRST (before any boot side
 * effect), then runs several throwable boot steps — the ephemeral/persistent role
 * stamps, `openStateStores`, `configureDaemonIdentity`, the lifetime parse,
 * `serveDaemonSurfaces`, `bootLocalEndpoint` — before handing the gate to the spine's
 * `daemonMain`. A throw anywhere in that window must NOT leak the gate: pre-fix, the
 * `finally` only closed the served runtime and never released the gate, so a gate file
 * still naming THIS live pid was left behind. In production a crashed pid is
 * dead-pid-reclaimed, but an IN-PROCESS boot (padi is booted in-process by the daemon
 * tests) that catches the error could never retry — the next launch reads the gate as
 * "already running". This proves the pre-transfer throw RELEASES the gate so a
 * same-process retry can re-acquire it.
 *
 * Forks nothing (the ephemeral role write throws before `bootLocalEndpoint` spawns a
 * kaval), so — like kaval's `daemonMainGate.test.ts` — it needs no daemon-test gate.
 */

import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { acquirePidGate } from "@kolu/surface-daemon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPadiDaemon } from "./daemonMain.ts";
import { padiGatePath, padiSocketPath } from "./stateRoot.ts";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

// The ephemeral role marker file `writeEphemeralRole` writes beside the gate — planting
// a DIRECTORY here makes its `writeFileSync` throw EISDIR (modelling an EACCES/EIO/ENOSPC
// role write on the winning holder), the earliest pre-transfer boot fault after acquire.
const ROLE_MARKER_FILE = "role";

describe("runPadiDaemon — pre-transfer boot throw releases the gate (F17)", () => {
  let stateRoot: string;
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  const savedStateDir = process.env.KOLU_STATE_DIR;

  beforeEach(() => {
    process.env.XDG_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "padi-f17-rt-"));
    stateRoot = mkdtempSync(join(tmpdir(), "padi-f17-sr-"));
    delete process.env.KOLU_STATE_DIR;
  });
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
    if (savedStateDir === undefined) delete process.env.KOLU_STATE_DIR;
    else process.env.KOLU_STATE_DIR = savedStateDir;
  });

  it("an ephemeral-role-write throw after the gate acquire releases the gate for a same-process retry", async () => {
    const socketPath = padiSocketPath(stateRoot);
    const gatePath = padiGatePath(socketPath);
    const runtimeDir = dirname(socketPath);

    // Pre-create padi's OWNER-ONLY (0700) runtime dir — the same private rendezvous dir
    // `acquirePidGate` demands, so the acquire below WINS the gate — then plant a
    // DIRECTORY where the ephemeral role marker file goes. `runPadiDaemon` acquires the
    // gate, then `writeEphemeralRole`'s `writeFileSync` throws EISDIR: a pre-transfer
    // boot fault AFTER the gate is held but BEFORE the spine's `daemonMain` takes cleanup
    // ownership — the exact window F17 must clean up.
    mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    mkdirSync(join(runtimeDir, ROLE_MARKER_FILE));

    await expect(runPadiDaemon({ stateRoot, log })).rejects.toThrow();

    // The gate was RELEASED on the pre-transfer throw (F17): the pid file is gone…
    expect(existsSync(gatePath)).toBe(false);
    // …and a fresh acquire on the SAME path SUCCEEDS — a subsequent in-process boot does
    // NOT see "already-running". Were the gate leaked, the file would still name this
    // live pid and the acquire would come back `held`.
    const retry = acquirePidGate(gatePath);
    expect(retry.kind).toBe("acquired");
    if (retry.kind === "acquired") retry.release();
  });
});
