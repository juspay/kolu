/**
 * The conformance check's own gate. The real assertion runs against the live
 * tree in `check.ts` (it evaluates Nix), so what is pinned here is the part that
 * decides whether a disagreement is REPORTED: a walk that gained a member, a
 * walk that lost one, and the both-directions case — plus the refusal that keeps
 * a mistyped entry from reaching the Nix expression as an unreadable parse
 * error.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { nixClosureNames, validateClosureWalkAgreement } from "./closureWalk";

test("identical closures agree, whatever order they arrive in", () => {
  const names = ["@kolu/surface", "kolu-io", "kolu-shared"];
  validateClosureWalkAgreement(names, [...names].reverse());
});

test("a member only TS reaches is named — the daemon id would not hash it", () => {
  assert.throws(
    () => validateClosureWalkAgreement(["a"], ["a", "peer-only"]),
    /only TS:\s+peer-only/,
  );
  assert.throws(
    () => validateClosureWalkAgreement(["a"], ["a", "peer-only"]),
    /only nix: \(none\)/,
  );
});

test("a member only nix reaches is named — a consumer is never told to copy it", () => {
  assert.throws(
    () => validateClosureWalkAgreement(["a", "nix-only"], ["a"]),
    /only nix: nix-only/,
  );
});

test("both directions are reported at once, not one round at a time", () => {
  assert.throws(
    () => validateClosureWalkAgreement(["a", "x"], ["a", "y"]),
    /only nix: x\n\s*only TS:\s+y/,
  );
});

test("a non-package-name entry is refused before it reaches the nix expression", () => {
  assert.throws(
    () => nixClosureNames("/nowhere", ['" ++ evil ++ "']),
    /not package names/,
  );
});
