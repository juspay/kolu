/**
 * The per-instance socket-isolation escape hatch (`KOLU_KAVAL_SOCKET`).
 *
 * The boot policy is ALWAYS-RECYCLE: a server SIGTERMs whatever daemon holds its
 * socket's gate before spawning fresh. So two kolu instances on the default
 * `kaval` namespace (a `just dev` beside a production `kolu.service`, a second
 * worktree) would have the newcomer kill the incumbent's daemon and drop its
 * terminals. `KOLU_KAVAL_SOCKET` overrides BOTH the path the server dials AND the
 * `--socket` the spawned kaval serves, so an isolated instance owns its own
 * daemon. These lock that the override flows to both sides (and that its absence
 * keeps the no-flag default that lets `kaval-tui` reach the daemon).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kavalSocketPath, resolveKavalLaunch } from "./localDriver.ts";

describe("KOLU_KAVAL_SOCKET — per-instance daemon isolation", () => {
  let savedSocket: string | undefined;
  let savedBin: string | undefined;

  beforeEach(() => {
    savedSocket = process.env.KOLU_KAVAL_SOCKET;
    savedBin = process.env.KOLU_KAVAL_BIN;
  });

  afterEach(() => {
    restore("KOLU_KAVAL_SOCKET", savedSocket);
    restore("KOLU_KAVAL_BIN", savedBin);
  });

  it("override sets the dialed socket path AND is forwarded to the spawned kaval via --socket", () => {
    const sock = "/run/user/1000/kolu-dev-7700/pty-host.sock";
    process.env.KOLU_KAVAL_SOCKET = sock;
    process.env.KOLU_KAVAL_BIN = "/nix/store/abc/bin/kaval";

    expect(kavalSocketPath()).toBe(sock);
    // Production wrapper path: the override is the only arg, so the daemon serves
    // exactly the socket the server will dial.
    expect(resolveKavalLaunch()).toEqual({
      binPath: "/nix/store/abc/bin/kaval",
      args: ["--socket", sock],
    });
  });

  it("absent override passes NO --socket so kaval keeps its own default namespace", () => {
    delete process.env.KOLU_KAVAL_SOCKET;
    process.env.KOLU_KAVAL_BIN = "/nix/store/abc/bin/kaval";

    // Default `kaval` namespace under $XDG_RUNTIME_DIR (or /tmp), never empty.
    expect(kavalSocketPath().endsWith("/pty-host.sock")).toBe(true);
    expect(resolveKavalLaunch().args).toEqual([]);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
