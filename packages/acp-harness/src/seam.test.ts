/**
 * THE SEAM'S IMPORT FENCE — the half of the harness that speaks ACP must not
 * reach into kolu's own vocabulary.
 *
 * `@kolu/acp-harness` is one package doing two jobs: running a foreign protocol
 * over a subprocess, and folding what comes back into kolu's rows and state.
 * The split this fence guards exists so the FIRST job can be read — and handed
 * to another product — without dragging the second with it: an `agent.ts` that
 * imported `kolu-common` would be an agent that knows what a conductor row is,
 * and the one place that must stay product-neutral would be the place the
 * product vocabulary leaks into.
 *
 * The rule is stated as a list of FILES rather than by directory, because that
 * is what a reviewer can check: which package a file may import is a fact
 * about what that file is, and a rule about folders would go on passing after
 * somebody moved a row writer next door.
 *
 * WHAT THIS TEST CANNOT DO YET, and says so rather than pretending: `agent.ts`
 * and `events.ts` are the split's own files and do not exist until it lands.
 * The list below is the files that exist; a name goes in here the moment its
 * file does, and the list is deliberately required to be non-empty so a rename
 * cannot turn this into a test of nothing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/** Where a file in this package lives. */
const SRC = join(import.meta.dirname);

/** Imports that carry a PRODUCT's vocabulary — a row, a cell, a fleet ref, a
 *  terminal. The protocol half may name none of them. */
const PRODUCT = [
  "kolu-common",
  "kolu-mcp",
  "@kolu/terminal-vocab",
  "./kolu.ts",
  "./rows.ts",
  "./aboutBlock.ts",
];

/** The protocol-facing modules, by file name. */
const SEAM = ["payloads.ts", "questions.ts", "calls.ts", "pipes.ts"];

/** Every module specifier a file imports, in source order. */
const specifiersIn = (file: string): ReadonlyArray<string> =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /(?:\bfrom\s+|\bimport\s*\(\s*)["']([^"']+)["']/g,
    ),
  ].map((match) => match[1] ?? "");

describe("the seam does not know kolu's vocabulary", () => {
  test("the list is not empty, so a rename cannot empty this test", () => {
    expect(SEAM.length).toBeGreaterThan(0);
  });

  for (const file of SEAM) {
    test(`${file} imports no product vocabulary`, () => {
      const banned = specifiersIn(join(SRC, file)).filter((spec) =>
        PRODUCT.some(
          (product) => spec === product || spec.startsWith(`${product}/`),
        ),
      );
      expect(banned, `${file} imports ${banned.join(", ")}`).toEqual([]);
    });
  }
});
