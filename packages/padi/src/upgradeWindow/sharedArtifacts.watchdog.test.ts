/**
 * Shared-artifact watchdog — every file both daemon generations touch must
 * either have a mixed-version test registered in the coverage manifest
 * (`sharedArtifacts.testlib.ts`) or declare an explicit version field. Adding
 * a new shared file to the inventory without either fails this test with a
 * message explaining what to do.
 *
 * Logs are exempt (diagnostics, not a protocol surface). Everything else
 * needs coverage.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SHARED_ARTIFACTS } from "./sharedArtifacts.testlib.ts";

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
});
