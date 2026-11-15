/**
 * NO HOLES IN THE WORK MODEL. Anything that may be absent is an arm of a
 * tagged sum that says what the absence means, or an `Option` for a lookup
 * that may find nothing — never a nullable field, an optional one, or a
 * `| undefined` result. This reads the package's own sources and fails naming
 * the line where one comes back.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname);

/** The holes, by the spelling that makes one. */
const HOLES: ReadonlyArray<readonly [string, RegExp]> = [
  ["Schema.NullOr", /\bNullOr\s*\(/],
  ["Schema.UndefinedOr", /\bUndefinedOr\s*\(/],
  ["an optional schema field", /Schema\.(optional|optionalKey)\b/],
  ["a `| null` type", /\|\s*null\b/],
  ["a `| undefined` type", /\|\s*undefined\b/],
  ["a `null` result type", /\):\s*null\b/],
  ["an optional field", /^\s*(readonly\s+)?[A-Za-z_$][\w$]*\?\s*:/],
];

/** A line of code, with any comment on it taken off. */
const codeOf = (line: string): string => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
  const comment = line.indexOf("//");
  return comment < 0 ? line : line.slice(0, comment);
};

describe("kolu-work has no holes", () => {
  const sources = readdirSync(SRC).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );

  it("reads every source file of the package", () => {
    expect(sources).toEqual(
      expect.arrayContaining([
        "schema.ts",
        "record.ts",
        "readings.ts",
        "waterfall.ts",
        "folds.ts",
        "store.ts",
      ]),
    );
  });

  it.each(sources)("%s spells no nullable or optional", (name) => {
    const found = readFileSync(join(SRC, name), "utf8")
      .split("\n")
      .flatMap((line, at) =>
        HOLES.filter(([, pattern]) => pattern.test(codeOf(line))).map(
          ([what]) => `${name}:${at + 1}: ${what} — ${line.trim()}`,
        ),
      );
    expect(found).toEqual([]);
  });
});
