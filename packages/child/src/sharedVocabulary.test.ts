/**
 * THIS PACKAGE IS VENDORED, AND VENDORED MEANS APPEND-ONLY.
 *
 * `@kolu/child` is not kolu's private socket onto a subprocess.
 * [olai](https://github.com/juspay/olai) copies this directory out of a
 * content-addressed kolu pin and compiles it with its own `tsc`, and every
 * process olai starts comes through it: its `git`, the browser's chromium, the
 * ACP adapter under its chat, its server tests and its web build.
 *
 * THE RULE, in one line: a name recorded in `sharedVocabulary.json` must still
 * be exported, and a member recorded there must still be declared. ADDING is
 * free — this is a floor, not a fence. REMOVING or RENAMING fails, and the fix
 * is never to edit the ledger quietly: it is to land the removal in olai
 * first, and only then drop the row here with that PR named in the commit.
 *
 * WHAT IS RECORDED is what olai's own source names, read out of its tree
 * rather than guessed: `start`, `run`, `childEnvOf`, the `Child` interface and
 * the `Hung` error, plus the option fields (`cwd`, `env`, `stdio`, `drain`,
 * `processGroup`, `maxBuffer`, `timeout`, `graceMs`) and the answers it reads
 * off a child or a one-shot (`said`, `out`, `err`, `ok`, `code`, `pid`,
 * `exitCode`, `closed`, `unstartable`, `wait`, `stop`, `kill`, the raw
 * `stdio` slots). A new REQUIRED option would be a removal in disguise — it
 * breaks every caller written before it — so a new one is optional.
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

const declaredIn = (text: string): ReadonlyArray<string> =>
  [
    ...text.matchAll(
      /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|const|let|function|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ].map((match) => match[1] ?? "");

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

const membersOf = (text: string): ReadonlySet<string> =>
  new Set(
    [...text.matchAll(/^\s+readonly\s+([A-Za-z_$][\w$]*)\??\s*[:(]/gm)].map(
      (match) => match[1] ?? "",
    ),
  );

const sourceOf = (file: string): string =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

describe("the subprocess socket olai also runs", () => {
  for (const [file, recorded] of Object.entries(ledger)) {
    describe(file, () => {
      test("every recorded export is still exported", () => {
        const live = exportsOf(sourceOf(file));
        const gone = recorded.exports.filter((name) => !live.has(name));
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
    for (const file of Object.keys(ledger)) {
      expect(
        () => sourceOf(file),
        `${file} is gone from this package`,
      ).not.toThrow();
    }
  });
});
