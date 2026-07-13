/** Closure guard — the root barrel kaval's daemon imports must stay lean.
 *
 *  kaval is a Node daemon run from TS SOURCE under tsx (`node --import <tsx
 *  loader> bin.ts`), so ESM is eager: importing `@kolu/xterm-kit` (root) loads
 *  every module the root barrel transitively re-exports, with no tree-shaking.
 *  Two hazards ride in that way and both are structural, not stylistic:
 *
 *   - **solid-js** — a UI reactive framework has no business in a PTY daemon's
 *     closure. `createScrollLock` (solid-reactive) lives behind `/solid` exactly
 *     so the root stays free of it.
 *   - **a VALUE import of `@xterm/xterm`** — the browser terminal ships CJS, and
 *     a static `import { Terminal } from "@xterm/xterm"` fails Node's
 *     cjs-module-lexer under tsx with *"does not provide an export named
 *     'Terminal'"*, crashing daemon startup. The `@xterm/xterm`-constructing
 *     backfill write path lives behind `/backfill` so the root never loads it.
 *
 *  This walks the root's static import graph and fails if either reappears — so a
 *  future misclassification (re-exporting a `/solid` or `/backfill` module from
 *  the root) is red CI here, not a broken daemon in production. */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve a relative import `base` to the source file it names — trying the
 *  bare path, `.ts`/`.tsx`, and a `index.ts`/`index.tsx` directory barrel, the
 *  same order Node/tsx resolve (and the sibling daemon-closure walkers in
 *  padi/kaval use). Returns null ONLY for a genuinely inert, non-source asset
 *  (`.json`/`.css`/`.js`) — which cannot carry a `solid-js` / `@xterm/xterm`
 *  value edge, so is safe to skip. Any relative edge that resolves to NEITHER a
 *  source file NOR such an asset is an unresolved source edge and the caller
 *  throws — silently ignoring it (the old behavior) would let a re-exported
 *  `./solid` directory barrel or a `.tsx` component slip the guard, the exact
 *  regression this test exists to catch. */
function resolveSourceFile(base: string): string | null {
  for (const c of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    base,
  ]) {
    if (
      (c.endsWith(".ts") || c.endsWith(".tsx")) &&
      existsSync(c) &&
      statSync(c).isFile()
    ) {
      return c;
    }
  }
  // An inert asset (already carries its own extension, not a .ts/.tsx source).
  if (/\.(json|css|js|cjs|mjs)$/.test(base) && existsSync(base)) return null;
  return null;
}

/** Every bare (non-relative) VALUE module specifier transitively reachable from
 *  `entry` via static `import` / `export … from`, following relative edges into
 *  their source files. Type-only lines (`import type` / `export type`) are erased
 *  at runtime, so they can neither crash the daemon nor bloat its closure and are
 *  skipped. An unresolved relative source edge THROWS rather than being silently
 *  dropped. */
function transitiveValueImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const raw of src.split("\n")) {
      const line = raw.trim();
      // Runtime edges only: `import … from "x"`, bare `import "x"`, and
      // `export … from "x"` — but NOT `import type` / `export type`.
      if (/^(import|export)\s+type\b/.test(line)) continue;
      const m = line.match(/(?:from|import)\s*["']([^"']+)["']/);
      const spec = m?.[1];
      if (!spec) continue;
      if (spec.startsWith(".")) {
        const base = resolve(dirname(file), spec);
        const resolved = resolveSourceFile(base);
        if (resolved) {
          visit(resolved);
        } else if (!/\.(json|css|js|cjs|mjs)$/.test(spec)) {
          throw new Error(
            `daemon-closure guard: unresolved relative import '${spec}' from ${file} — cannot verify it stays solid-js/@xterm-free`,
          );
        }
      } else {
        bare.add(spec);
      }
    }
  };
  visit(entry);
  return bare;
}

describe("daemon closure guard: @kolu/xterm-kit root barrel", () => {
  it("transitively imports neither solid-js nor a value @xterm/xterm", () => {
    const imports = transitiveValueImports(resolve(here, "index.ts"));
    const forbidden = [...imports].filter(
      (s) =>
        s === "solid-js" || s.startsWith("solid-js/") || s === "@xterm/xterm",
    );
    expect(
      forbidden,
      `The root barrel is imported by kaval's tsx daemon: it must not transitively pull solid-js (UI framework in a PTY daemon) or a VALUE @xterm/xterm (crashes cjs-module-lexer under tsx). Move the offending export to /solid or /backfill. Found: [${forbidden.join(", ")}]`,
    ).toEqual([]);
  });
});
