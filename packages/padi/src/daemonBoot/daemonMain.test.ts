import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { padiGatePath, padiSocketPath } from "@kolu/padi-client/rendezvous";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { padiKavalSocketPath } from "../stateRoot.ts";
import { runPadiDaemon } from "./daemonMain.ts";

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
    const socketPath = padiSocketPath(stateRoot);
    const gatePath = padiGatePath(socketPath);
    mkdirSync(dirname(gatePath), { recursive: true, mode: 0o700 });
    writeFileSync(gatePath, String(process.pid), { mode: 0o600 });

    const legacyDir = mkdtempSync(join(tmpdir(), "padi-gate-legacy-"));
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

    expect(exit).toEqual({ kind: "already-running", pid: process.pid });
    expect(existsSync(join(legacyDir, "config.json.pre-padi-import.bak"))).toBe(
      false,
    );
    expect(existsSync(join(stateRoot, "config.json"))).toBe(false);
    expect(existsSync(dirname(padiKavalSocketPath(stateRoot)))).toBe(false);
  });
});
