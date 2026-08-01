/**
 * The shared dependency-edge walker behind each daemon's `buildId.closure.test.ts`
 * guard (juspay/kolu#2094).
 *
 * A daemon's `<PREFIX>_BUILD_ID` staleKey is DERIVED in nix: `default.nix`
 * hashes the transitive package.json `dependencies` closure of the daemon's
 * package (`nix/workspace.nix`'s `depClosure`, following `workspace:` edges,
 * minus the daemon's documented `stableLeaves`). No hand-kept file list, no
 * mirror — but the derivation is sound only if the manifests are an honest map
 * of what the daemon process can load. pnpm's isolated node_modules already
 * guarantees an import resolves only through a DECLARED edge; what it does NOT
 * distinguish is `dependencies` from `devDependencies` — a runtime module
 * riding a devDependency link works in every dev install while being invisible
 * to the closure nix hashes, which is exactly the silent stale-daemon hole
 * #2094 documents.
 *
 * So this walker enforces the sharper invariant the derivation keys on: from a
 * daemon's entry files, every reachable RUNTIME import (type-only edges are
 * erased and exempt) must be declared in the importing package's
 * `dependencies` — never a devDependency — and a workspace-member edge must
 * use the `workspace:` protocol (the only edge shape `depClosure` follows).
 * Test files are never walked (entries are runtime roots), so devDependencies
 * remain exactly what they should be: test-only.
 *
 * Also home to the pnpm-workspace.yaml discovery helpers (`workspacePatterns`,
 * `packageDirsUnder`, `workspacePackageRoots`) shared with
 * `no-ungated-forks.test.ts` — one parse of the one source of truth for what a
 * workspace package is.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "@babel/parser";

// ── Workspace discovery (pnpm-workspace.yaml is the one source of truth) ──────

/** The `packages:` patterns from `pnpm-workspace.yaml`. A tiny hand parse (no
 *  `yaml` dep in this zero-dep leaf): the top-level `packages:` block's
 *  `- <pattern>` list entries, stopping at the next column-0 key. */
