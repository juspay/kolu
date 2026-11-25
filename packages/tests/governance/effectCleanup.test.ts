/**
 * The effect-cleanup ban's own gate. A scan is worth having only if it is
 * honest in BOTH directions, so each test here is a way this one could lie: a
 * halt-shaped arrow it might miss, and a legitimate spelling it might condemn.
 * The two shapes that actually shipped are used as fixtures in their REAL
 * pre-fix text — `PeekTerminal`'s `({ held, report }) => report(held)` and the
 * composer's close, driven from `CodeTab`'s close-on-navigate effect — because
 * a rule that does not catch the defects it was written for catches nothing.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  collectEffectCleanupHits,
  type EffectCleanupHit,
  findEffectCleanupHits,
  validateEffectCleanupHits,
} from "./effectCleanup";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const hits = (src: string): EffectCleanupHit[] => findEffectCleanupHits(src);

const withImport = (body: string): string =>
  `import { createEffect, onSettled } from "solid-js";\n${body}`;

test("catches the peek's held report — the arrow that halted the view", () => {
  // `050687d8f`'s pre-fix text. `report` is a signal setter handed down by both
  // callers, and a Solid 2 setter answers with the value it set, so this arrow
  // returns a boolean as the cleanup.
  const found = hits(
    withImport(
      [
        "createEffect(",
        "  () => ({ held: locked(), report: untrack(() => props.onHeld) }),",
        "  ({ held, report }) => report(held),",
        ");",
      ].join("\n"),
    ),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.call, "createEffect");
  assert.equal(found[0]?.line, 4);
});

test("catches the composer's close, the second live site", () => {
  // `6ffaf60be`: `close: () => setTarget(null)` answered with what the setter
  // answered, and `code-view/CodeTab.tsx` takes that as a cleanup.
  const found = hits(
    withImport(
      "createEffect(composerAnchor, () => composer.close(), { defer: true });",
    ),
  );
  assert.equal(found.length, 1);
  assert.match(found[0]?.text ?? "", /composer\.close\(\)/);
});

test("the braced form with an explicit `return cleanup` passes", () => {
  // The sanctioned way to hand back a cleanup — and the whole point of the
  // rule: "this returns a cleanup on purpose" is now visible to a reader.
  assert.equal(
    hits(
      withImport(
        [
          "createEffect(",
          "  () => shown(),",
          "  (isShown) => {",
          "    return isShown ? holdConductorScreen(ref) : undefined;",
          "  },",
          ");",
        ].join("\n"),
      ),
    ).length,
    0,
  );
  // A braced body that returns NOTHING passes for the same reason.
  assert.equal(
    hits(withImport("createEffect(held, (held) => {\n  report(held);\n});"))
      .length,
    0,
  );
});

test("the compute arm is NOT a position — a concise body there is the normal spelling", () => {
  assert.equal(
    hits(withImport("createEffect(() => shown(), (v) => { use(v); });")).length,
    0,
  );
});

test("catches the other positions: createRenderEffect, createTrackedEffect, createReaction, onSettled", () => {
  assert.equal(
    hits(
      [
        'import { createRenderEffect } from "solid-js";',
        "createRenderEffect(dep, (v) => apply(v));",
      ].join("\n"),
    ).length,
    1,
  );
  assert.equal(
    hits(
      [
        'import { createTrackedEffect } from "@solidjs/signals";',
        "createTrackedEffect(() => paint(el()));",
      ].join("\n"),
    ).length,
    1,
  );
  assert.equal(
    hits(
      [
        'import { createReaction } from "solid-js";',
        "const track = createReaction(() => refit());",
      ].join("\n"),
    ).length,
    1,
  );
  assert.equal(hits(withImport("onSettled(() => el?.focus());")).length, 1);
});

test("matches the IMPORT, not the name — a parameter called `onSettled` is untouched", () => {
  // `terminal/splitPanelState.ts` takes an `onSettled: (ok: boolean) => void`
  // callback of its own. A name-matching scan would condemn every call of it.
  assert.equal(
    hits(
      [
        "function persist(id, state, onSettled) {",
        "  run(() => onSettled(true));",
        "}",
        "persist(id, state, (ok) => setSaved(ok));",
      ].join("\n"),
    ).length,
    0,
  );
  // Nor is a same-named export from somewhere else a position.
  assert.equal(
    hits(
      [
        'import { createEffect } from "./myOwnScheduler";',
        "createEffect(dep, (v) => apply(v));",
      ].join("\n"),
    ).length,
    0,
  );
});

test("follows a renamed import", () => {
  assert.equal(
    hits(
      [
        'import { createEffect as fx } from "solid-js";',
        "fx(dep, (v) => apply(v));",
      ].join("\n"),
    ).length,
    1,
  );
});

test("reads the destructured dynamic import too", () => {
  assert.equal(
    hits(
      [
        // The spelling `conductor/LivePane.test.tsx` uses.
        'const { onSettled } = await import("solid-js");',
        "onSettled(() => tearDown());",
      ].join("\n"),
    ).length,
    1,
  );
});

test("does NOT read a method call on an object that merely shares the name", () => {
  assert.equal(
    hits(withImport("scheduler.createEffect(dep, (v) => apply(v));")).length,
    0,
  );
});

test("does NOT flag an apply arm passed as a named reference", () => {
  // Outside what a lexical scan can know, and said so in the header.
  assert.equal(hits(withImport("createEffect(dep, applyIt);")).length, 0);
});

test("does NOT flag the ban NAMED in prose or quoted in a message", () => {
  assert.equal(
    hits(withImport("// createEffect(dep, (v) => report(v)) is banned")).length,
    0,
  );
  assert.equal(
    hits(withImport('throw new Error("createEffect(d, (v) => f(v))");')).length,
    0,
  );
});

test("reports the 1-based line of the arrow and names the call in the failure", () => {
  const found = hits(withImport("\ncreateEffect(dep, (v) => apply(v));"));
  assert.equal(found[0]?.line, 3);
  assert.doesNotThrow(() => validateEffectCleanupHits([]));
  assert.throws(
    () =>
      validateEffectCleanupHits([
        {
          path: "packages/x/src/a.tsx",
          line: 7,
          call: "createEffect",
          text: "({ held, report }) => report(held)",
        },
      ]),
    /packages\/x\/src\/a\.tsx:7/,
  );
});

test("the real tree is clean", () => {
  // The scan over `packages/` and `website/` as they stand: every apply arm is
  // braced, and the three that return a cleanup say `return`.
  assert.deepEqual(collectEffectCleanupHits(repoRoot), []);
});
