/**
 * The shared dependency-edge walker behind each daemon's `buildId.closure.test.ts`
 * guard (juspay/kolu#2094).
 *
 * A daemon's `<PREFIX>_BUILD_ID` staleKey is DERIVED in nix: the identity
 * recipe hashes the transitive package.json `dependencies` closure of the
 * daemon's package (`mkWorkspaceClosure`'s `depClosure`, in
 * `packages/surface-daemon/nix/workspace-closure.nix`, minus the daemon's
 * documented `stableLeaves`). No hand-kept file list, no mirror — but the
 * derivation is sound only if the manifests are an honest map of what the
 * daemon process can load. pnpm's isolated node_modules already guarantees an
 * import resolves only through a DECLARED edge; what it does NOT distinguish is
 * `dependencies` from `devDependencies` — a runtime module riding a
 * devDependency link works in every dev install while being invisible to the
 * closure nix hashes, which is exactly the silent stale-daemon hole #2094
 * documents.
 *
 * So this walker enforces the sharper invariant the derivation keys on: from a
 * daemon's entry files, every reachable RUNTIME import (type-only edges are
 * erased and exempt) must be declared in the importing package's
 * `dependencies` — never a devDependency. `depClosure` follows ANY dependency
 * edge whose target is a member (that is what lets it cross a pin boundary);
 * the `workspace:` protocol is the LOUDNESS tripwire in a pnpm monorepo — it is
 * only spellable for a workspace member, so an edge using it whose target is
 * missing from `members` fails nix eval instead of quietly leaving the closure.
 * This walker holds the same rule from the TS side, for the members pnpm
 * discovers in the workspace: their edges must use `workspace:` (a pinned
 * member is spelled however the consuming manifest spells a pin, so it owes
 * only presence — see the pinned-member note below). Test files are never
 * walked (entries are runtime roots), so devDependencies remain exactly what
 * they should be: test-only.
 *
 * `@babel/parser` is a RUNTIME `dependency` of this package, not a
 * devDependency, even though the walker only ever runs from tests: an external
 * consumer resolving this walker out of a `@kolu/*` pin installs the pin's
 * `dependencies` and NOT its devDependencies, so a devDependency edge here
 * would leave their gate unable to import its own parser.
 *
 * ── Pinned members (juspay/kolu#2096) ──
 * The identity machinery graduated out of kolu, so this walker now serves
 * EXTERNAL surface consumers too — repos that vendor a `@kolu/*` package from a
 * content-addressed pin (a nix fetch, a git submodule) instead of the pnpm
 * workspace. `pinnedMembers` names those: `{ <package name>: <absolute dir> }`.
 * A pinned member is walked exactly like a workspace member — its internal
 * relative imports and its own bare edges are checked the same way (ownership
 * is by nearest package.json, so files under a pinned dir need no special
 * casing) — with ONE difference, the protocol rule. `workspace:*` is a pnpm
 * spelling; a pin is declared however the consuming manifest spells a pin (a
 * file: path, a version, a catalog entry), so a pinned edge is required only to
 * be PRESENT in the importer's `dependencies`, at any protocol. A name given in
 * `pinnedMembers` that pnpm ALSO discovers as a workspace member is ambiguous
 * identity — two directories claiming one name — and throws; the caller must
 * pick one.
 *
 * Also home to the pnpm-workspace.yaml discovery helpers (`workspacePatterns`,
 * `packageDirsUnder`, `workspacePackageRoots`) shared with
 * `no-ungated-forks.test.ts` — one parse of the one source of truth for what a
 * workspace package is.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

/** Every workspace member's manifest, cached by package DIRECTORY. One parse per
 *  file no matter how many walks ask — the two walks below both read most of the
 *  tree's manifests. */
const manifests = new Map<string, Manifest>();
function manifestOf(dir: string): Manifest {
  let m = manifests.get(dir);
  if (m === undefined) {
    m = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
    manifests.set(dir, m);
  }
  return m;
}

/** name → package dir, from pnpm's own membership. Nameless members (the
 *  e2e-only `packages/tests`) cannot be depended on or imported BY NAME, so no
 *  edge can reach them and they are skipped — the one rule both walks below
 *  need, stated once. */
