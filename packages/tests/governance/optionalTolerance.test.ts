/**
 * The tolerance allowlist's own gate. The list is only worth anything if the
 * SCANNER is honest, so each test here is a way the count could lie: the strict
 * spelling mistaken for the tolerant one, a shim named in prose, an alias
 * import, a second field added to an already-listed file, a row left behind
 * after its field was tightened, and the bare-import dodge.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countOptionalCalls,
  hasBareOptionalImport,
  OPTIONAL_TOLERANCE_ALLOWLIST,
  type OptionalToleranceSite,
  validateOptionalTolerance,
} from "./optionalTolerance";

test("counts the tolerant spelling and never the strict one", () => {
  assert.equal(
    countOptionalCalls(
      [
        "const S = Schema.Struct({",
        "  a: Schema.optionalKey(Schema.String),",
        "  b: Schema.optional(Schema.Int),",
        "});",
      ].join("\n"),
    ),
    1,
  );
});

test("an alias namespace cannot dodge the count", () => {
  assert.equal(countOptionalCalls("x: S.optional(S.String),"), 1);
});

test("ignores a shim named in a comment or quoted in a message", () => {
  assert.equal(
    countOptionalCalls(
      [
        "// `Schema.optional(...)` tolerates a present-`undefined` key.",
        'const hint = "use Schema.optional( only where forwarding forces it";',
      ].join("\n"),
    ),
    0,
  );
});

test("a bare named import of `optional` is caught, a namespaced one is not", () => {
  assert.ok(hasBareOptionalImport('import { optional } from "effect/Schema";'));
  assert.ok(!hasBareOptionalImport('import { Schema } from "effect";'));
  assert.ok(
    !hasBareOptionalImport('import { optionalKey } from "effect/Schema";'),
  );
  assert.ok(
    !hasBareOptionalImport('// import { optional } from "effect" would dodge'),
  );
});

test("the dodge quoted in a literal is not the dodge committed", () => {
  // This scan covers test files, and THIS file quotes the import above in order
  // to prove it is caught — so a string-literal match would fail the repo scan
  // on its own gate. It did, once.
  assert.ok(
    !hasBareOptionalImport(
      "assert.ok(check('import { optional } from \"effect/Schema\";'));",
    ),
  );
});

const allowlist: readonly OptionalToleranceSite[] = [
  { path: "packages/a/src/wire.ts", sites: 1, why: "the value is forwarded" },
];

test("an exact match passes", () => {
  validateOptionalTolerance(
    new Map([["packages/a/src/wire.ts", 1]]),
    allowlist,
  );
});

test("an unlisted file fails, and names `optionalKey` as the fix", () => {
  assert.throws(
    () =>
      validateOptionalTolerance(
        new Map([
          ["packages/a/src/wire.ts", 1],
          ["packages/a/src/other.ts", 1],
        ]),
        allowlist,
      ),
    /packages\/a\/src\/other\.ts .*NOT on the allowlist.*optionalKey/s,
  );
});

test("a SECOND shim added to an already-listed file fails", () => {
  assert.throws(
    () =>
      validateOptionalTolerance(
        new Map([["packages/a/src/wire.ts", 2]]),
        allowlist,
      ),
    /declares 2 `optional` field\(s\); the allowlist says 1/,
  );
});

test("a row whose field was tightened fails, so the list cannot rot", () => {
  assert.throws(
    () => validateOptionalTolerance(new Map(), allowlist),
    /allowlisted for 1 `optional` field\(s\) but has none/,
  );
});

test("every committed row carries a path, a positive count and a justification", () => {
  for (const entry of OPTIONAL_TOLERANCE_ALLOWLIST) {
    assert.ok(
      entry.path.startsWith("packages/") && entry.path.includes("/src/"),
      `${entry.path} is not a package source path`,
    );
    assert.ok(entry.sites > 0, `${entry.path} claims no sites`);
    assert.ok(
      entry.why.length > 20,
      `${entry.path} has no real justification: ${entry.why}`,
    );
  }
  const paths = OPTIONAL_TOLERANCE_ALLOWLIST.map((e) => e.path);
  assert.deepEqual(paths, [...paths].sort(), "allowlist is not sorted by path");
  assert.equal(new Set(paths).size, paths.length, "duplicate allowlist path");
});
