/**
 * The tool table's static-load fence — a grep law (the `DocLink.test.ts`
 * precedent), because the cost this guards is invisible at runtime and only
 * shows as a slower `kolu --help` on a bench nobody runs daily.
 *
 * `kolu-mcp/tools` sits on the STATIC tree-build path of EVERY `kolu`
 * invocation: `cli.ts` mounts `surfaceFace.ts`, which mounts this table. The
 * tools it serves over MCP are handled: their handlers may pull the dial kit
 * at CALL time (dynamic `await import("@kolu/padi/dial")` inside the
 * handler); the MODULES may not, top-level. #2206 measured the regression
 * this prevents: three tool modules value-importing `@kolu/padi/dial` put
 * the socket/supervisor/remote/mirror closure onto the parse path of every
 * bare `kolu --help`.
 *
 * The law: no tool module of the table holds a top-level VALUE import of a
 * transport-bearing module. `import type` is exempt (erased). `specifier`
 * prefix-matches the banned roots — the roots are package-level fences, and
 * the low false-positive risk (a future sibling like `@kolu/padi/dialer`)
 * is bought back the day it exists by narrowing this list, not by loophole.
 *
 * Why here and not a lint rule: lint can't weight a value import by which
 * package it reaches; the fence is module-graph, so the fence is a test.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/** The roots a tool module must not hold at module scope. Handler-level
 *  dynamic imports of the very same entries are fine — they load at call
 *  time, when a socket is about to be used anyway. */
const BANNED_ROOTS = [
  "@kolu/padi/dial",
  "@kolu/padi/read",
  "@kolu/padi/cliClient",
  "@kolu/surface/links",
  "@kolu/surface/mirror",
  "@kolu/surface-remote",
  "@kolu/surface-daemon",
  "kolu-pty",
] as const;

/** `import { … } from "…"` / `import x from "…"`, VALUE-shape only — the
 *  negative lookahead spares `import type`. `[^;]*` spans lines, so a
 *  multi-line import block matches whole. */
const VALUE_IMPORT = /^import\s+(?!type\b)[^;]*from\s+["']([^"']+)["']/gm;

describe("the tool table's tree-load fence", () => {
  it("no table module holds a top-level VALUE import of transport machinery", () => {
    // The module set is tools.ts's own import block: add a tool to the table
    // without the fence and THIS test grows a scan target, automatically.
    const toolModules = [
      ...readFileSync(join(SRC, "tools.ts"), "utf8").matchAll(
        /from\s+"(\.\/[^"]+)"/g,
      ),
    ].map((m) => m[1]!);
    expect(
      toolModules.length,
      "tools.ts holds the whole table — a tool module imported nowhere is not mounted",
    ).toBeGreaterThanOrEqual(7);

    const offenders: string[] = [];
    for (const file of toolModules) {
      const source = readFileSync(join(SRC, file), "utf8");
      for (const match of source.matchAll(VALUE_IMPORT)) {
        const specifier = match[1];
        if (
          specifier &&
          BANNED_ROOTS.some((root) => specifier.startsWith(root))
        ) {
          offenders.push(`${file} → ${specifier}`);
        }
      }
    }
    expect(
      offenders,
      `a table module statically loads transport: ${offenders.join(", ")} — ` +
        `move the import INSIDE its handler (await import at call time), or give the ` +
        `pure concept a padi subpath of its own (the containingTerminal/watchScope precedent)`,
    ).toEqual([]);
  });
});
