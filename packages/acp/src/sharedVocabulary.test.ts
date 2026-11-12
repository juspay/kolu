/**
 * THIS PACKAGE IS SHARED, AND SHARED MEANS APPEND-ONLY.
 *
 * `@kolu/acp` is not kolu's private vocabulary. It is vendored as raw
 * TypeScript by [olai](https://github.com/juspay/olai) through its
 * `nix/consumer.nix`, and olai's chat plugin reads parts of it that kolu's own
 * orchestrator never touches — `nativeActivity`, `terminalMetaIn`,
 * `Steering`, `Leg.steering`, `Leg.queues`. kolu is therefore a SUPERSET
 * keeper, not an owner: every name here has at least one consumer, and the
 * ones this repository does not call are not dead — they are somebody else's
 * live wire.
 *
 * THE DEFECT THIS EXISTS FOR actually happened, in this package, in review:
 * "ported surface with no consumer" was read as a *kolu* question, three files
 * and five `Leg` members were deleted as dead, and nothing in the tree went
 * red because nothing in the tree used them. A type-level contract with an
 * out-of-tree consumer has no compiler watching it, so it gets a test instead.
 *
 * THE RULE, in one line: a name recorded in `sharedVocabulary.json` must still
 * be exported, and a member recorded there must still be declared. ADDING is
 * free — this is a floor, not a fence, and a new reading or a new optional
 * member breaks nobody. REMOVING or RENAMING fails, and the fix is never to
 * edit the ledger quietly: it is to check olai's tree, land the removal THERE
 * first, and only then drop the row here with that PR named in the commit.
 *
 * A NEW REQUIRED MEMBER on an exported interface is a removal in disguise — it
 * breaks every leg written before it — so it is declared optional, which is
 * why `ModelReading.windowIn` carries a `?` it would not otherwise need.
 *
 * READ FROM THE SOURCE TEXT rather than from the module, because half of what
 * must not disappear is types, and types are invisible to `Object.keys`. The
 * regexes below are deliberately literal: this repository pins TypeScript 7,
 * whose compiler API no longer offers `transpileModule`, and a parser is not
 * worth owning for a claim this shape.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import ledger from "./sharedVocabulary.json" with { type: "json" };

/** Every top-level `export` DECLARATION's name — values and types alike, which
 *  is the half a runtime inventory cannot see. */
const exportsOf = (text: string): ReadonlySet<string> =>
  new Set(
    [
      ...text.matchAll(
        /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|const|let|function|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
      ),
    ].map((match) => match[1] ?? ""),
  );

/** ... and every `readonly` member declared in the file, flat across its
 *  interfaces. Flat on purpose: what a consumer reaches for is
 *  `leg.steering`, and a member that moved between two interfaces in this
 *  package is still there to be reached. A member that is GONE is the thing
 *  this catches, and it catches it wherever it was declared. */
const membersOf = (text: string): ReadonlySet<string> =>
  new Set(
    [...text.matchAll(/^\s+readonly\s+([A-Za-z_$][\w$]*)\??\s*[:(]/gm)].map(
      (match) => match[1] ?? "",
    ),
  );

const sourceOf = (file: string): string =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

describe("the shared vocabulary olai also reads", () => {
  for (const [file, recorded] of Object.entries(ledger)) {
    describe(file, () => {
      test("every recorded export is still exported", () => {
        const live = exportsOf(sourceOf(file));
        const gone = recorded.exports.filter((name) => !live.has(name));
        // The ledger is a FLOOR: this says nothing about names the file has
        // gained, only about ones it lost. A failure here names exactly what
        // an olai build would fail on, which is the whole point of reading it
        // in this repository instead of in that one.
        expect(gone, `${file} dropped exports olai may read`).toEqual([]);
      });

      test("every recorded member is still declared", () => {
        const live = membersOf(sourceOf(file));
        const gone = recorded.members.filter((name) => !live.has(name));
        expect(gone, `${file} dropped members olai may read`).toEqual([]);
      });
    });
  }

  test("the ledger names files that exist", () => {
    // A ledger row for a deleted file would otherwise throw a bare ENOENT from
    // the first assertion, which says "no such file" where the real sentence
    // is "this package deleted a module a consumer imports".
    for (const file of Object.keys(ledger)) {
      expect(
        () => sourceOf(file),
        `${file} is gone from this package`,
      ).not.toThrow();
    }
  });
});