function membersByName(repoRoot: string): Map<string, string> {
  const members = new Map<string, string>();
  for (const dir of workspacePackageRoots(repoRoot)) {
    const name = manifestOf(dir).name;
    if (name !== undefined) members.set(name, dir);
  }
  return members;
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
  peerDependencies?: Record<string, string>;
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

/** Resolve a bare/subpath specifier into a member package's `src` file (a
 *  workspace member or a pinned one — same on-disk shape), via its `exports`
 *  map (falling back to `main`, then `./src/<subpath>`). */
function resolveMemberFile(
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
 * staleKey is sound) plus the packages reached, for messages.
 */
export function walkRuntimeDepEdges(opts: {
  repoRoot: string;
  entries: string[];
  /** Absolute directories of PINNED members — packages consumed from a
   *  content-addressed pin rather than the pnpm workspace — keyed by package
   *  name. Walked like workspace members; see the pinned-member note above for
   *  the one rule that differs (protocol) and the ambiguity that throws. */
  pinnedMembers?: Record<string, string>;
}): { violations: DepEdgeViolation[]; reachedPackages: string[] } {
  const { repoRoot, entries, pinnedMembers = {} } = opts;

  const members = membersByName(repoRoot);
  // Only workspace-discovered names owe the `workspace:` protocol; a pin is
  // spelled however the consumer's manifest spells pins, so the two membership
  // kinds are indexed together for walking but kept apart for that one rule.
  const workspaceNames = new Set(members.keys());
  for (const [name, dir] of Object.entries(pinnedMembers)) {
    const workspaceDir = members.get(name);
    if (workspaceDir !== undefined) {
      throw new Error(
        `ambiguous member identity: '${name}' is given as a pinned member (${dir}) but pnpm also discovers it in the workspace (${relative(repoRoot, workspaceDir)}) — pick one (drop it from pinnedMembers, or from pnpm-workspace.yaml)`,
      );
    }
    members.set(name, dir);
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
          workspaceNames.has(pkgName) &&
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
        const f = resolveMemberFile(
          memberDir,
          pkgName,
          spec,
          manifestOf(memberDir),
        );
        if (f === null) {
          throw new Error(
            `unresolved member import '${spec}' from ${relative(repoRoot, file)}`,
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

// ── The DECLARED closure (the TS mirror of nix's `depClosure`) ────────────────

/**
 * The transitive RUNTIME-dependency closure of `entries` over workspace members —
 * what a consumer that VENDORS a package directory actually has to copy, whose
 * manifests it then installs from its own workspace, and (as `externals`) the
 * npm packages those manifests leave for it to install.
 *
 * Distinct from {@link walkRuntimeDepEdges}, and both are needed: that one walks
 * the IMPORT graph (what the code reaches), this one walks the MANIFEST graph
 * (what the packaging costs). A package can sit in the manifest closure while no
 * import path reaches it — and a hydrating consumer pays for it anyway, which is
 * exactly the failure the padi/padi-client split exists to fix. A guard that
 * asked only the import question would pass while the manifest still dragged a
 * PTY host in.
 *
 * ONE edge rule, used for both answers. A runtime edge is a `dependencies` OR a
 * `peerDependencies` entry: a peer is an import like any other, and the
 * arrangement it names — "the app supplies the runtime" — IS what a hydrating
 * consumer's own root manifest is. Deciding that twice is how the member walk and
 * the externals tally come to disagree, and the disagreement is invisible until a
 * workspace member is first reached through a peer edge: it would never enter the
 * closure (so its own subtree goes unwalked) and would be reported as a
 * third-party package. `devDependencies` are deliberately not followed — they
 * never ship, and a hydrating consumer never installs them.
 *
 * This mirrors `mkWorkspaceClosure`'s `depClosure` in nix
 * (`packages/surface-daemon/nix/workspace-closure.nix`), which follows the
 * `dependencies` projection of the same rule because it answers a narrower
 * question — which sources the daemon IDENTITY hashes. No workspace member is
 * peer-depended on today, so the two answers coincide, and
 * `packages/tests/governance/closureWalk.ts` holds them to that by machine: the
 * day a member arrives through a peer edge the conformance check fails, which is
 * the right moment to decide whether the daemon id should cover it — rather than
 * two walks drifting apart in silence.
 *
 * A name in `entries` that is not a workspace member throws: naming a package
 * that does not exist is a stale caller, and answering it with a quiet empty
 * closure is how a gate passes vacuously.
 */
export function declaredDependencyClosure(opts: {
  repoRoot: string;
  entries: readonly string[];
}): { names: string[]; manifestPaths: string[]; externals: string[] } {
  const { repoRoot, entries } = opts;

  const dirOf = membersByName(repoRoot);

  // name → dir for every member REACHED, so the manifest paths below come out of
  // the walk itself rather than a second lookup that has to assert its own hits.
  const reached = new Map<string, string>();
  const outside = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (reached.has(name)) continue;
    const dir = dirOf.get(name);
    if (dir === undefined) {
      throw new Error(
        `declaredDependencyClosure: '${name}' is not a workspace member — a stale entry answered with an empty closure is a gate that passes vacuously`,
      );
    }
    reached.set(name, dir);
    const manifest = manifestOf(dir);
    for (const dep of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    })) {
      if (dirOf.has(dep)) stack.push(dep);
      else outside.add(dep);
    }
  }

  return {
    names: [...reached.keys()].sort(),
    manifestPaths: [...reached.values()]
      .map((dir) =>
        relative(repoRoot, join(dir, "package.json")).split(sep).join("/"),
      )
      .sort(),
    externals: [...outside].sort(),
  };
}
