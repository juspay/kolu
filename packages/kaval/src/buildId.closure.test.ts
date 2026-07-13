/**
 * The closure guard for kaval's CURRENCY key (`currentBuildId()` / `KAVAL_BUILD_ID`).
 *
 * kaval's staleKey drives ONE thing: the human "update available" nudge (its build-
 * mismatch policy is `nudge-human`, because recycling kaval to pick up a new build KILLS
 * live PTYs). So the key must hash exactly kaval's BEHAVIORAL closure — the code whose
 * change actually changes what a restart *does for the user's terminals* — and nothing
 * else, or the nudge over-fires and a person pays for it in lost PTYs.
 *
 * ── The restated invariant (#L3): currency key = the BEHAVIORAL slice, spine EXCLUDED ──
 * Two hashed roots: **kaval itself** and **`@kolu/terminal-protocol`** (the wire/behaviour
 * it serves — the device-query forward/drop policy, the suppression grammars). The
 * durable-daemon SPINE `@kolu/surface-daemon` (pid-gate, `daemonMain`, `frontDaemonOverStdio`)
 * DOES run inside the kaval binary, but it is DELIBERATELY OUT of the currency slice: the
 * spine's behavioral surface to a consumer IS the wire contract (`PTY_HOST_CONTRACT_VERSION`,
 * in kaval), and a contract-COMPATIBLE spine change is behaviorally interchangeable BY THE
 * CONTRACT'S DEFINITION — so keying currency on it double-counts the contract and fires a
 * spurious nudge on every compatible spine refactor. This was paid for in production (zest,
 * 2026-07-03): a spine-only change with no kaval-behavior delta flipped the staleKey and
 * fired a false "update available"; acting on it would have recycled kaval and killed PTYs.
 * A spine change that DOES matter to the wire bumps the contract (hashed here) → recycle-on-
 * skew converges it, a separate sanctioned signal. So the spine is a stable LEAF here, not a
 * hashed root. (padi's staleKey keeps the full closure incl. the spine — its staleness
 * response is a cheap auto-drain, so over-firing is harmless; only kaval's human nudge needs
 * the slice.)
 *
 * It asserts:
 *   (a) every bare (cross-package/external) edge is a known stable dep — a NEW edge fails
 *       and forces a conscious decision: bring it in-package, or add it as a deliberate
 *       stable leaf (the spine `@kolu/surface-daemon` is now such a leaf);
 *   (b) the in-BEHAVIORAL-SLICE modules reached (kaval + terminal-protocol, NOT the spine
 *       the walk stops at) exactly equal the nix-hashed file set, so nix (default.nix's
 *       `kavalIdentity.behavioralFileset`) and this test can never drift on the slice.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
// The two entry roots — `index.ts` is the embedded library surface; `bin.ts` is the
// standalone daemon executable. Their union is "all the code a kaval restart would load";
// the behavioral slice is that union MINUS the spine (see header).
const ENTRIES = [resolve(SRC, "index.ts"), resolve(SRC, "bin.ts")];

// The second hashed root: @kolu/terminal-protocol carries wire/behaviour the daemon
// serves, so default.nix hashes it into the staleKey alongside kaval — and the walk
// follows the edge instead of allowing it as a stable external.
const PROTOCOL_SRC = resolve(SRC, "../../terminal-protocol/src");
const PROTOCOL_ENTRY = resolve(PROTOCOL_SRC, "index.ts");

// Bare specifiers the closure is allowed to reach. The staleKey hashes only the two
// behavioral roots (kaval + terminal-protocol), so wire/behaviour code reached through an
// UNLISTED edge would escape the key. These are the stable framework/leaf deps kaval
// legitimately rests on — and, since B0, ALSO the graduation set: zero `kolu-*` workspace
// edges (the `@kolu/*` entries are the framework, not kolu the app). Re-introducing
// `kolu-pty`/`kolu-common`/`kolu-shared` (or any provider-DAG edge) fails the test.
const ALLOWED_EXTERNAL = [
  "node:",
  "zod",
  "node-pty",
  "@xterm/",
  "@orpc/",
  "@kolu/surface",
  // @kolu/heap-diag is the shared opt-in heap-instrumentation receptacle (no wire/
  // behaviour) — a stable leaf, not a hashed root.
  "@kolu/heap-diag",
  // @kolu/surface-daemon is the durable-daemon SPINE — it runs in the kaval binary, but
  // it is DELIBERATELY a stable leaf here, NOT a hashed root: it is OUT of kaval's currency
  // slice (its behavioral surface to kaval is the wire contract, which lives in kaval and
  // IS hashed; a contract-compatible spine change must not fire kaval's PTY-costing nudge —
  // the zest incident, see header). So the walk STOPS at it rather than following its edge.
  "@kolu/surface-daemon",
  // @kolu/xterm-kit is the graduated xterm machinery. kaval consumes ONLY its
  // runtime-neutral core (the mirror anchor + snapToWrapHead) — a stable leaf here,
  // NOT a hashed root, by the exact same reasoning as the spine: the anchor's
  // kaval-relevant behavioral surface (the absolute-line coordinates getHistory
  // pages by) IS part of PTY_HOST_CONTRACT_VERSION, which lives in kaval and IS
  // hashed — so a wire-breaking anchor change rides the contract bump, while a
  // /solid or /backfill change (browser-only, never reached from here) must not fire
  // kaval's PTY-costing currency nudge. The walk STOPS at it.
  "@kolu/xterm-kit",
];

const isAllowed = (spec: string): boolean =>
  ALLOWED_EXTERNAL.some((p) => spec === p || spec.startsWith(p));

type AstNode = {
  type: string;
  [key: string]: unknown;
};

const isAstNode = (value: unknown): value is AstNode =>
  value !== null &&
  typeof value === "object" &&
  "type" in value &&
  typeof (value as { type?: unknown }).type === "string";

function visitAst(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) visitAst(item, visit);
    } else if (isAstNode(value)) {
      visitAst(value, visit);
    }
  }
}

const stringLiteralValue = (node: unknown): string | null =>
  isAstNode(node) &&
  (node.type === "StringLiteral" || node.type === "DirectiveLiteral") &&
  typeof node.value === "string"
    ? node.value
    : null;

function importsOf(file: string): string[] {
  const ast = parse(readFileSync(file, "utf8"), {
    sourceFilename: file,
    sourceType: "module",
    createImportExpressions: true,
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;
  const specs = new Set<string>();
  visitAst(ast, (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const spec = stringLiteralValue(node.source);
      if (spec) specs.add(spec);
    }
    if (node.type === "ImportExpression") {
      const spec = stringLiteralValue(node.source);
      if (spec) specs.add(spec);
    }
    if (node.type === "TSImportType") {
      const spec = stringLiteralValue(node.argument);
      if (spec) specs.add(spec);
    }
  });
  return [...specs];
}

function resolveRelative(from: string, spec: string): string {
  const p = resolve(dirname(from), spec);
  return p.endsWith(".ts") ? p : `${p}.ts`;
}

describe("kaval currency key (the staleKey's behavioral slice)", () => {
  it("reaches only known external deps, and its in-slice set equals the nix-hashed files", () => {
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
        // @kolu/surface-daemon is a LEAF here (the excluded spine) — do NOT follow it.
        else externals.add(spec);
      }
    }

    // (a) No behavioral code escapes the key via an unlisted external edge.
    const unexpected = [...externals].filter((s) => !isAllowed(s)).sort();
    expect(
      unexpected,
      `Unlisted external import(s) reached from the kaval behavioral closure: ${unexpected.join(
        ", ",
      )}. If one carries wire/behaviour shape it must live inside a hashed root (kaval / terminal-protocol); if it is a stable leaf dep (like the spine @kolu/surface-daemon), add it to ALLOWED_EXTERNAL.`,
    ).toEqual([]);

    // (b) The reached BEHAVIORAL slice == what nix hashes (kaval + terminal-protocol
    // src/*.ts minus tests). This mirrors default.nix's `kavalIdentity.behavioralFileset`
    // so the slice can never silently drift from the closure this test asserts. The spine
    // (@kolu/surface-daemon) is neither reached (leaf, above) nor hashed — its exclusion is
    // the invariant, not an accident.
    const nonTest = (dir: string): string[] =>
      readdirSync(dir)
        .filter(
          (f) =>
            f.endsWith(".ts") &&
            !f.endsWith(".test.ts") &&
            !f.endsWith(".testlib.ts"),
        )
        .map((f) => resolve(dir, f));
    const hashed = [...nonTest(SRC), ...nonTest(PROTOCOL_SRC)];
    const rel = (xs: Iterable<string>): string[] =>
      [...xs].map((f) => relative(SRC, f)).sort();
    expect(rel(reached)).toEqual(rel(hashed));
  });
});
