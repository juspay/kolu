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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SHARED_ARTIFACTS,
  unknownProtocolFilesOnDisk,
  unknownSharedFileMessage,
} from "./sharedArtifacts.testlib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("shared-artifact watchdog (upgrade-window)", () => {
  it("every non-log shared artifact has a covering test file OR a version field", () => {
    const suiteFiles = new Set(readdirSync(HERE));
    const gaps: string[] = [];

    for (const a of SHARED_ARTIFACTS) {
      if (a.role === "log") continue; // diagnostics — not a protocol surface

      const hasVersion = a.versionField !== null && a.versionField.length > 0;
      const hasTest =
        a.coveredByTest !== null && suiteFiles.has(a.coveredByTest);

      if (!hasVersion && !hasTest) {
        gaps.push(
          `  - ${a.id} (${a.pathShape}): set coveredByTest to a file in ` +
            `packages/padi/src/upgradeWindow/ that pins mixed-version behavior, ` +
            `OR set versionField to the embedded version key. Why shared: ${a.why}`,
        );
      }

      // If a test is claimed, the file must exist (stale registry entry).
      if (a.coveredByTest !== null && !suiteFiles.has(a.coveredByTest)) {
        gaps.push(
          `  - ${a.id}: coveredByTest="${a.coveredByTest}" but that file is ` +
            `missing under packages/padi/src/upgradeWindow/`,
        );
      }
    }

    expect(
      gaps,
      gaps.length === 0
        ? undefined
        : `Shared artifacts missing mixed-version coverage:\n${gaps.join("\n")}\n\n` +
            `Add a test that pins the mixed-version window for each, register it in ` +
            `sharedArtifacts.testlib.ts, or declare the artifact's version field.`,
    ).toEqual([]);
  });

  it("the inventory is non-empty and includes the core gate/socket/session trio", () => {
    const ids = new Set(SHARED_ARTIFACTS.map((a) => a.id));
    expect(ids.has("kaval-gate")).toBe(true);
    expect(ids.has("kaval-socket")).toBe(true);
    expect(ids.has("padi-session-blob")).toBe(true);
    expect(ids.has("padi-state-root-config")).toBe(true);
    // Mutate-to-prove: deleting kaval-gate from the inventory fails this pin.
    expect(SHARED_ARTIFACTS.length).toBeGreaterThanOrEqual(6);
  });

  it("every claimed covering test file exists on disk", () => {
    for (const a of SHARED_ARTIFACTS) {
      if (a.coveredByTest === null) continue;
      const path = join(HERE, a.coveredByTest);
      expect(
        existsSync(path),
        `${a.id} claims ${a.coveredByTest} but ${path} is missing`,
      ).toBe(true);
    }
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
    writeFileSync(join(padiDir, "padi.sock"), "");
    writeFileSync(join(state, "config.json"), "{}");
    writeFileSync(join(state, "padi.log"), "");
    writeFileSync(join(state, "padi.log.1"), ""); // pino-roll generation
    writeFileSync(join(state, "padi.stderr.log"), "");

    expect(unknownProtocolFilesOnDisk(runtime, state)).toEqual([]);

    // Plant an unregistered shared file — the exact miss a hand-list-only
    // watchdog cannot catch. The matcher must name it (relative path).
    writeFileSync(join(kavalDir, "kaval.gate.v2"), "format=2\n");
    const unknown = unknownProtocolFilesOnDisk(runtime, state);
    expect(unknown).toEqual([`kaval-deadbeef/kaval.gate.v2`]);
    expect(unknownSharedFileMessage(unknown)).toMatch(/kaval\.gate\.v2/);
    expect(unknownSharedFileMessage(unknown)).toMatch(/SHARED_ARTIFACTS/);
  });
});
