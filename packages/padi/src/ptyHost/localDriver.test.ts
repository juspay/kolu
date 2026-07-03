/**
 * kaval is ALWAYS told to serve the caller's resolved socket via `--socket`, so
 * the spawned daemon lands on the exact path padi dials — never on kaval's bare
 * default namespace. padi keys that path by a DIGEST of its state-root
 * (`kaval-<digest>/pty-host.sock`), and `KOLU_KAVAL_SOCKET` still overrides the
 * whole path (the e2e harness pins it); either way `resolveKavalLaunch` forwards
 * exactly what it is given.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveKavalLaunch } from "./localDriver.ts";

describe("kaval launch resolution", () => {
  let savedBin: string | undefined;

  beforeEach(() => {
    savedBin = process.env.KOLU_KAVAL_BIN;
  });

  afterEach(() => {
    restore("KOLU_KAVAL_BIN", savedBin);
  });

  it("always forwards the resolved socket to the spawned kaval via --socket", () => {
    process.env.KOLU_KAVAL_BIN = "/nix/store/abc/bin/kaval";
    const socketPath = "/run/user/1000/kaval-x/pty-host.sock";

    // The daemon is told to serve exactly the path padi dials — never its own
    // bare default namespace.
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
