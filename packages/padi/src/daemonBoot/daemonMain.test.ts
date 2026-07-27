/**
 * The gate-first ordering (W2.2 review B1): `runPadiDaemon` must claim padi's
 * single-instance gate BEFORE any boot side effect — the legacy import, the kaval
 * spawn/recycle, the state manifests. A second padi racing an already-held
 * state-root has to learn it lost the race and exit `already-running` WITHOUT
 * having imported, recycled the shared kaval, or written a manifest — else the
 * loser clobbers the winner's disk.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processIdentity } from "osfacts-client";
import { runPadiDaemon } from "./daemonMain.ts";
import { osfactsBinPath } from "../ports/scan.ts";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
} from "../stateRoot.ts";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("runPadiDaemon — gate claimed FIRST (B1)", () => {
  let stateRoot: string;
  const savedXdg = process.env.XDG_RUNTIME_DIR;
  const savedStateDir = process.env.KOLU_STATE_DIR;

  beforeEach(() => {
    process.env.XDG_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "padi-gate-rt-"));
    stateRoot = mkdtempSync(join(tmpdir(), "padi-gate-sr-"));
    delete process.env.KOLU_STATE_DIR;
  });
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = savedXdg;
    if (savedStateDir === undefined) delete process.env.KOLU_STATE_DIR;
    else process.env.KOLU_STATE_DIR = savedStateDir;
  });

  it("a second padi at an already-held state-root exits already-running, touching NOTHING", async () => {
    // Simulate a LIVE first padi already holding the gate: create padi's runtime dir
    // (owner-only, as the real gate demands) and write the gate file pointing at THIS
    // process — a pid `isHolderLive` reads as alive, so the acquire sees `held`.
    const socketPath = padiSocketPath(stateRoot);
    const gatePath = padiGatePath(socketPath);
    // OWNER-ONLY perms on both the gate dir (0700) and the gate file (0600): the
    // gate lands under a mkdtempSync'd XDG_RUNTIME_DIR (unique + owner-only), so
    // there is no world-readable-temp exposure to begin with — the explicit mode
    // keeps it that way and clears CodeQL js/insecure-temporary-file (same
    // remediation as saveTerminalFile in terminalScratch.ts).
    mkdirSync(dirname(gatePath), { recursive: true, mode: 0o700 });
    const self = processIdentity(osfactsBinPath(), process.pid);
    if (self === undefined)
      throw new Error(`osfacts could not resolve test pid ${process.pid}`);
    writeFileSync(gatePath, `${self.pid}\t${self.startUnixUs}\n`, {
      mode: 0o600,
    });

    // A legacy config the one-shot import WOULD read if it ran — its `.bak` copy is
    // our tripwire that the import fired.
    const legacyDir = mkdtempSync(join(tmpdir(), "padi-gate-legacy-"));
    // Owner-only mode here too, so hardening the gate write above does not just
    // relocate CodeQL js/insecure-temporary-file to this sibling temp write.
    writeFileSync(
      join(legacyDir, "config.json"),
      JSON.stringify({
        session: {
          terminals: [{ id: "11111111-1111-1111-1111-111111111111" }],
          activeTerminalId: null,
        },
      }),
      { mode: 0o600 },
    );
    process.env.KOLU_STATE_DIR = legacyDir;

    const exit = await runPadiDaemon({ stateRoot, log });

    // It yielded to the live instance…
    expect(exit).toEqual({ kind: "already-running", pid: process.pid });
    // …WITHOUT running the legacy import (no backup taken → the loser never read it)…
    expect(existsSync(join(legacyDir, "config.json.pre-padi-import.bak"))).toBe(
      false,
    );
    // …WITHOUT opening padi's own state-root store (no `config.json` written there)…
    expect(existsSync(join(stateRoot, "config.json"))).toBe(false);
    // …and WITHOUT spawning/recycling a kaval (no kaval runtime dir at all). The
    // manifests + memory sampler are all downstream of this same unran boot, so
    // proving the kaval never came up proves none of them ran either.
    expect(existsSync(dirname(padiKavalSocketPath(stateRoot)))).toBe(false);
  });
});
