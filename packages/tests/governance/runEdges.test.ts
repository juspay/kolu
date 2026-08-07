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
  findRunAliases,
  hasBareRunImport,
  RUN_EDGE_ALLOWLIST,
  type RunEdge,
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

test("an aliased run function is caught — the dodge a call count cannot see", () => {
  // `const run = Effect.runPromise; run(program)` makes a run call with no
  // `Effect.run*(` text anywhere near it.
  assert.deepEqual(findRunAliases("const run = Effect.runPromise;\nrun(p);"), [
    "Effect.runPromise",
  ]);
  assert.deepEqual(findRunAliases("queue.push(NodeRuntime.runMain);"), [
    "NodeRuntime.runMain",
  ]);
  assert.deepEqual(findRunAliases("void fetch(u).then(Effect.runPromise);"), [
    "Effect.runPromise",
  ]);
});

test("the destructured spelling of the same dodge is caught", () => {
  assert.deepEqual(findRunAliases("const { runFork } = Effect;"), [
    "{ runFork } = Effect",
  ]);
  assert.deepEqual(findRunAliases("const { runPromise: go } = Effect;"), [
    "{ runPromise: go } = Effect",
  ]);
});

test("an ordinary call is NOT an alias, whatever follows the name", () => {
  assert.deepEqual(findRunAliases("Effect.runPromise(p);"), []);
  // `runPromise` is a prefix of `runPromiseExit`; without a word boundary the
  // scan would report this call as an alias of the shorter name.
  assert.deepEqual(findRunAliases("await Effect.runPromiseExit(p);"), []);
  assert.deepEqual(findRunAliases("Runtime.runSync(rt)(c);"), []);
  assert.deepEqual(findRunAliases("Effect.runPromise (p);"), []);
});

test("an alias NAMED in prose or quoted in a message is not committing it", () => {
  assert.deepEqual(
    findRunAliases("// `const run = Effect.runFork` is banned"),
    [],
  );
  assert.deepEqual(
    findRunAliases('throw new Error("const r = Effect.runSync");'),
    [],
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
      entry.path.startsWith("packages/") && /\.tsx?$/.test(entry.path),
      `${entry.path} is not a package source path`,
    );
    // A `*.test.ts` is out of scope by design (the runner IS its edge), so a row
    // for one would be a row that can never match.
    assert.ok(
      !/\.(test|test-d)\.tsx?$/.test(entry.path),
      `${entry.path} is a test file, which this scan does not cover`,
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
