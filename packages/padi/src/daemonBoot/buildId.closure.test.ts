/**
 * The closure guard for padi's staleKey (W2.2) — the twin of kaval's
 * `buildId.closure.test.ts`, one layer up.
 *
 * `currentPadiBuildId()` keys staleness on a nix hash of padi's daemon source
 * closure (see `default.nix`'s `padiSrc`). For that key to mean "a restart would
 * load different daemon code", every module that runs in padi's process must live
 * INSIDE the hashed set — otherwise a change in an out-of-package module escapes
 * the key.
 *
 * padi has TWO entry roots that both count toward "what a restart would load":
 * the **process** (`daemonBoot/bin.ts` → `daemonBoot/daemonMain.ts`) and the **library barrel**
 * (`assembly.ts`, the single seam kolu-server still imports). The union of their
 * closures must equal the nix-hashed set.
 *
 * It asserts, walking that union:
 *   (a) every bare (cross-package/external) edge is a known stable dep — a NEW
 *       edge forces a conscious decision: bring it into a hashed root, or add it
 *       as a deliberate stable leaf in ALLOWED_EXTERNAL;
 *   (b) the in-package modules reached exactly equal the nix-hashed file set
 *       (each hashed root's `src/**` non-test `.ts`/`.tsx`, minus the same
 *       per-root exclusions default.nix's `padiSrc` carves out), so nix and this
 *       test can never drift on what "the closure" is.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // packages/padi/src
const PKGS = resolve(SRC, "../.."); // packages/

// The two entry roots — the process and the library barrel. Their union is "all
// the code a padi restart would load".
const ENTRIES = [
  resolve(SRC, "daemonBoot/bin.ts"),
  resolve(SRC, "assembly.ts"),
];

// The hashed roots: every workspace package whose `src` runs IN padi's process.
// name -> package dir (relative to `packages/`). MIRRORS default.nix's `padiSrc`
// EXACTLY — same packages, same per-root exclusions (below). The walk follows an
// edge into any of these; every other bare specifier is a stable external.
const HASHED_ROOTS: Record<string, string> = {
  "@kolu/padi": "padi",
  kaval: "kaval",
  "@kolu/terminal-protocol": "terminal-protocol",
  "@kolu/surface-daemon": "surface-daemon",
  "@kolu/surface-daemon-supervisor": "surface-daemon-supervisor",
  "@kolu/terminal-vocab": "terminal-vocab",
  // Outside packages/ — lives under osfacts/ so it leaves with the tool at OSF5.
  "osfacts-client": "../osfacts/client-ts",
  "@kolu/serve-dir": "serve-dir",
  "@kolu/shell-quote": "shell-quote",
  "@kolu/html-escape": "html-escape",
  "@kolu/log": "log",
  "kolu-shared": "shared",
  "kolu-transcript-core": "transcript-core",
  "kolu-transcript-html": "transcript-html",
  "memorable-names": "memorable-names",
  nonempty: "nonempty",
  "kolu-pty": "integrations/pty",
  "kolu-git": "integrations/git",
  "kolu-github": "integrations/github",
  "kolu-io": "integrations/io",
  "kolu-claude-code": "integrations/claude-code",
  "kolu-codex": "integrations/codex",
  "kolu-grok": "integrations/grok",
  "kolu-opencode": "integrations/opencode",
  anyagent: "integrations/anyagent",
  anyforge: "integrations/anyforge",
};

// Files nix EXCLUDES from a hashed root's `src` (its `fileset.difference`),
// because they are NOT in padi's process closure. Paths are relative to
// `<root>/src`. Keep in lockstep with default.nix's `padiSrc`.
const EXCLUDED: Record<string, string[]> = {
  // padi's CLIENT dial kit (`@kolu/padi/dial`, W2.3) — it runs in a padi CLIENT
  // (padi-tui, the kolu-server binder, the kolu MCP face), NEVER in padi's
  // daemon process (neither `bin.ts` nor the `assembly.ts` barrel reaches it),
  // so it belongs to those consumers' code, not padi's staleKey. `watch.ts`
  // (the dial kit's client-side watch/wait helpers) rides the same exclusion.
  "@kolu/padi": ["dial.ts", "watch.ts"],
  // kaval's daemon EXECUTABLE — the separate process padi spawns via
  // KOLU_KAVAL_BIN, carrying its OWN KAVAL_BUILD_ID. padi embeds only kaval's
  // LIBRARY surface (`index.ts`), never these, so they belong to kaval's
  // staleKey, not padi's.
  kaval: ["bin.ts", "daemonMain.ts", "stdioBridge.ts"],
};

// Bare specifiers the closure is allowed to reach. The staleKey hashes only the
// roots above, so code reached through an UNLISTED edge would escape the key.
// These are the stable framework/leaf deps padi legitimately rests on: `node:`
// builtins, the pnpm-pinned npm deps (covered by pnpmDeps, not hashed), and
// `@kolu/surface` — the framework "electricity", a deliberate drishti-gated
// volatility boundary that (exactly as kaval treats it) is NOT hashed.
const ALLOWED_EXTERNAL = [
  "node:",
  "zod",
  "ts-pattern",
  "conf",
  "pino",
  "node-pty",
  "@xterm/",
  "@orpc/",
  "@anthropic-ai/claude-agent-sdk",
  "@parcel/watcher",
  "marked",
  "mrmime",
  "simple-git",
  "string-argv",
  "@kolu/surface",
  // @kolu/xterm-kit — the graduated xterm machinery. padi reaches it ONLY
  // transitively through kaval's embedded library (`ptyHost` → the runtime-
  // neutral core: createMirrorAnchor / snapToWrapHead). It is a stable leaf here,
  // NOT a hashed root, for the same reason kaval treats it so (see
  // kaval/src/buildId.closure.test.ts): the anchor's daemon-relevant behavioral
  // surface — the absolute mirror-line coordinates getHistory pages by — IS part
  // of PTY_HOST_CONTRACT_VERSION, which lives in kaval's hashed closure that padi
  // already embeds. A wire-breaking anchor change rides that contract bump; a
  // browser-only /solid or /backfill change (never reached from padi's daemon)
  // must not flip padi's key. The walk STOPS at it.
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

/** Resolve a base path to the `.ts`/`.tsx` file it names, or null for a
 *  non-source asset (`.json`/`.css`/`.js`) — which is inert to the staleKey and
 *  so intentionally skipped, matching nix's `.ts`/`.tsx`-only fileFilter. */
