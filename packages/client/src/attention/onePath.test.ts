/** ONE PATH FOR EVERY ALERT — a pin, not a preference.
 *
 *  Every alert kolu raises to a person goes through `attention/attend.ts`'s
 *  `raise`: one switch over the channels, one sound for the lot, an OS popup
 *  per item that is not already in front of them. Two ways of reaching a
 *  person — one `Audio`, one notification seam — exist in exactly one file
 *  each (`attention/channels.ts`), and only the one delivery module builds
 *  them. A second copy anywhere under `packages/client/src` is the regression
 *  this guards: a source that rings on its own learns to ignore the switch,
 *  the "already in front of you" rule, and the dedupe. */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  listGuardSourceFiles,
  stripComments,
} from "../architectureGuardSources.testlib";

// This guard lives one directory down, so the scan root is its parent.
const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every source file whose CODE matches `re`, with the path relative to
 *  `packages/client/src`. Comments are blanked first: a docstring naming the
 *  seam is prose, not a second implementation. */
function filesMatching(re: RegExp): string[] {
  const found: string[] = [];
  for (const file of listGuardSourceFiles(CLIENT_SRC)) {
    const text = stripComments(readFileSync(file, "utf8"));
    if (re.test(text)) found.push(relative(CLIENT_SRC, file));
  }
  return found.sort();
}

describe("one path for every alert", () => {
  it("plays a sound in exactly one file — the channel adapter both sources build", () => {
    expect(filesMatching(/\bnew Audio\s*\(/)).toEqual([
      "attention/channels.ts",
    ]);
  });

  it("raises an OS popup in exactly one file — the same channel adapter", () => {
    expect(filesMatching(/\bnotify\s*\.\s*show\s*\(/)).toEqual([
      "attention/channels.ts",
    ]);
  });

  it("builds the channels in exactly one file — the module that owns delivery", () => {
    expect(filesMatching(/attention\/channels"|\.\/channels"/)).toEqual([
      "attention/useAttention.ts",
    ]);
  });
});
