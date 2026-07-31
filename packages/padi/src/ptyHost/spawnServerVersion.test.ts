/**
 * Boot-order fail-fast for the injected kolu app version (a W1.M severing).
 *
 * `setSpawnServerVersion` throws on an EMPTY value WHEN CALLED, but nothing
 * crashed if boot never called it at all — a spawn then stamped a PTY's
 * `TERM_PROGRAM_VERSION` with a blank version. These pin the READ as loud
 * instead: reading the version before it is injected throws a named error; after
 * a set the version reaches `TERM_PROGRAM_VERSION` unchanged (the happy path
 * stays byte-identical).
 *
 * The read now lives in `buildTerminalSpawnInput`, the one place the daemon's own
 * facts are gathered — `composeSpawnInput` takes the version as spec DATA and
 * reads no globals. So the guard is pinned on `requireSpawnServerVersion`
 * directly, and the stamping is pinned on the composer.
 *
 * A fresh (default-isolated) module graph starts with the version unset, so the
 * read-before-set case runs first, before any set. (Reverting the read to a
 * plain read of the possibly-undefined holder turns the first case green with a
 * blank version — that is the regression this file guards against.)
 */

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

/** The kaval socket locator `composeSpawnInput` stamps as `KAVAL_SOCKET` — passed
 *  as data (the composer stays pure), immaterial to what these cases assert. */
const KAVAL_SOCK = "/tmp/kaval-7692-501/pty-host.sock";

/** A host-facts fixture standing in for the daemon's `system.info`. */
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
    // Throws BEFORE assigning, so it does not clobber the version set above — the
    // existing empty-string rejection is preserved unchanged.
    expect(() => setSpawnServerVersion("")).toThrow(
      "setSpawnServerVersion: empty",
    );
  });
});
