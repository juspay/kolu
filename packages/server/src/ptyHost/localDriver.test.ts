/**
 * Per-instance kaval daemon isolation — the fix for the prod incident where a
 * second kolu-server killed the first's daemon (and every terminal with it).
 *
 * The boot policy is ALWAYS-RECYCLE: a starting server SIGTERMs whatever daemon
 * holds its socket's gate before spawning fresh. With a SHARED `kaval` namespace
 * that recycle reached ACROSS instances — a `just dev`, a second worktree, or a
 * bug-repro `kolu` on another port beside a production `kolu.service` would find
 * the production daemon at the shared gate and kill it. Keying the namespace by
 * the server's LISTEN PORT (`kaval-<port>`) makes each instance own a private
 * daemon by construction (two servers can't share a port), so the recycle can
 * only reach this instance's own daemon. `KOLU_KAVAL_SOCKET` still overrides the
 * whole path (the e2e harness pins it). `resolveKavalLaunch` ALWAYS forwards the
 * resolved path to the spawned kaval via `--socket`, so the daemon serves exactly
 * what the server dials. These lock all three.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kavalSocketPath, resolveKavalLaunch } from "./localDriver.ts";

describe("per-instance kaval daemon isolation", () => {
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

  it("namespaces the socket by listen port, so two servers never collide", () => {
    delete process.env.KOLU_KAVAL_SOCKET;

    const a = kavalSocketPath(7681);
    const b = kavalSocketPath(18331);

    // Distinct per-port namespaces — the whole fix: a repro server on 18331
    // can never land on (and recycle) a production server's 7681 daemon.
    expect(a).not.toBe(b);
    expect(a).toContain("/kaval-7681/");
    expect(b).toContain("/kaval-18331/");
    expect(a.endsWith("/pty-host.sock")).toBe(true);
  });

  it("KOLU_KAVAL_SOCKET overrides the per-port default (the explicit pin)", () => {
    const sock = "/run/user/1000/kr-isolated/kaval/pty-host.sock";
    process.env.KOLU_KAVAL_SOCKET = sock;

    // Override wins regardless of port.
    expect(kavalSocketPath(7681)).toBe(sock);
    expect(kavalSocketPath(18331)).toBe(sock);
  });

  it("always forwards the resolved socket to the spawned kaval via --socket", () => {
    process.env.KOLU_KAVAL_BIN = "/nix/store/abc/bin/kaval";
    const socketPath = kavalSocketPath(7681);

    // The daemon is told to serve exactly the path the server dials — never its
    // own bare default namespace.
    expect(resolveKavalLaunch(socketPath)).toEqual({
      binPath: "/nix/store/abc/bin/kaval",
      args: ["--socket", socketPath],
    });
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
