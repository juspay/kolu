/**
 * THIS PACKAGE IS VENDORED, AND VENDORED MEANS APPEND-ONLY.
 *
 * `@kolu/acp-client` is not kolu's private client.
 * [olai](https://github.com/juspay/olai) copies this directory out of a
 * content-addressed kolu pin and compiles it with its own `tsc`: its chat
 * panel holds every one of its conversations on this client, and its suites
 * spawn this package's fixture agents through `./testlib`.
 *
 * THE RULE, in one line: a name recorded in `sharedVocabulary.json` must still
 * be exported, and a member recorded there must still be declared. ADDING is
 * free — this is a floor, not a fence. REMOVING or RENAMING fails, and the fix
 * is never to edit the ledger quietly: it is to land the removal in olai
 * first, and only then drop the row here with that PR named in the commit.
 *
 * WHAT IS RECORDED is what olai's own source names, read out of its tree
 * rather than guessed: `make` and the `Agent` it returns, with every verb that
 * panel calls on it; `AgentEvent` and the fields it reads off one; `Stored`,
 * `AgentGone`, `Gone`, `StopReason`, `newestFirst` and `Handed`; the
 * `Memory`, `MemorySnapshot`, `MemoryFailure`, `Models` and `Probe`
 * interfaces olai implements and the option fields it supplies to `make`; and
 * on `./testlib`, `fixtureAgent` with the `QUEUES` and `SAYS_NOTHING` legs.
 *
 * A NEW REQUIRED OPTION OR EVENT MEMBER IS A REMOVAL IN DISGUISE — it breaks
 * every caller written before it existed — so a new one is declared optional,
 * and a new event member arrives as its own arm of the union rather than as a
 * field every arm must now carry.
 *
 * READ FROM THE SOURCE TEXT rather than from the module, because half of what
 * must not disappear is types, and types are invisible to `Object.keys`. The
 * regexes are deliberately literal: this repository pins TypeScript 7, whose
 * compiler API no longer offers `transpileModule`, and a parser is not worth
 * owning for a claim this shape. The two doors (`index.ts`, `testlib/index.ts`)
 * are read the same way, so a name a module still declares but an entry no
 * longer re-exports fails here too — a consumer imports the door, not the file.
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

/** Every `readonly` member declared in the file, flat across its interfaces
 *  and its event union. Flat on purpose: what a consumer reaches for is
 *  `event.armed`, and a member that moved between two arms is still there to
 *  be reached. */
const membersOf = (text: string): ReadonlySet<string> =>
  new Set(
    [...text.matchAll(/^\s+readonly\s+([A-Za-z_$][\w$]*)\??\s*[:(]/gm)].map(
      (match) => match[1] ?? "",
    ),
  );

const sourceOf = (file: string): string =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

describe("the client vocabulary olai also reads", () => {
  for (const [file, recorded] of Object.entries(ledger)) {
    describe(file, () => {
      test("every recorded export is still exported", () => {
        const live = exportsOf(sourceOf(file));
        const gone = recorded.exports.filter((name) => !live.has(name));
        // A failure here names exactly what an olai build would fail on, which
        // is the whole point of reading it in this repository instead.
        expect(gone, `${file} dropped exports olai reads`).toEqual([]);
      });

      test("every recorded member is still declared", () => {
        const live = membersOf(sourceOf(file));
        const gone = recorded.members.filter((name) => !live.has(name));
        expect(gone, `${file} dropped members olai reads`).toEqual([]);
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
