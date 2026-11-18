/**
 * THIS PACKAGE IS VENDORED, AND VENDORED MEANS APPEND-ONLY.
 *
 * `@kolu/acp-harness` is not kolu's private conversation.
 * [olai](https://github.com/juspay/olai) copies this directory out of a
 * content-addressed kolu pin and compiles it with its own `tsc`.
 *
 * OLAI DOES NOT IMPORT IT YET, and this ledger says so rather than pretending
 * otherwise: what is recorded is the DOOR olai will come through — everything
 * `index.ts` hands out — plus the options it will pass, the state it will draw
 * and the verbs it will call, which are the three things a panel touches. The
 * other ledgers in this tree record names read out of olai's source; this one
 * records a promise this repository is making ahead of the consumer, and the
 * two kinds of row are not to be confused. When olai's panel lands on this
 * harness, the names it does not import are still promised: the ledger stays a
 * floor, and a row is dropped only the way every other one is.
 *
 * THE RULE, in one line: a name recorded in `sharedVocabulary.json` must still
 * be exported, and a member recorded there must still be declared. ADDING is
 * free — this is a floor, not a fence. REMOVING or RENAMING fails, and the fix
 * is never to edit the ledger quietly: it is to check olai's tree, land the
 * removal there first, and only then drop the row here with that PR named in
 * the commit.
 *
 * THE OPTIONS ARE WHERE THE TWO PRODUCTS DIFFER, so they are the half most
 * worth holding: `whenNewSession`, `whenLoadRefused` and `whenReplayed` each
 * have one arm kolu takes and one arm olai takes, `readCall` is where a
 * product writes its own half of a tool row, and `taught` is the one fact a
 * caller has to remember for the harness that replaces this one. A NEW
 * REQUIRED OPTION IS A REMOVAL IN DISGUISE — it breaks every caller written
 * before it existed — so a new one is declared optional, or arrives with the
 * arm the older caller already meant.
 *
 * READ FROM THE SOURCE TEXT rather than from the module, because half of what
 * must not disappear is types, and types are invisible to `Object.keys`. The
 * regexes are deliberately literal: this repository pins TypeScript 7, whose
 * compiler API no longer offers `transpileModule`, and a parser is not worth
 * owning for a claim this shape. The door (`index.ts`) is read the same way,
 * so a name a module still declares but the entry no longer re-exports fails
 * here too — a consumer imports the door, not the file.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import ledger from "./sharedVocabulary.json" with { type: "json" };

/** Every top-level `export` DECLARATION's name — values and types alike, which
 *  is the half a runtime inventory cannot see. */
const declaredIn = (text: string): ReadonlyArray<string> =>
  [
    ...text.matchAll(
      /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|const|let|function|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ].map((match) => match[1] ?? "");

/** ... and every name an `export { … }` list hands out, under the name the
 *  list hands it out AS, which is what an importer spells. */
const listedIn = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((part) => {
        const name = part.trim().replace(/^type\s+/, "");
        const renamed = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(name);
        return renamed === null ? name : (renamed[1] ?? "");
      })
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name)),
  );

const exportsOf = (text: string): ReadonlySet<string> =>
  new Set([...declaredIn(text), ...listedIn(text)]);

/** Every member declared in the file: a `readonly` field, and a VERB, which on
 *  this door is a call signature rather than a field (`cancel(): Promise<…>`).
 *  Flat across the interfaces, because what a consumer reaches for is
 *  `harness.cancel`, and a member that moved between two of them is still
 *  there to be reached. */
const membersOf = (text: string): ReadonlySet<string> =>
  new Set([
    ...[...text.matchAll(/^\s+readonly\s+([A-Za-z_$][\w$]*)\??\s*[:(]/gm)].map(
      (match) => match[1] ?? "",
    ),
    ...[...text.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\(/gm)].map(
      (match) => match[1] ?? "",
    ),
  ]);

const sourceOf = (file: string): string =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

describe("the conversation vocabulary olai will read", () => {
  for (const [file, recorded] of Object.entries(ledger)) {
    describe(file, () => {
      test("every recorded export is still exported", () => {
        const live = exportsOf(sourceOf(file));
        const gone = recorded.exports.filter((name) => !live.has(name));
        // A failure here names exactly what an olai build would fail on, which
        // is the whole point of reading it in this repository instead.
        expect(gone, `${file} dropped exports olai is promised`).toEqual([]);
      });

      test("every recorded member is still declared", () => {
        const live = membersOf(sourceOf(file));
        const gone = recorded.members.filter((name) => !live.has(name));
        expect(gone, `${file} dropped members olai is promised`).toEqual([]);
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
