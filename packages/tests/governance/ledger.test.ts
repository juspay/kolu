import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScenarioInventory, ScenarioRevision } from "./inventory";
import {
  validateCollectedTests,
  validateLedger,
  type CoverageLedger,
} from "./ledger";

const revision: ScenarioRevision = {
  revisionId: "revision-old",
  scenarioKey: "scenario-one",
  feature: "features/one.feature",
  scenario: "one promise",
  kind: "scenario",
  tags: [],
  bodyHash: "hash",
  exampleRows: [],
  executions: 1,
  firstSeenSha: "sha",
};
const inventory: ScenarioInventory = { schemaVersion: 1, records: [revision] };
const validRetirement: CoverageLedger = {
  schemaVersion: 2,
  retirements: [
    {
      id: "one-promise",
      revisionId: revision.revisionId,
      action: "replace",
      status: "landed",
      promise: "the promise remains true",
      defectSurface: ["real-fs"],
      destinationLayer: "L3",
      replacements: [
        {
          file: "packages/example/src/example.test.ts",
          test: "replacement > catches the defect",
          lane: "unit",
          platforms: ["linux", "darwin"],
          realism: ["real-fs"],
          reviewEvidence: {
            file: "packages/example/src/example.mutation.test.ts",
            test: "fails when the watcher is disconnected",
            note: "review confirmed this test crosses the real watcher seam",
          },
        },
      ],
      survivorRevisionIds: [],
    },
  ],
};

test("a disappearing scenario requires a landed ledger row", () => {
  assert.throws(
    () => validateLedger(inventory, [], { schemaVersion: 2, retirements: [] }),
    /disappeared without a landed ledger row/,
  );
  assert.doesNotThrow(() => validateLedger(inventory, [], validRetirement));
});

test("a landed replacement requires human review evidence", () => {
  const withoutReviewEvidence = structuredClone(validRetirement);
  const proof = withoutReviewEvidence.retirements[0]?.replacements[0];
  if (proof) proof.reviewEvidence.note = "";
  assert.throws(
    () => validateLedger(inventory, [], withoutReviewEvidence),
    /reviewEvidence.note is empty/,
  );
});

test("a survivor must still be a current immutable revision", () => {
  const withMissingSurvivor = structuredClone(validRetirement);
  const entry = withMissingSurvivor.retirements[0];
  if (entry) {
    entry.replacements = [];
    entry.survivorRevisionIds = ["revision-missing"];
  }
  assert.throws(
    () => validateLedger(inventory, [], withMissingSurvivor),
    /survivor is not current/,
  );
});

test("replacement and review evidence names must resolve as collected tests", () => {
  const collected = new Map([
    [
      "packages/example/src/example.test.ts",
      new Set(["replacement > catches the defect"]),
    ],
    [
      "packages/example/src/example.mutation.test.ts",
      new Set(["fails when the watcher is disconnected"]),
    ],
  ]);
  assert.doesNotThrow(() =>
    validateCollectedTests(
      validRetirement,
      (file) => collected.get(file) ?? new Set(),
    ),
  );
  collected.get("packages/example/src/example.mutation.test.ts")?.clear();
  assert.throws(
    () =>
      validateCollectedTests(
        validRetirement,
        (file) => collected.get(file) ?? new Set(),
      ),
    /active Vitest test not collected/,
  );
});
