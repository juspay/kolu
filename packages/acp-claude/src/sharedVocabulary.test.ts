/**
 * THIS PACKAGE IS VENDORED, AND VENDORED MEANS APPEND-ONLY.
 *
 * `@kolu/acp-claude` is not kolu's private reading of the Claude Code agent.
 * [olai](https://github.com/juspay/olai) copies this directory out of a
 * content-addressed kolu pin and compiles it with its own `tsc`: its Claude
 * engine registers this leg, runs the adapter these Nix facts build, and reads
 * two things kolu's own conversation never does (`listedIn`'s stamps and
 * `terminalOutput`). kolu may add to this package; kolu may not take away —
 * there is no compiler in that repository to notice.
 *
 * THE RULE, in one line: a name recorded in `sharedVocabulary.json` must still
 * be exported, and a member recorded there must still be declared. ADDING is
 * free — this is a floor, not a fence. REMOVING or RENAMING fails, and the fix
 * is never to edit the ledger quietly: it is to land the removal in olai
 * first, and only then drop the row here with that PR named in the commit.
 *
 * WHAT IS RECORDED is what olai's own source names, read out of its tree
 * rather than guessed: `CLAUDE` (the leg it registers), `NAME` (the name a
 * person reads), `REMOTE_SIGNALS` (the variables its host strips) and
 * `spelling` (how a tool of an MCP server is named, which its test bench
 * composes with). `MODELS` is recorded because olai HAS no model table of its
 * own: the picker it draws is this one, reached through `CLAUDE.models`.
 *
 * `configDirIn` is not here. kolu alone calls it — olai's host decides where a
 * signature lives for itself — so it carries no promise to another repository,
 * and recording one it does not make would be a ledger that lies the other way.
 *
 * The LEG'S OWN MEMBERS are not recorded here either: `Leg` is declared by
 * `@kolu/acp`, whose `sharedVocabulary.json` records them (`listedIn`,
 * `terminalOutput`, `steering`, `queues` and the rest). One fact, one home.
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

/** ... and every `readonly` member declared in the file, flat across its
 *  interfaces, for a row that records one. */
const membersOf = (text: string): ReadonlySet<string> =>
  new Set(
    [...text.matchAll(/^\s+readonly\s+([A-Za-z_$][\w$]*)\??\s*[:(]/gm)].map(
      (match) => match[1] ?? "",
    ),
  );

const sourceOf = (file: string): string =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

describe("the Claude Code vocabulary olai also reads", () => {
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
