/**
 * The closure guard for kolu-watcher's staleKey (P3) — the analog of kaval's
 * `buildId.closure.test.ts`, but with the OPPOSITE allow-list philosophy.
 *
 * kaval's closure must stay kolu-AGNOSTIC, so its test forbids every `kolu-*`
 * edge. kolu-watcher is the inverse: it deliberately runs kolu's coupled logic
 * (the provider DAG via `@kolu/terminal-dag`, native fs/git via `kolu-git`, the
 * domain schemas in `kolu-common`), which is exactly WHY it is a separate
 * process + derivation rather than living in kaval. So those edges are ALLOWED
 * here — enumerated explicitly below.
 *
 * What the guard still catches is a DIFFERENT mistake: the watcher accidentally
 * reaching INTO kolu-server (its DB / publisher / surfaceCtx / browser surface),
 * the client, or any other package it must not depend on. A new such edge is an
 * unlisted external and fails the test, forcing a conscious decision. It also
 * pins the reached in-package set to `default.nix`'s `watcherSrc` (the staleKey
 * hashes exactly these files), so the two can't drift and dead code can't hide.
 *
 * `watcherSrc` is the package's OWN src only (mirroring kaval's narrow hashed
 * set) — the heavy DAG closure is reached through allowed external edges, not
 * walked. The full closure is still tracked by the .drv map (flake.nix), so a
 * DAG change re-provisions the remote watcher regardless of this narrow staleKey.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
// The two entry roots — the library surface (`index.ts`, what kolu-server's
// RemoteTerminalEndpoint imports the contract from) and the daemon executable
// (`bin.ts`, the `--stdio` program kolu-server spawns over ssh).
const ENTRIES = [resolve(SRC, "index.ts"), resolve(SRC, "bin.ts")];

// Bare specifiers the watcher's OWN modules are allowed to reach. Unlike kaval,
// this INCLUDES kolu app packages — the watcher's whole reason to exist. A NEW
// edge not on this list (notably `kolu-server`, `kolu-client`, `@kolu/serve-dir`,
// or any kolu-server-internal module) fails the test: the watcher must not
// depend on kolu-server. The framework (`@kolu/surface`), the extracted DAG
// (`@kolu/terminal-dag`), the PTY contract (`kaval`), the domain schemas
// (`kolu-common`), git (`kolu-git`), and the leaf deps are the legitimate set.
const ALLOWED_EXTERNAL = [
  "node:",
  "zod",
  "pino",
  "@orpc/",
  // The trailing slash is load-bearing: it matches `@kolu/surface/define` etc.
  // but NOT the sibling packages `@kolu/surface-app` / `-daemon-supervisor` /
  // `-nix-host`, so one of those sneaking in is caught, not silently allowed.
  "@kolu/surface/",
  "@kolu/terminal-dag",
  "kaval",
  "kolu-common",
  "kolu-git",
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

describe("kolu-watcher closure (the staleKey's hashed set)", () => {
  it("reaches only allowed deps (never kolu-server), and equals the nix-hashed files", () => {
    const reached = new Set<string>();
    const externals = new Set<string>();
    const stack = [...ENTRIES];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) stack.push(resolveRelative(file, spec));
        else externals.add(spec);
      }
    }

    // (a) No watcher module reaches an unlisted package — in particular, nothing
    // pulls kolu-server or the client into the watcher's closure.
    const unexpected = [...externals].filter((s) => !isAllowed(s)).sort();
    expect(
      unexpected,
      `Unlisted external import(s) reached from kolu-watcher: ${unexpected.join(
        ", ",
      )}. The watcher must not depend on kolu-server/client; if this is a legit new leaf dep, add it to ALLOWED_EXTERNAL with a reason.`,
    ).toEqual([]);

    // (b) The reached set == what default.nix's `watcherSrc` hashes
    // (kolu-watcher/src/*.ts minus tests), so nix and this test never drift and
    // dead code (a hashed file nothing reaches) fails.
    const hashed = readdirSync(SRC)
      .filter(
        (f) =>
          f.endsWith(".ts") &&
          !f.endsWith(".test.ts") &&
          !f.endsWith(".testlib.ts"),
      )
      .map((f) => resolve(SRC, f));
    const rel = (xs: Iterable<string>): string[] =>
      [...xs].map((f) => relative(SRC, f)).sort();
    expect(rel(reached)).toEqual(rel(hashed));
  });
});
