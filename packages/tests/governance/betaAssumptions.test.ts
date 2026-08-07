/**
 * The beta-assumption registry's own gate. The registry is only worth anything
 * if a pin bump really does turn it red, so each test here is a way it could
 * fail to: a stale stamp read as current, a bump that never reaches the tag, a
 * marker emptied of its claim, and a site whose marker was deleted along with
 * the reasoning.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assumptionTag,
  type BetaAssumption,
  BETA_ASSUMPTION_SITES,
  findBetaAssumptions,
  validateBetaAssumptions,
} from "./betaAssumptions";

const V = "4.0.0-beta.102";
const MARKER = `BETA-ASSUMPTION(beta.102):`;
const CLAIM = "the ping interval is 5 s and two unanswered pings kill it";

const hit = (over: Partial<BetaAssumption> = {}): BetaAssumption => ({
  path: "packages/padi/src/vocab.ts",
  line: 12,
  tag: "beta.102",
  text: CLAIM,
  ...over,
});

test("the tag is the pin's prerelease, so a bump moves it", () => {
  assert.equal(assumptionTag("4.0.0-beta.102"), "beta.102");
  assert.equal(assumptionTag("4.0.0-beta.103"), "beta.103");
  // Leaving beta trips every marker too — the behavior needs re-measuring most
  // of all at the release that stops being a beta.
  assert.equal(assumptionTag("4.0.0"), "4.0.0");
});

test("a marker is read out of the comment it lives in, with its line", () => {
  const found = findBetaAssumptions(
    ["/**", ` * ${MARKER} ${CLAIM}.`, " */", "const x = 1;"].join("\n"),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.line, 2);
  assert.equal(found[0]?.tag, "beta.102");
  assert.equal(found[0]?.text, `${CLAIM}.`);
});

test("prose that merely mentions the pin is not a marker", () => {
  assert.equal(
    findBetaAssumptions("// measured against effect@4.0.0-beta.102").length,
    0,
  );
});

test("a stamped tree passes", () => {
  assert.doesNotThrow(() =>
    validateBetaAssumptions(
      BETA_ASSUMPTION_SITES.map((path) => hit({ path })),
      V,
      BETA_ASSUMPTION_SITES,
    ),
  );
});

test("bumping the pin fails every marker until each is re-verified", () => {
  assert.throws(
    () =>
      validateBetaAssumptions(
        BETA_ASSUMPTION_SITES.map((path) => hit({ path })),
        "4.0.0-beta.103",
        BETA_ASSUMPTION_SITES,
      ),
    /stamped beta\.102, but the pin is now 4\.0\.0-beta\.103.*Re-measure/s,
  );
});

test("a marker stamped AHEAD of the pin fails too — a stamp is not a wish", () => {
  assert.throws(
    () => validateBetaAssumptions([hit({ tag: "beta.103" })], V, []),
    /stamped beta\.103/,
  );
});

test("a marker with no claim on it fails — there would be nothing to re-verify", () => {
  assert.throws(
    () => validateBetaAssumptions([hit({ text: "" })], V, []),
    /states no assumption/,
  );
});

test("deleting a known site's marker fails, and says what the honest edit is", () => {
  assert.throws(
    () => validateBetaAssumptions([], V, ["packages/padi/src/vocab.ts"]),
    /carries no BETA-ASSUMPTION marker.*BETA_ASSUMPTION_SITES/s,
  );
});

test("every committed site is a package source path, sorted and unique", () => {
  for (const site of BETA_ASSUMPTION_SITES) {
    assert.ok(
      site.startsWith("packages/") && site.includes("/src/"),
      `${site} is not a package source path`,
    );
  }
  assert.deepEqual(
    [...BETA_ASSUMPTION_SITES],
    [...BETA_ASSUMPTION_SITES].sort(),
    "sites are not sorted",
  );
  assert.equal(
    new Set(BETA_ASSUMPTION_SITES).size,
    BETA_ASSUMPTION_SITES.length,
    "duplicate site",
  );
});
