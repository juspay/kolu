/**
 * THIS PACKAGE IS SHARED, AND SHARED MEANS APPEND-ONLY.
 *
 * `@kolu/acp` is not kolu's private vocabulary. It is vendored as raw
 * TypeScript by [olai](https://github.com/juspay/olai) through its
 * `nix/consumer.nix`. kolu is a SUPERSET keeper, not an owner: the question is
 * never whether THIS repository calls a name, it is whether the other one
 * does, and only one of the two compilers is in reach when the answer changes.
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

const exportsOf = (text: string): ReadonlySet<string> =>
  new Set(
    [
      ...text.matchAll(
        /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|const|let|function|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
      ),
    ].map((match) => match[1] ?? ""),
  );

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
    for (const file of Object.keys(ledger)) {
      expect(
        () => sourceOf(file),
        `${file} is gone from this package`,
      ).not.toThrow();
    }
  });
});
