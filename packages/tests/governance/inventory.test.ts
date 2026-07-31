import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendCurrentRevisions,
  assertAppendOnly,
  parseFeature,
  type ScenarioInventory,
} from "./inventory";

const feature = (examples: string) => `Feature: contracts
  Background:
    Given shared setup

  Scenario Outline: promise [<mode>]
    When I use <mode>
    Then it works

    Examples:
      | mode |
${examples}
`;

test("scenario revisions fingerprint expanded example values, not only row counts", () => {
  const first = parseFeature(
    "features/contracts.feature",
    feature("      | local |\n      | branch |"),
    "abc",
  ).records[0];
  const changed = parseFeature(
    "features/contracts.feature",
    feature("      | local |\n      | browse |"),
    "def",
  ).records[0];
  assert.equal(first?.exampleRows.length, 2);
  assert.equal(changed?.exampleRows.length, 2);
  assert.equal(first?.scenarioKey, changed?.scenarioKey);
  assert.notEqual(first?.bodyHash, changed?.bodyHash);
  assert.notEqual(first?.revisionId, changed?.revisionId);
});

test("scenario revisions fingerprint backgrounds and executable steps", () => {
  const original = parseFeature(
    "features/contracts.feature",
    feature("      | local |"),
    "abc",
  ).records[0];
  const weakened = parseFeature(
    "features/contracts.feature",
    feature("      | local |").replace(
      "Then it works",
      "Then nothing is asserted",
    ),
    "def",
  ).records[0];
  assert.equal(original?.scenarioKey, weakened?.scenarioKey);
  assert.notEqual(original?.revisionId, weakened?.revisionId);
});

test("inventory updates append new revisions without rewriting history", () => {
  const first = parseFeature(
    "features/contracts.feature",
    feature("      | local |"),
    "abc",
  ).records[0];
  assert.ok(first);
  const base: ScenarioInventory = { schemaVersion: 1, records: [first] };
  const nextRevision = parseFeature(
    "features/contracts.feature",
    feature("      | browse |"),
    "def",
  ).records[0];
  assert.ok(nextRevision);
  const next = appendCurrentRevisions(base, [nextRevision]);
  assert.equal(next.records.length, 2);
  assert.deepEqual(next.records[0], first);
  assert.doesNotThrow(() => assertAppendOnly(base, next));
  const mutated = structuredClone(next);
  if (mutated.records[0]) mutated.records[0].scenario = "rewritten history";
  assert.throws(() => assertAppendOnly(base, mutated), /mutated/);
  assert.throws(
    () => assertAppendOnly(base, { schemaVersion: 1, records: [] }),
    /removed/,
  );
});
