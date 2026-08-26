/**
 * The tool table's static-load fence — a grep law (the `DocLink.test.ts`
 * precedent), because the cost this guards is invisible at runtime and only
 * shows as a slower `kolu --help` on a bench nobody runs daily.
 *
 * `kolu-mcp/tools` sits on the STATIC tree-build path of EVERY `kolu`
 * invocation: `cli.ts` mounts `surfaceFace.ts`, which mounts this table. The
 * tools it serves over MCP are handled: their handlers may pull the dial kit
 * at CALL time (dynamic `await import("@kolu/padi-client/dial")` inside the
 * handler); the MODULES may not, top-level. #2206 measured the regression
 * this prevents: three tool modules value-importing what was then ONE specifier,
 * `@kolu/padi/dial`, put the socket/supervisor/remote/mirror closure onto the
 * parse path of every bare `kolu --help`.
 *
 * That one specifier is four entries now (juspay/kolu#2216), and they do not
 * carry the same weight — so the list below names each by what it drags in
 * rather than by the door it used to share: `…-client/dial` the socket and the
 * supervisor, `…-client/watch` the mirror, `@kolu/padi/remote-dial` the ssh
 * provisioning closure and `kolu-pty`, and `…-client/rendezvous` the
 * `@kolu/surface-daemon` BARREL (its `.` export value-re-exports `daemonMain`,
 * `frontDaemonOverStdio`, the pid gate and `daemonProcessMain`) for one pure
 * path helper. Splitting a banned specifier is how a fence quietly loses half
 * its coverage: the two new entries had no live offender when they were added,
 * which is exactly when a hole is cheap to close.
 *
 * The law: no tool module of the table holds a top-level VALUE import of a
 * transport-bearing module. `import type` is exempt (erased). A banned root
 * matches an entry EXACTLY or as its path prefix (`root/…`) — the roots are
 * package- and entry-level fences.
 *
 * That boundary is not decoration: it is the narrowing this header used to
 * promise for the day a sibling ENTRY shared a banned entry's name. The day came
 * with `@kolu/padi-client` (juspay/kolu#2216) — `…/watchScope` is a pure
 * concept (the scope vocabulary, no transport at all) sitting beside the banned
 * `…/watch` (which reaches the mirror), and a bare `startsWith` fenced the
 * concept out along with the transport. Each sibling that must ALSO be fenced is
 * listed by name below, which is the point: the fence says what it means.
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
  "@kolu/padi-client/dial",
  "@kolu/padi-client/watch",
  "@kolu/padi-client/rendezvous",
  "@kolu/padi/remote-dial",
  "@kolu/padi/read",
  "@kolu/padi/cliClient",
  "@kolu/surface/links",
  "@kolu/surface/mirror",
  "@kolu/surface-remote",
  "@kolu/surface-daemon",
  // Named separately now that a root no longer swallows its name-prefixed
  // siblings — the supervisor half is its own package and its own fence.
  "@kolu/surface-daemon-supervisor",
  "kolu-pty",
] as const;

/** `import { … } from "…"` / `import x from "…"`, VALUE-shape only — the
 *  negative lookahead spares `import type`. `[^;]*` spans lines, so a
 *  multi-line import block matches whole. */
const VALUE_IMPORT = /^import\s+(?!type\b)[^;]*from\s+["']([^"']+)["']/gm;

describe("the tool table's tree-load fence", () => {
  it("no table module holds a top-level VALUE import of transport machinery", () => {
    // The module set is tools.ts ITSELF — the leaf every `kolu --help`
    // loads, so its own top-level imports are the FIRST thing the fence must
    // guard — plus every relative module its import block names. Add a tool
    // to the table without the fence and THIS test grows a scan target,
    // automatically.
    const toolsSource = readFileSync(join(SRC, "tools.ts"), "utf8");
    const toolModules = [
      "tools.ts",
      ...toolsSource
        // `from "…"` in either quote style, plus bare side-effect imports
        // (`import "./who.ts"`) — a scan that only sees one spelling is the
        // fence saying "the one import that mattered was double-quoted".
        .matchAll(/(?:from\s+)?["'](\.\/[^"']+)["']/g),
    ].map((m) => (typeof m === "string" ? m : m[1]!));
    expect(
      toolModules.length,
      "tools.ts holds the whole table — a tool module imported nowhere is not mounted",
    ).toBeGreaterThanOrEqual(7);

    const offenders: string[] = [];
    for (const file of toolModules) {
      const source = readFileSync(join(SRC, file), "utf8");
      for (const match of source.matchAll(VALUE_IMPORT)) {
        const specifier = match[1];
        // The exact-or-`root/` shape is spelled again in
        // `packages/server/src/seal.test.ts`. Deliberate: sharing three lines
        // would cost this package a new devDependency, a worse trade.
        if (
          specifier &&
          BANNED_ROOTS.some(
            (root) => specifier === root || specifier.startsWith(`${root}/`),
          )
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
