/**
 * The zero-`kolu-*` dependency guard for `@kolu/surface-daemon-supervisor`.
 *
 * The supervisor half is **spine**: it must reuse cleanly across consumers (kolu
 * today, `odu serve` next), so it may not depend on kolu the app — no spawn
 * policy, no provider DAG, no `kolu-common`/`kolu-pty`/`kolu-shared`. This walks
 * the package's import graph from `index.ts` and asserts every cross-package
 * edge is a known stable dep. A new `kolu-*` edge (or any unlisted external)
 * fails here and forces a conscious decision: the new code belongs in the
 * caller's soul (`packages/server/src/ptyHost`), not in the shared spine.
 *
 * Unlike kaval's closure test there is no "equals the nix-hashed set" half — the
 * supervisor is deliberately NOT a staleKey root (it runs in the client, never
 * the daemon), so it contributes nothing to a build id and nix hashes none of
 * it. This is purely the graduation/allowlist guard.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(SRC, "index.ts");

// The stable, kolu-free deps the supervisor legitimately rests on: node
// builtins and the daemon half (whose gate-format primitives it composes). NO
// `@kolu/surface` (the handshake/client typing lives in the caller's soul, not
// here) and emphatically NO `kolu-*` app package.
const ALLOWED_EXTERNAL = ["node:", "@kolu/surface-daemon"];

const isAllowed = (spec: string): boolean =>
  ALLOWED_EXTERNAL.some((p) => spec === p || spec.startsWith(p));

function importsOf(file: string): string[] {
  const pre = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  return pre.importedFiles.map((f) => f.fileName);
}

function resolveRelative(from: string, spec: string): string {
  const p = resolve(dirname(from), spec);
  return p.endsWith(".ts") ? p : `${p}.ts`;
}

describe("@kolu/surface-daemon-supervisor dependency closure", () => {
  it("reaches only stable, kolu-free external deps (no app coupling leaks into the spine)", () => {
    const reached = new Set<string>();
    const externals = new Set<string>();
    const stack = [ENTRY];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      // Don't follow into test files.
      if (file.endsWith(".test.ts")) continue;
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) stack.push(resolveRelative(file, spec));
        else externals.add(spec);
      }
    }

    const unexpected = [...externals].filter((s) => !isAllowed(s)).sort();
    expect(
      unexpected,
      `Unlisted external import(s) reached from @kolu/surface-daemon-supervisor: ${unexpected.join(
        ", ",
      )}. The supervisor is shared spine — a kolu-* edge means the code belongs in the caller's soul (packages/server/src/ptyHost), not here. If it is a genuinely stable, app-free dep, add it to ALLOWED_EXTERNAL.`,
    ).toEqual([]);
  });
});
