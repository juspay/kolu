/**
 * The closure guard for the staleKey (R-4 A2, re-rooted in B1).
 *
 * `currentBuildId()` keys staleness on a nix hash of kaval's daemon source
 * closure (see `default.nix`'s `ptyHostSrc`). For that key to mean "a restart
 * would load different daemon wire/behaviour code", every module that runs in
 * the daemon must live INSIDE the hashed set — otherwise a wire change in an
 * out-of-package module escapes the key (the #1034 mis-scope).
 *
 * B1 changes two things from A2's single-root, `index.ts`-rooted walk:
 *   - **Three hashed roots.** kaval itself, `@kolu/terminal-protocol` (the
 *     wire/behaviour it serves), and `@kolu/surface-daemon` (the daemon
 *     spine — pid-gate + the `daemonMain` skeleton run in the daemon process).
 *     nix hashes all three; the walk follows their edges rather than allowing
 *     them as stable externals.
 *   - **Two entry roots.** In B1 kaval code runs along two paths that both
 *     count toward "what a restart would load": the **library surface**
 *     (`index.ts`, embedded in-process by kolu-server today) and the **daemon
 *     entry** (`bin.ts` → `daemonMain.ts`, the standalone executable). The
 *     union of their closures must equal the hashed set — so a hashed file that
 *     neither path reaches (dead code) fails the test, and a daemon module
 *     pulled in through an unhashed edge fails it too.
 *
 * It asserts:
 *   (a) every bare (cross-package/external) edge is a known stable dep — a NEW
 *       edge (e.g. importing `kolu-common/contract` or a provider-DAG
 *       entrypoint) fails and forces a conscious decision: bring it in-package,
 *       or add it as a deliberate stable leaf;
 *   (b) the in-package modules reached exactly equal the nix-hashed file set,
 *       so nix and this test can never drift on what "the closure" is.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
// The two entry roots — see the header. `index.ts` is the embedded library
// surface; `bin.ts` is the standalone daemon executable. Their union is "all
// the code a kaval restart would load".
const ENTRIES = [resolve(SRC, "index.ts"), resolve(SRC, "bin.ts")];

// The second hashed root: @kolu/terminal-protocol carries wire/behaviour the
// daemon serves (the device-query forward/drop policy, the suppression
// grammars), so default.nix hashes it into the staleKey alongside kaval — and
// the walk follows the edge instead of allowing it as a stable external.
const PROTOCOL_SRC = resolve(SRC, "../../terminal-protocol/src");
const PROTOCOL_ENTRY = resolve(PROTOCOL_SRC, "index.ts");

// The third hashed root: @kolu/surface-daemon is the daemon spine — the
// pid-gate and the `daemonMain` skeleton run INSIDE the daemon process, so a
// change to them is a change to what a restart loads. default.nix hashes it
// whole (its standing invariant: only daemon-running code lives there until
// S1), and the walk follows the edge.
const DAEMON_SRC = resolve(SRC, "../../surface-daemon/src");
const DAEMON_ENTRY = resolve(DAEMON_SRC, "index.ts");

// Bare specifiers the closure is allowed to reach. The staleKey hashes only the
// three roots above, so wire/behaviour code reached through an UNLISTED edge
// would escape the key. These are the stable framework/leaf deps kaval and the
// spine legitimately rest on — and, since B0, they are ALSO exactly the
// graduation set: zero `kolu-*` workspace edges (the `@kolu/*` entries here are
// the framework, `@kolu/surface`, not kolu the app), so this same test is the
// guard that no spawn policy or app coupling leaks back daemon-side.
// Re-introducing `kolu-pty`, `kolu-common`, or `kolu-shared` here (or any
// provider-DAG edge) fails the test and forces a conscious decision: it does
// not belong in the daemon.
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

describe("kaval daemon closure (the staleKey's hashed set)", () => {
  it("reaches only known external deps, and its in-package set equals the nix-hashed files", () => {
    const reached = new Set<string>();
    const externals = new Set<string>();
    const stack = [...ENTRIES];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) stack.push(resolveRelative(file, spec));
        else if (spec === "@kolu/terminal-protocol") stack.push(PROTOCOL_ENTRY);
        else if (spec === "@kolu/surface-daemon") stack.push(DAEMON_ENTRY);
        else externals.add(spec);
      }
    }

    // (a) No daemon code escapes the key via an unlisted external edge.
    const unexpected = [...externals].filter((s) => !isAllowed(s)).sort();
    expect(
      unexpected,
      `Unlisted external import(s) reached from the kaval daemon closure: ${unexpected.join(
        ", ",
      )}. If one carries wire/behaviour shape it must live inside one of the hashed roots (kaval / terminal-protocol / surface-daemon); if it is a stable leaf dep, add it to ALLOWED_EXTERNAL.`,
    ).toEqual([]);

    // (b) The reached set == what nix hashes (each root's src/*.ts minus tests
    // and shared test-only helpers). This mirrors default.nix's ptyHostSrc
    // fileFilter so the hashed set can never silently drift from the closure
    // this test asserts.
    const nonTest = (dir: string): string[] =>
      readdirSync(dir)
        .filter(
          (f) =>
            f.endsWith(".ts") &&
            !f.endsWith(".test.ts") &&
            !f.endsWith(".testlib.ts"),
        )
        .map((f) => resolve(dir, f));
    const hashed = [
      ...nonTest(SRC),
      ...nonTest(PROTOCOL_SRC),
      ...nonTest(DAEMON_SRC),
    ];
    const rel = (xs: Iterable<string>): string[] =>
      [...xs].map((f) => relative(SRC, f)).sort();
    expect(rel(reached)).toEqual(rel(hashed));
  });
});
