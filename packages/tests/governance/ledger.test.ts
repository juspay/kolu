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
const survivor: ScenarioRevision = {
  ...revision,
  revisionId: "revision-survivor",
  scenarioKey: "scenario-survivor",
  scenario: "surviving browser journey",
};
const current = [survivor];
const inventory: ScenarioInventory = {
  schemaVersion: 1,
  records: [revision, survivor],
};
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
      survivorRevisionIds: [survivor.revisionId],
    },
  ],
};

test("a disappearing scenario requires a landed ledger row", () => {
  assert.throws(
    () =>
      validateLedger(inventory, current, {
        schemaVersion: 2,
        retirements: [],
      }),
    /disappeared without a landed ledger row/,
  );
  assert.doesNotThrow(() =>
    validateLedger(inventory, current, validRetirement),
  );
});

test("a landed replacement requires human review evidence", () => {
  const withoutReviewEvidence = structuredClone(validRetirement);
  const proof = withoutReviewEvidence.retirements[0]?.replacements[0];
  if (proof) proof.reviewEvidence.note = "";
  assert.throws(
    () => validateLedger(inventory, current, withoutReviewEvidence),
    /reviewEvidence.note is empty/,
  );
});

test("a landed replace action requires replacement evidence", () => {
  const withoutReplacement = structuredClone(validRetirement);
  const entry = withoutReplacement.retirements[0];
  if (entry) entry.replacements = [];
  assert.throws(
    () => validateLedger(inventory, current, withoutReplacement),
    /landed replacement action has no replacement evidence/,
  );
});

test("every landed retirement requires a current browser survivor", () => {
  const withoutSurvivor = structuredClone(validRetirement);
  const entry = withoutSurvivor.retirements[0];
  if (entry) entry.survivorRevisionIds = [];
  assert.throws(
    () => validateLedger(inventory, current, withoutSurvivor),
    /landed retirement has no browser survivor/,
  );
});

test("ledger enum fields are validated at runtime after YAML parsing", () => {
  const cases = [
    {
      field: "action",
      mutate: (ledger: CoverageLedger) => {
        const entry = ledger.retirements[0];
        if (entry) (entry as { action: string }).action = "typo";
      },
    },
    {
      field: "destinationLayer",
      mutate: (ledger: CoverageLedger) => {
        const entry = ledger.retirements[0];
        if (entry)
          (entry as { destinationLayer: string }).destinationLayer = "L99";
      },
    },
    {
      field: "replacement.lane",
      mutate: (ledger: CoverageLedger) => {
        const proof = ledger.retirements[0]?.replacements[0];
        if (proof) (proof as { lane: string }).lane = "browser-ish";
      },
    },
    {
      field: "replacement.platform",
      mutate: (ledger: CoverageLedger) => {
        const proof = ledger.retirements[0]?.replacements[0];
        if (proof) (proof as { platforms: string[] }).platforms = ["windows"];
      },
    },
  ];

  for (const { field, mutate } of cases) {
    const invalid = structuredClone(validRetirement);
    mutate(invalid);
    assert.throws(
      () => validateLedger(inventory, current, invalid),
      new RegExp(`invalid ${field}`),
    );
  }
});

test("a survivor must still be a current immutable revision", () => {
  const withMissingSurvivor = structuredClone(validRetirement);
  const entry = withMissingSurvivor.retirements[0];
  if (entry) {
    entry.survivorRevisionIds = ["revision-missing"];
  }
  assert.throws(
    () => validateLedger(inventory, current, withMissingSurvivor),
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
