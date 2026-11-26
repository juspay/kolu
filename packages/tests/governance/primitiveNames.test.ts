/**
 * The unnamed-primitive ban's own gate. A scan is worth having only if it is
 * honest in BOTH directions, so each test here is a way this one could lie: a
 * nameless primitive it might miss, and a legitimate spelling it might
 * condemn. The fixtures are the real pre-fix text of the sites that folded
 * 5 549 dev-lane diagnostic events into one `—` / `computed` row —
 * `useWorks`'s `return createMemo(() => needsYou(works()))` and
 * `persistedPref`'s `createSignal` handed straight to `makePersisted` —
 * because a rule that does not catch the sites it was written for catches
 * nothing.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  collectPrimitiveNameHits,
  findPrimitiveNameHits,
  type PrimitiveNameHit,
  validatePrimitiveNameHits,
} from "./primitiveNames";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const hits = (src: string): PrimitiveNameHit[] => findPrimitiveNameHits(src);

const withImport = (body: string): string =>
  `import { createMemo, createSignal } from "solid-js";\n${body}`;

test("catches the works fold — a memo returned straight out of a factory", () => {
  const found = hits(
    withImport(
      [
        "export const useNeedsYou = () => {",
        "  return createMemo(() => needsYou(works()));",
        "};",
      ].join("\n"),
    ),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.call, "createMemo");
  assert.equal(found[0]?.line, 3);
});

test("catches a primitive passed as an argument — the `makePersisted` shape", () => {
  const found = hits(
    withImport(
      [
        "const [value, setValue] = makePersisted(",
        "  createSignal<T>(opts.fallback, { ownedWrite: true }),",
        "  { storage: opts.storage },",
        ");",
      ].join("\n"),
    ),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.call, "createSignal");
  assert.equal(found[0]?.line, 3);
});

test("catches a primitive in an object-literal property", () => {
  const found = hits(
    withImport("const facts = { used: createMemo(() => memoryUsed(rows())) };"),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.line, 2);
});

test("catches an assignment to an outer binding — no declarator there either", () => {
  const found = hits(
    withImport("let index;\nindex = createMemo(() => table());"),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.line, 3);
});

test("a declarator is the name: every binding spelling passes", () => {
  assert.deepEqual(
    hits(
      withImport(
        [
          "const [value, setValue] = createSignal(0);",
          "export const rows = createMemo(() => fold());",
          "let held: Accessor<number> = createMemo(() => n());",
          "const [a, setA] = createSignal<Thing | null>(",
          "  null,",
          ");",
        ].join("\n"),
      ),
    ),
    [],
  );
});

test("an explicit `{ name }` passes, in any argument position", () => {
  assert.deepEqual(
    hits(
      withImport(
        [
          "return createMemo(() => fold(), { name: 'rows' });",
          "foo(createSignal(0, { equals: false, name: 'cell' }));",
          "return createMemo(() => fold(), { loadingValue: null, name: 'q' });",
        ].join("\n"),
      ),
    ),
    [],
  );
});

test("the shorthand `{ name }` a caller-named factory passes counts too", () => {
  assert.deepEqual(
    hits(
      withImport(
        [
          "const mapOf = (bound, name) =>",
          "  createMemo(() => fold(bound), { name });",
        ].join("\n"),
      ),
    ),
    [],
  );
});

test("a near-miss property is NOT a name", () => {
  assert.equal(
    hits(withImport("return createMemo(() => fold(), { nameOf: 'rows' });"))
      .length,
    1,
  );
  assert.equal(
    hits(withImport("return createMemo(() => fold(), { equals: one.name });"))
      .length,
    1,
  );
});

test("matches the IMPORT, not the name — another `createStore` is untouched", () => {
  assert.deepEqual(
    hits(
      'import { createStore } from "zustand";\nreturn createStore(() => 1);',
    ),
    [],
  );
});

test("follows a renamed import", () => {
  const found = hits(
    'import { createMemo as memo } from "solid-js";\nreturn memo(() => fold());',
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.call, "createMemo");
});

test("reads `solid-js/store` and `@solidjs/signals` as Solid too", () => {
  assert.equal(
    hits(
      'import { createStore } from "solid-js/store";\nreturn createStore({});',
    ).length,
    1,
  );
  assert.equal(
    hits(
      'import { createSignal } from "@solidjs/signals";\nfoo(createSignal(0));',
    ).length,
    1,
  );
});

test("does NOT read a method call on an object that merely shares the name", () => {
  assert.deepEqual(
    hits(withImport("return store.createMemo(() => fold());")),
    [],
  );
});

test("does NOT flag the ban NAMED in prose or quoted in a message", () => {
  assert.deepEqual(
    hits(
      withImport(
        [
          "// A bare `return createMemo(() => fold())` has no name.",
          'throw new Error("return createMemo(() => fold()) needs a name");',
        ].join("\n"),
      ),
    ),
    [],
  );
});

test("reads a call with explicit type arguments", () => {
  const found = hits(
    withImport("return createMemo<TerminalId | null>((previous) => previous);"),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.call, "createMemo");
});

test("reports the 1-based line and names the call in the failure", () => {
  const found = hits(withImport("\n\nreturn createMemo(() => fold());"));
  assert.equal(found[0]?.line, 4);
  assert.throws(
    () =>
      validatePrimitiveNameHits([
        { ...(found[0] as PrimitiveNameHit), path: "a/b.ts" },
      ]),
    /a\/b\.ts:4\s+createMemo/,
  );
});

test("an empty hit list validates", () => {
  assert.doesNotThrow(() => validatePrimitiveNameHits([]));
});

test("the real tree is clean", () => {
  // The scan over `packages/` and `website/` as they stand: every primitive
  // without a declarator passes a name, so no dev-lane finding is addressed
  // to the bare kind.
  assert.deepEqual(collectPrimitiveNameHits(repoRoot), []);
});
