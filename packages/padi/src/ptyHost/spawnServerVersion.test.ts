import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtyHostSystemInfo } from "kaval";
import { describe, expect, it } from "vitest";
import {
  composeSpawnInput,
  requireSpawnServerVersion,
  setSpawnServerVersion,
} from "./index.ts";

const RC_DIR = mkdtempSync(join(tmpdir(), "spawn-version-rc-"));

const KAVAL_SOCK = "/tmp/kaval-7692-501/pty-host.sock";

function info(): PtyHostSystemInfo {
  return {
    shell: "/bin/sh",
    home: "/home/test",
    platform: "linux",
    rcDir: RC_DIR,
  } as PtyHostSystemInfo;
}

describe("spawnServerVersion boot-order fail-fast", () => {
  it("throws a named error when the version is read before the setter runs", () => {
    expect(() => requireSpawnServerVersion()).toThrow(
      "spawnServerVersion read before setSpawnServerVersion() — kolu-server boot must inject it before ensureLocalEndpoint",
    );
  });

  it("stamps TERM_PROGRAM_VERSION from the injected version once set", () => {
    setSpawnServerVersion("1.2.3");
    const input = composeSpawnInput({ id: "T-set" }, info(), {
      kavalSocket: KAVAL_SOCK,
      toolsPath: [],
      serverVersion: requireSpawnServerVersion(),
    });
    expect(input.env.TERM_PROGRAM_VERSION).toBe("1.2.3");
  });

  it("still rejects an empty version in the setter", () => {
    expect(() => setSpawnServerVersion("")).toThrow(
      "setSpawnServerVersion: empty",
    );
  });
});
