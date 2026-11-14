/**
 * The case-collision gate's own gate. Each test is a way the scan could miss a
 * pair a Mac folds into one file, or flag a pair it does not.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { findCaseCollisions, validateCaseCollisions } from "./caseCollisions";

test("a component and a module that differ only by case collide", () => {
  // The pair #2364 shipped: green on Linux, unbuildable on macOS.
  assert.deepEqual(
    findCaseCollisions([
      "src/conductor/ConductorStatus.tsx",
      "src/conductor/conductorStatus.ts",
      "src/conductor/statusReadout.ts",
    ]),
    [["src/conductor/ConductorStatus.tsx", "src/conductor/conductorStatus.ts"]],
  );
});

test("their tests collide too, and are reported as their own group", () => {
  assert.deepEqual(
    findCaseCollisions([
      "src/ConductorStatus.test.tsx",
      "src/ConductorStatus.tsx",
      "src/conductorStatus.test.ts",
    ]),
    [["src/ConductorStatus.test.tsx", "src/conductorStatus.test.ts"]],
  );
});

test("directories that differ only by case are the same directory on a Mac", () => {
  assert.deepEqual(findCaseCollisions(["a/Foo/bar.ts", "a/foo/bar.ts"]), [
    ["a/Foo/bar.ts", "a/foo/bar.ts"],
  ]);
});

test("one stem under two module extensions is an ambiguous import", () => {
  assert.deepEqual(findCaseCollisions(["x/foo.ts", "x/foo.tsx"]), [
    ["x/foo.ts", "x/foo.tsx"],
  ]);
});

test("a module beside a stylesheet or a doc of its name is not a collision", () => {
  assert.deepEqual(
    findCaseCollisions([
      "x/Theme.ts",
      "x/theme.css",
      "x/THEME.md",
      "y/Theme.ts",
    ]),
    [],
  );
});

test("the error names every colliding pair", () => {
  assert.throws(
    () =>
      validateCaseCollisions([
        ["a/Foo.tsx", "a/foo.ts"],
        ["b/Bar.tsx", "b/bar.ts"],
      ]),
    (error: Error) =>
      error.message.includes("a/Foo.tsx") && error.message.includes("b/bar.ts"),
  );
});