function resolveSourceFile(base: string): string | null {
  const cands = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of cands) {
    if (
      (c.endsWith(".ts") || c.endsWith(".tsx")) &&
      existsSync(c) &&
      statSync(c).isFile()
    ) {
      return c;
    }
  }
  return null;
}

/** The longest hashed-root package name this specifier belongs to (so
 *  `@kolu/surface-daemon-supervisor/states` beats `@kolu/surface-daemon`), or
 *  null if it names no hashed root. */
function matchHashedRoot(spec: string): string | null {
  let best: string | null = null;
  for (const name of Object.keys(HASHED_ROOTS)) {
    if (spec === name || spec.startsWith(`${name}/`)) {
      if (best === null || name.length > best.length) best = name;
    }
  }
  return best;
}

/** Resolve a bare/subpath specifier for a hashed root to its `src` file, via the
 *  package's `exports` map (falling back to `main`, then `src/index`). */
function resolveWorkspaceFile(rootName: string, spec: string): string | null {
  const relDir = HASHED_ROOTS[rootName];
  if (relDir === undefined) throw new Error(`not a hashed root: ${rootName}`);
  const dir = resolve(PKGS, relDir);
  const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const sub = spec === rootName ? "." : `.${spec.slice(rootName.length)}`;
  const pick = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const t = o.default ?? o.import ?? o.node ?? Object.values(o)[0];
      return typeof t === "string" ? t : undefined;
    }
    return undefined;
  };
  const exp = (pj.exports ?? {}) as Record<string, unknown>;
  const target =
    pick(exp[sub]) ??
    (sub === "."
      ? (pick(exp["."]) ??
        (typeof pj.main === "string" ? pj.main : "./src/index"))
      : undefined) ??
    `./src/${spec.slice(rootName.length + 1)}`;
  return resolveSourceFile(resolve(dir, target));
}

/** Every non-test `.ts`/`.tsx` under `dir`, recursively — padi's roots have
 *  subdirectories (`ptyHost/`, `terminalEndpoint/`, `sqlite/`), so a flat
 *  readdir (kaval's) would miss them. */
function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkSources(p));
    else if (
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
      !e.name.endsWith(".test.ts") &&
      !e.name.endsWith(".test.tsx") &&
      !e.name.endsWith(".test-d.ts") &&
      !e.name.endsWith(".testlib.ts")
    ) {
      out.push(p);
    }
  }
  return out;
}

describe("padi daemon closure (the staleKey's hashed set)", () => {
  it("reaches only known external deps, and its in-package set equals the nix-hashed files", () => {
    const reached = new Set<string>();
    const externals = new Set<string>();
    const stack = [...ENTRIES];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) {
          const r = resolveSourceFile(resolve(dirname(file), spec));
          if (r) stack.push(r); // null = inert asset (.json/.css/.js), skip
          continue;
        }
        const root = matchHashedRoot(spec);
        if (root) {
          const f = resolveWorkspaceFile(root, spec);
          if (f === null) {
            throw new Error(
              `unresolved workspace import '${spec}' from ${relative(PKGS, file)}`,
            );
          }
          stack.push(f);
        } else {
          externals.add(spec);
        }
      }
    }

    // (a) No daemon code escapes the key via an unlisted external edge.
    const unexpected = [...externals].filter((s) => !isAllowed(s)).sort();
    expect(
      unexpected,
      `Unlisted external import(s) reached from padi's daemon closure: ${unexpected.join(
        ", ",
      )}. If one carries daemon wire/behaviour it must live inside a hashed root; if it is a stable leaf dep, add it to ALLOWED_EXTERNAL.`,
    ).toEqual([]);

    // (b) The reached set == what nix hashes (each root's src/**.ts(x) minus
    // tests and the per-root exclusions). This mirrors default.nix's `padiSrc`
    // fileFilter + `fileset.difference` clauses so the hashed set can never
    // silently drift from the closure this test asserts.
    const hashed: string[] = [];
    for (const [name, rel] of Object.entries(HASHED_ROOTS)) {
      const srcDir = resolve(PKGS, rel, "src");
      const excluded = new Set(EXCLUDED[name] ?? []);
      for (const f of walkSources(srcDir)) {
        if (!excluded.has(relative(srcDir, f))) hashed.push(f);
      }
    }
    const toRel = (xs: Iterable<string>): string[] =>
      [...xs].map((f) => relative(PKGS, f)).sort();
    expect(toRel(reached)).toEqual(toRel(hashed));
  });
});
