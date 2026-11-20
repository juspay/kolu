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

describe("the client vocabulary olai also reads", () => {
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
