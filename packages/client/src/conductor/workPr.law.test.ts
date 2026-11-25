/**
 * THE ONE DOOR ONTO A WORK'S LIVE PR. A PR reading becomes a PR — `prValue`
 * — in exactly one file under the Conductor's faces, `workPr.ts`, which only
 * ever reads the work's own `workPrs` entry. A second import is a second
 * door, and the reported defect was one: a card drew a member terminal's PR.
 * The Right panel's and the Dock's own per-terminal PR marks live outside
 * this folder and are right to read a terminal's record.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  listGuardSourceFiles,
  stripComments,
} from "../architectureGuardSources.testlib";

const CONDUCTOR_DIR = dirname(fileURLToPath(import.meta.url));
const WORK_PR_FILE = join(CONDUCTOR_DIR, "workPr.ts");

describe("a work's live PR", () => {
  it("is turned into a PR by workPr.ts alone", () => {
    const offenders = listGuardSourceFiles(CONDUCTOR_DIR).filter(
      (file) =>
        file !== WORK_PR_FILE &&
        /\bprValue\b/.test(stripComments(readFileSync(file, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });
});
