import { describe, expect, it } from "vitest";
import type { SharedArtifact } from "./sharedArtifact.ts";
import {
  createSharedArtifactWatchdog,
  executeVersionDispositionProof,
} from "./upgradeWindowArtifacts.testlib.ts";

const versionedArtifact = {
  id: "state-config",
  pathShape: "<stateRoot>/config.json",
  role: "config",
  coveredByTest: "state-config.test.ts",
  versionField: "formatVersion",
  versionDisposition: "newer-version",
  diskBasenames: ["config.json"],
  diskBasenamePatterns: [],
  why: "Framework fixture for a versioned shared artifact.",
} as const satisfies SharedArtifact;

const proofOptions = {
  artifact: versionedArtifact,
  newerVersion: "2",
  plant: () => {},
  readPlantedVersion: () => "2",
};

describe("version-disposition proofs", () => {
  it("reports a gap when a versioned artifact has no executed proof", () => {
    const watchdog = createSharedArtifactWatchdog([versionedArtifact]);

    expect(watchdog.coverageGaps(new Set(["state-config.test.ts"]))).toEqual([
      "state-config: versionField=formatVersion has no executed version+1 disposition proof for newer-version",
    ]);
  });

  it("refuses a no-op disposition observation", async () => {
    await expect(
      executeVersionDispositionProof({
        ...proofOptions,
        observeDisposition: () => {},
      }),
    ).rejects.toThrow(
      'observed version+1 disposition undefined, expected registry declaration "newer-version"',
    );
  });

  it("refuses a disposition kind that differs from the registry", async () => {
    await expect(
      executeVersionDispositionProof({
        ...proofOptions,
        observeDisposition: () => ({ kind: "reset" }),
      }),
    ).rejects.toThrow(
      'observed version+1 disposition "reset", expected registry declaration "newer-version"',
    );
  });
});
