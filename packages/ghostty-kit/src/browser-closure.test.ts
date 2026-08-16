/** The client tile imports engine.ts / load.ts / solid/*. Those files must
 *  never statically import Node builtins — Vite externalizes them and the
 *  page never mounts (`just test-dev`). */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));

const BROWSER_FILES = [
  "load.ts",
  "load.browser.ts",
  "engine.ts",
  "ffi.ts",
  "constants.ts",
  "encode.ts",
  "backfill.ts",
  "solid/Ghostty.tsx",
  "solid/grid.ts",
  "solid/onceMeasured.ts",
  "solid/index.ts",
  "solid/scrollLock.ts",
];

describe("browser tile import graph", () => {
  it("does not import Node builtins", () => {
    for (const rel of BROWSER_FILES) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      expect(text, rel).not.toMatch(/from ["']node:/);
    }
  });
});
