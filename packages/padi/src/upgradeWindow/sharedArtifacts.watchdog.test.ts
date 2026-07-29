/**
 * Shared-artifact watchdog — every file both daemon generations touch must
 * either have a mixed-version test registered in the coverage manifest
 * (`sharedArtifacts.testlib.ts`) or declare an explicit version field.
 *
 * Coverage alone is not enough: a new shared file nobody registers would pass
 * a hand-list-only audit. Grounding lives in `previousRelease.e2e.test.ts`
 * (enumerates the live runtime dir + state-root after real daemons boot) and
 * is also unit-checked here with a synthetic disk layout that proves an
 * unregistered basename fails the matcher.
 */

import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createSharedArtifactWatchdog,
  unknownProtocolFilesOnDisk,
  unknownSharedFileMessage,
} from "@kolu/surface-daemon/upgrade-window.testlib";
import { SHARED_ARTIFACTS } from "./sharedArtifacts.testlib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPERVISOR_SUITES = join(HERE, "../../../surface-daemon-supervisor/src");
const suiteFiles = new Set([
  ...readdirSync(HERE),
  ...readdirSync(SUPERVISOR_SUITES),
]);
const watchdog = createSharedArtifactWatchdog(SHARED_ARTIFACTS);

describe("shared-artifact watchdog (upgrade-window)", () => {
  it("every non-log shared artifact has a real disposition test", () => {
    expect(watchdog.coverageGaps(suiteFiles)).toEqual([]);
  });

  it("the inventory is non-empty and includes the core gate/socket/session trio", () => {
    const ids = new Set(SHARED_ARTIFACTS.map((a) => a.id));
    expect(ids.has("kaval-gate")).toBe(true);
    expect(ids.has("kaval-socket")).toBe(true);
    watchdog.assertInventory([
      "kaval-gate",
      "kaval-socket",
      "padi-session-blob",
      "padi-state-root-config",
      "padi-supervisor-gate",
    ]);
    // Mutate-to-prove: deleting kaval-gate from the inventory fails this pin.
    expect(SHARED_ARTIFACTS.length).toBeGreaterThanOrEqual(6);
  });

  it("versionField alone is red until a version+1 disposition test is registered", () => {
    const versionOnly = [
      {
        ...SHARED_ARTIFACTS.find((a) => a.id === "padi-state-root-config")!,
        coveredByTest: null,
      },
    ];
    expect(
      createSharedArtifactWatchdog(versionOnly)
        .coverageGaps(suiteFiles)
        .join("\n"),
    ).toMatch(/versionField=.*does not prove the version\+1 reader outcome/);
  });

  it("every protocol inventory entry that is a real file declares diskBasenames or patterns", () => {
    for (const a of SHARED_ARTIFACTS) {
      if (a.role === "log" || a.role === "session") continue;
      expect(
        a.diskBasenames.length + a.diskBasenamePatterns.length,
        `${a.id} is a protocol surface but has empty diskBasenames/patterns — the grounded sweep cannot match it`,
      ).toBeGreaterThan(0);
    }
  });

  it("grounded matcher: known layout is clean; an unregistered basename is red", () => {
    const runtime = mkdtempSync(join(tmpdir(), "uw-ground-rt-"));
    const state = mkdtempSync(join(tmpdir(), "uw-ground-sr-"));
    // A known layout — every basename/pattern is in the inventory.
    const kavalDir = join(runtime, "kaval-deadbeef");
    const padiDir = join(runtime, "padi-deadbeef");
    const termId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mkdirSync(kavalDir, { recursive: true, mode: 0o700 });
    mkdirSync(padiDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(kavalDir, "kaval.pid"), "1\n");
    writeFileSync(join(kavalDir, "pty-host.sock"), ""); // placeholder file
    writeFileSync(join(kavalDir, "state-root"), `${state}\n`);
    writeFileSync(join(kavalDir, "kaval.log"), ""); // log — exempt
    writeFileSync(join(kavalDir, `bashrc-${termId}`), "# wrapper\n");
    // Darwin default shell is zsh — init lives under rc/zdotdir-<uuid>/.zshrc.
    const zdot = join(kavalDir, "rc", `zdotdir-${termId}`);
    mkdirSync(zdot, { recursive: true, mode: 0o700 });
    writeFileSync(join(zdot, ".zshrc"), "# zsh wrapper\n");
    writeFileSync(join(padiDir, "padi.pid"), "2\n");
    writeFileSync(join(padiDir, "supervisor.pid"), "3\n");
    writeFileSync(join(padiDir, "padi.sock"), "");
    writeFileSync(join(state, "config.json"), "{}");
    writeFileSync(join(state, "padi.log"), "");
    writeFileSync(join(state, "padi.log.1"), ""); // pino-roll generation
    writeFileSync(join(state, "padi.stderr.log"), "");

    expect(
      unknownProtocolFilesOnDisk(SHARED_ARTIFACTS, runtime, state),
    ).toEqual([]);

    // Plant an unregistered shared file — the exact miss a hand-list-only
    // watchdog cannot catch. The matcher must name it (relative path).
    writeFileSync(join(kavalDir, "kaval.gate.v2"), "format=2\n");
    const unknown = unknownProtocolFilesOnDisk(
      SHARED_ARTIFACTS,
      runtime,
      state,
    );
    expect(unknown).toEqual([`kaval-deadbeef/kaval.gate.v2`]);
    expect(unknownSharedFileMessage(SHARED_ARTIFACTS, unknown)).toMatch(
      /kaval\.gate\.v2/,
    );
    expect(unknownSharedFileMessage(SHARED_ARTIFACTS, unknown)).toMatch(
      /version\+1/,
    );
  });
});