export function workspacePatterns(repoRoot: string): string[] {
  const raw = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const out: string[] = [];
  let inPackages = false;
  for (const line of raw.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (item?.[1] !== undefined) {
      out.push(item[1].replace(/\s+#.*$/, "").replace(/^["']|["']$/g, ""));
      continue;
    }
    // A column-0 non-comment line ends the block (e.g. `packageExtensions:`).
    if (/^\S/.test(line) && !line.startsWith("#")) break;
  }
  return out;
}

/** Every directory (recursively, excluding node_modules) that contains a
 *  package.json under `base`, mirroring pnpm's `**` expansion. */
export function packageDirsUnder(base: string): string[] {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return out;
    throw err; // a real traversal error is surfaced, never swallowed as "no package"
  }
  if (entries.some((e) => e.isFile() && e.name === "package.json"))
    out.push(base);
  for (const e of entries) {
    if (e.isDirectory() && e.name !== "node_modules") {
      out.push(...packageDirsUnder(join(base, e.name)));
    }
  }
  return out;
}

/** Every workspace package ROOT, derived recursively from the workspace patterns. */
export function workspacePackageRoots(repoRoot: string): string[] {
  const roots = new Set<string>();
  for (const pattern of workspacePatterns(repoRoot)) {
    if (pattern.endsWith("/**")) {
      for (const dir of packageDirsUnder(
        join(repoRoot, pattern.slice(0, -3)),
      )) {
        roots.add(dir);
      }
    } else {
      for (const dir of packageDirsUnder(join(repoRoot, pattern)))
        roots.add(dir);
    }
  }
  return [...roots];
}

// ── AST import extraction ─────────────────────────────────────────────────────

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

/** The RUNTIME import specifiers of `file`. Type-only edges (`import type`,
 *  `export type`, `import("…")` in a type position) are erased by tsx/tsc and
 *  deliberately skipped: a type may legitimately ride a devDependency without
 *  the daemon loading a byte of it. */
function runtimeImportsOf(file: string): string[] {
  const ast = parse(readFileSync(file, "utf8"), {
    sourceFilename: file,
    sourceType: "module",
    createImportExpressions: true,
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;
  const specs = new Set<string>();
  visitAst(ast, (node) => {
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.importKind !== "type" &&
      node.exportKind !== "type"
    ) {
      const spec = stringLiteralValue(node.source);
      if (spec) specs.add(spec);
    }
    if (node.type === "ImportExpression") {
      const spec = stringLiteralValue(node.source);
      if (spec) specs.add(spec);
    }
  });
  return [...specs];
}

// ── Manifest + resolution machinery ───────────────────────────────────────────

type Manifest = {
  name?: string;
  main?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** Resolve a base path to the `.ts`/`.tsx` file it names, or null for a
 *  non-source asset (`.json`/`.css`/`.js`) — inert to the staleKey (nix's
 *  fileFilter drops it too), so the walk skips it. */
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

/** The package name a bare specifier addresses: two segments when scoped
 *  (`@kolu/surface-daemon-supervisor/states` → `@kolu/surface-daemon-supervisor`),
 *  one otherwise (`kaval/foo` → `kaval`). */
const packageNameOf = (spec: string): string => {
  const segs = spec.split("/");
  return spec.startsWith("@")
    ? segs.slice(0, 2).join("/")
    : (segs[0] as string);
};

/** Resolve a bare/subpath specifier into a workspace package's `src` file, via
 *  its `exports` map (falling back to `main`, then `./src/<subpath>`). */
function resolveWorkspaceFile(
  pkgDir: string,
  pkgName: string,
  spec: string,
  manifest: Manifest,
): string | null {
  const sub = spec === pkgName ? "." : `.${spec.slice(pkgName.length)}`;
  const pick = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const t = o.default ?? o.import ?? o.node ?? Object.values(o)[0];
      return typeof t === "string" ? t : undefined;
    }
    return undefined;
  };
  const exp = manifest.exports ?? {};
  const target =
    pick(exp[sub]) ??
    (sub === "."
      ? (pick(exp["."]) ??
        (typeof manifest.main === "string" ? manifest.main : "./src/index"))
      : undefined) ??
    `./src/${spec.slice(pkgName.length + 1)}`;
  return resolveSourceFile(resolve(pkgDir, target));
}

export type DepEdgeViolation = {
  /** Repo-relative importing file. */
  file: string;
  /** The import specifier as written. */
  spec: string;
  /** The importing package's name. */
  owner: string;
  problem:
    | "undeclared" // not in the owner's dependencies (nor devDependencies)
    | "dev-dependency" // runtime code riding a devDependency edge
    | "non-workspace-protocol"; // a workspace member declared without workspace:*
};

/**
 * Walk the runtime import closure from `entries` and check every edge against
 * the importing package's manifest. Returns the violations (empty = the
 * manifests honestly describe the daemon's loadable closure, so nix's derived
 * staleKey is sound) plus the workspace packages reached, for messages.
 */
export function walkRuntimeDepEdges(opts: {
  repoRoot: string;
  entries: string[];
}): { violations: DepEdgeViolation[]; reachedPackages: string[] } {
  const { repoRoot, entries } = opts;

  const manifests = new Map<string, Manifest>();
  const manifestOf = (dir: string): Manifest => {
    let m = manifests.get(dir);
    if (m === undefined) {
      m = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as Manifest;
      manifests.set(dir, m);
    }
    return m;
  };

  // name → package dir, from pnpm's own membership. Nameless members (the
  // e2e-only packages/tests) cannot be imported by name and are skipped.
  const members = new Map<string, string>();
  for (const dir of workspacePackageRoots(repoRoot)) {
    const name = manifestOf(dir).name;
    if (name !== undefined) members.set(name, dir);
  }

  /** The package dir owning `file`: its nearest package.json ancestor. */
  const ownerDirOf = (file: string): string => {
    let dir = dirname(file);
    while (!existsSync(join(dir, "package.json"))) {
      const parent = dirname(dir);
      if (parent === dir)
        throw new Error(`no package.json ancestor for ${file}`);
      dir = parent;
    }
    return dir;
  };

  const violations: DepEdgeViolation[] = [];
  const reached = new Set<string>();
  const visited = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    const ownerDir = ownerDirOf(file);
    const owner = manifestOf(ownerDir);
    const ownerName = owner.name ?? relative(repoRoot, ownerDir);
    reached.add(ownerName);
    for (const spec of runtimeImportsOf(file)) {
      if (spec.startsWith(".")) {
        const r = resolveSourceFile(resolve(dirname(file), spec));
        if (r) stack.push(r); // null = inert asset (.json/.css/.js), skip
        continue;
      }
      if (spec.startsWith("node:")) continue;
      const pkgName = packageNameOf(spec);
      const memberDir = members.get(pkgName);
      if (pkgName !== ownerName) {
        const declared = owner.dependencies?.[pkgName];
        if (declared === undefined) {
          violations.push({
            file: relative(repoRoot, file),
            spec,
            owner: ownerName,
            problem:
              owner.devDependencies?.[pkgName] === undefined
                ? "undeclared"
                : "dev-dependency",
          });
        } else if (
          memberDir !== undefined &&
          !declared.startsWith("workspace:")
        ) {
          violations.push({
            file: relative(repoRoot, file),
            spec,
            owner: ownerName,
            problem: "non-workspace-protocol",
          });
        }
      }
      if (memberDir !== undefined) {
        const f = resolveWorkspaceFile(
          memberDir,
          pkgName,
          spec,
          manifestOf(memberDir),
        );
        if (f === null) {
          throw new Error(
            `unresolved workspace import '${spec}' from ${relative(repoRoot, file)}`,
          );
        }
        stack.push(f);
      }
    }
  }

  return {
    violations: violations.sort((a, b) =>
      `${a.file} ${a.spec}`.localeCompare(`${b.file} ${b.spec}`),
    ),
    reachedPackages: [...reached].sort(),
  };
}
