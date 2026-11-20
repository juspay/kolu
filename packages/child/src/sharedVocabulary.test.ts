import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import ledger from "./sharedVocabulary.json" with { type: "json" };

const DECLARED_EXPORT =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:type|interface|const|let|function|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
const RENAMED_AS = /\bas\s+([A-Za-z_$][\w$]*)$/;
const READONLY_MEMBER = /^\s+readonly\s+([A-Za-z_$][\w$]*)\??\s*[:(]/gm;
const NAME = /^[A-Za-z_$][\w$]*$/;

interface Surface {
  readonly exports: ReadonlySet<string>;
  readonly members: ReadonlySet<string>;
}

const surfaceOf = (text: string): Surface => {
  const declared = [...text.matchAll(DECLARED_EXPORT)].map(
    (match) => match[1] ?? "",
  );
  const listed = [...text.matchAll(EXPORT_LIST)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((part) => {
        const name = part.trim().replace(/^type\s+/, "");
        const renamed = RENAMED_AS.exec(name);
        return renamed === null ? name : (renamed[1] ?? "");
      })
      .filter((name) => NAME.test(name)),
  );
  const members = [...text.matchAll(READONLY_MEMBER)].map(
    (match) => match[1] ?? "",
  );
  return {
    exports: new Set([...declared, ...listed]),
    members: new Set(members),
  };
};

const sourceOf = (file: string): string =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

describe("the subprocess socket olai also runs", () => {
  for (const [file, recorded] of Object.entries(ledger)) {
    describe(file, () => {
      test("every recorded export is still exported", () => {
        const live = surfaceOf(sourceOf(file)).exports;
        const gone = recorded.exports.filter((name) => !live.has(name));
        expect(gone, `${file} dropped exports olai reads`).toEqual([]);
      });

      test("every recorded member is still declared", () => {
        const live = surfaceOf(sourceOf(file)).members;
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
