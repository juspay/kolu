/**
 * The run-edge allowlist's own gate. The allowlist is only worth anything if the
 * SCANNER is honest, so each test here is a way the count could lie:
 * a run call named in prose, one quoted in a message, a second call added to an
 * already-listed file, a row left behind after its call site went away, and the
 * bare-import dodge the namespaced regex cannot see.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankNonCode,
  countRunCalls,
  hasBareRunImport,
  type RunEdge,
  RUN_EDGE_ALLOWLIST,
  validateRunEdges,
} from "./runEdges";

test("counts a real call and ignores one named in a line comment", () => {
  assert.equal(
    countRunCalls(
      [
        "// `Effect.runPromise(_, { signal })` interrupts the read's fiber.",
        "const x = Effect.runPromise(program);",
      ].join("\n"),
    ),
    1,
  );
});

test("ignores a call named in a block comment, however many parens it carries", () => {
  assert.equal(
    countRunCalls(
      [
        "/** The ONE edge: `Effect.runFork(pump)` plus `Effect.runPromise(close())`.",
        " *  Everything else composes. */",
        "export const stop = () => Effect.runSync(unit);",
      ].join("\n"),
    ),
    1,
  );
});

test("ignores a call quoted in a string or template literal", () => {
  assert.equal(
    countRunCalls(
      [
        'const hint = "use Effect.runPromise( only at an edge";',
        "const other = `and never Effect.runFork( in a helper`;",
      ].join("\n"),
    ),
    0,
  );
});

test("a `//` inside a string does not swallow the rest of the line", () => {
  // The regex version of this scanner blanked from the first `//` to the end of
  // line, so a URL literal hid every call that followed it on that line.
  assert.equal(
    countRunCalls('const u = "https://example.test"; Effect.runFork(p);'),
    1,
  );
});

test("a quote inside a comment does not open a string", () => {
  assert.equal(
    countRunCalls(
      ["// don't count this one: Effect.runSync(x)", "Effect.runSync(y);"].join(
        "\n",
      ),
    ),
    1,
  );
});

test("blanking preserves line structure, so positions still line up", () => {
  const source = "// gone\nkeep;\n/* also\ngone */ keep2;";
  const blanked = blankNonCode(source);
  assert.equal(blanked.split("\n").length, source.split("\n").length);
  assert.ok(blanked.includes("keep;"));
  assert.ok(blanked.includes("keep2;"));
});

test("counts every namespace the runtime is reached through", () => {
  assert.equal(
    countRunCalls(
      [
        "Effect.runPromise(a);",
        "NodeRuntime.runMain(b);",
        "Runtime.runSync(rt)(c);",
      ].join("\n"),
    ),
    3,
  );
});

test("a bare named import of a run helper is caught, a namespaced one is not", () => {
  assert.ok(hasBareRunImport('import { runPromise } from "effect/Effect";'));
  assert.ok(!hasBareRunImport('import { Effect, Stream } from "effect";'));
  // Named in prose, not imported.
  assert.ok(
    !hasBareRunImport('// import { runFork } from "effect" would dodge this'),
  );
});

const allowlist: readonly RunEdge[] = [
  { path: "packages/a/src/edge.ts", sites: 1, why: "the process edge" },
];

test("an exact match passes", () => {
  validateRunEdges(new Map([["packages/a/src/edge.ts", 1]]), allowlist);
});

test("an unlisted file fails, and says composing is the fix", () => {
  assert.throws(
    () =>
      validateRunEdges(
        new Map([
          ["packages/a/src/edge.ts", 1],
          ["packages/a/src/helper.ts", 1],
        ]),
        allowlist,
      ),
    /packages\/a\/src\/helper\.ts .*NOT on the allowlist.*compose the effect/s,
  );
});

test("a SECOND run added to an already-listed file fails", () => {
  assert.throws(
    () => validateRunEdges(new Map([["packages/a/src/edge.ts", 2]]), allowlist),
    /runs 2 effect\(s\); the allowlist says 1/,
  );
});

test("a row whose call site went away fails, so the list cannot rot", () => {
  assert.throws(
    () => validateRunEdges(new Map(), allowlist),
    /allowlisted for 1 run edge\(s\) but has none/,
  );
});

test("every committed row carries a path, a positive count and a justification", () => {
  for (const entry of RUN_EDGE_ALLOWLIST) {
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
  const paths = RUN_EDGE_ALLOWLIST.map((e) => e.path);
  assert.deepEqual(paths, [...paths].sort(), "allowlist is not sorted by path");
  assert.equal(new Set(paths).size, paths.length, "duplicate allowlist path");
});
