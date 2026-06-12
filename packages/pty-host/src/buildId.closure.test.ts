/**
 * The closure guard for the staleKey (R-4 A2).
 *
 * `currentBuildId()` keys staleness on a nix hash of `packages/pty-host/src`
 * (see `default.nix`'s `ptyHostBuildId`). For that key to mean "a restart would
 * load different pty-host wire/behaviour code", every module the contract +
 * serving transitively reach must live INSIDE that hashed set — otherwise a
 * wire change in an out-of-package module escapes the key (the #1034 mis-scope).
 *
 * This walks `index.ts`'s transitive imports and asserts two things:
 *   (a) every bare (cross-package/external) edge is a known stable dep — a NEW
 *       edge (e.g. importing `kolu-common/contract`, the provider-DAG
 *       entrypoint, or `kolu-git`) fails the test and forces a conscious
 *       decision: bring it in-package, or add it as a deliberate stable leaf;
 *   (b) the in-package modules reached exactly equal the nix-hashed file set,
 *       so nix and this test can never drift on what "the closure" is.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(SRC, "index.ts");
// The second hashed root: @kolu/terminal-protocol carries wire/behaviour the
// pty-host serves (the device-query forward/drop policy, the suppression
// grammars), so default.nix hashes it into the staleKey alongside this
// package — and the walk below follows the edge instead of allowing it as a
// stable external.
const PROTOCOL_SRC = resolve(SRC, "../../terminal-protocol/src");
const PROTOCOL_ENTRY = resolve(PROTOCOL_SRC, "index.ts");

// Bare specifiers the closure is allowed to reach. The staleKey hashes only
// packages/pty-host/src, so wire/behaviour code reached through an UNLISTED
// edge would escape the key. These are the stable framework/leaf deps the
// pty-host legitimately rests on — and, since B0, they are ALSO exactly the
// graduation set: zero `kolu-*` workspace edges, so this same test is the guard
// that no spawn policy leaks back daemon-side. Re-introducing `kolu-pty`,
// `kolu-common`, or `kolu-shared` here (or any provider-DAG edge) fails the
// test and forces a conscious decision: it does not belong in the daemon.
const ALLOWED_EXTERNAL = [
  "node:",
  "zod",
  "node-pty",
  "@xterm/",
  "@orpc/",
  "@kolu/surface",
];

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

describe("@kolu/pty-host closure (the staleKey's hashed set)", () => {
  it("reaches only known external deps, and its in-package set equals the nix-hashed files", () => {
    const reached = new Set<string>();
    const externals = new Set<string>();
    const stack = [ENTRY];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) stack.push(resolveRelative(file, spec));
        else if (spec === "@kolu/terminal-protocol") stack.push(PROTOCOL_ENTRY);
        else externals.add(spec);
      }
    }

    // (a) No wire/behaviour code escapes the key via an unlisted external edge.
    const unexpected = [...externals].filter((s) => !isAllowed(s)).sort();
    expect(
      unexpected,
      `Unlisted external import(s) reached from the @kolu/pty-host closure: ${unexpected.join(
        ", ",
      )}. If one carries wire/behaviour shape it must live inside packages/pty-host/src (hashed by the staleKey); if it is a stable leaf dep, add it to ALLOWED_EXTERNAL.`,
    ).toEqual([]);

    // (b) The reached set == what nix hashes (both roots' src/*.ts minus
    // tests). This mirrors default.nix's ptyHostSrc fileFilter so the hashed
    // set can never silently drift from the closure this test asserts.
    const nonTest = (dir: string): string[] =>
      readdirSync(dir)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => resolve(dir, f));
    const hashed = [...nonTest(SRC), ...nonTest(PROTOCOL_SRC)];
    const rel = (xs: Iterable<string>): string[] =>
      [...xs].map((f) => relative(SRC, f)).sort();
    expect(rel(reached)).toEqual(rel(hashed));
  });
});
