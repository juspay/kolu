import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse } from "@babel/parser";
import { Yaml } from "effect/encoding";

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
    throw err;
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

/**
 * The `packageExtensions` edges this pnpm workspace declares: `member → dep →
 * spec`.
 */
export function workspacePackageExtensions(
  repoRoot: string,
): Map<string, Record<string, string>> {
  const raw = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const parsed = Yaml.parse(raw) as {
    packageExtensions?: Record<string, Record<string, unknown>>;
  };
  const out = new Map<string, Record<string, string>>();
  for (const [member, extension] of Object.entries(
    parsed.packageExtensions ?? {},
  )) {
    const deps: Record<string, string> = {};
    for (const section of ["dependencies", "optionalDependencies"]) {
      const entries = extension[section];
      if (entries === undefined || typeof entries !== "object") continue;
      for (const [dep, spec] of Object.entries(
        entries as Record<string, unknown>,
      )) {
        if (typeof spec === "string") deps[dep] = spec;
      }
    }
    if (Object.keys(deps).length > 0) out.set(member, deps);
  }
  return out;
}

/**
 * The GRAFTED members — the packages kolu does not own: it copies their bytes out
 * of an npins pin (`osfacts-client` from `osfacts`, the `@odu/*` trio from `odu`)
 * and gitignores them. Package name → its REPO-RELATIVE directory, exactly as the
 * artifact spells it (`odu/service-client`), so a caller that wants an absolute
 * path joins `repoRoot` itself and a caller that wants a manifest path appends.
 */
export function graftedMembers(repoRoot: string): Map<string, string> {
  const names = new Map<string, string>();
  let parsed: { members?: Record<string, { dir?: string; pin?: unknown }> };
  try {
    parsed = JSON.parse(
      readFileSync(join(repoRoot, "nix", "consumer-closure.json"), "utf8"),
    ) as typeof parsed;
  } catch {
    return names;
  }
  for (const [name, member] of Object.entries(parsed.members ?? {})) {
    if (member.pin !== undefined && member.dir !== undefined) {
      names.set(name, member.dir);
    }
  }
  return names;
}

const manifestsByDirAndMtime = new Map<
  string,
  { mtimeMs: number; manifest: Manifest }
>();

function readManifestFromFd(fd: number): Manifest {
  return JSON.parse(readFileSync(fd, "utf8")) as Manifest;
}

function manifestOf(dir: string): Manifest {
  const fd = openSync(join(dir, "package.json"), "r");
  try {
    const { mtimeMs } = fstatSync(fd);
    const hit = manifestsByDirAndMtime.get(dir);
    if (hit !== undefined && hit.mtimeMs === mtimeMs) return hit.manifest;
    const manifest = readManifestFromFd(fd);
    manifestsByDirAndMtime.set(dir, { mtimeMs, manifest });
    return manifest;
  } finally {
    closeSync(fd);
  }
}

function membersByName(repoRoot: string): Map<string, string> {
  const members = new Map<string, string>();
  for (const dir of workspacePackageRoots(repoRoot)) {
    const name = manifestOf(dir).name;
    if (name !== undefined) members.set(name, dir);
  }
  return members;
}

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

function importSpecifiers(file: string, includeTypeOnly: boolean): string[] {
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
      (includeTypeOnly ||
        (node.importKind !== "type" && node.exportKind !== "type"))
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

const runtimeImportsOf = (file: string): string[] =>
  importSpecifiers(file, false);

const allImportsOf = (file: string): string[] => importSpecifiers(file, true);

export type Manifest = {
  name?: string;
  main?: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

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

const packageNameOf = (spec: string): string => {
  const segs = spec.split("/");
  return spec.startsWith("@")
    ? segs.slice(0, 2).join("/")
    : (segs[0] as string);
};

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
 * staleKey is sound), the packages reached, and the cross-package SPECIFIERS
 * crossed to reach them.
 */
export function walkRuntimeDepEdges(opts: {
  repoRoot: string;
  entries: string[];
  /** Absolute directories of PINNED members — packages consumed from a
   *  content-addressed pin rather than the pnpm workspace — keyed by package
   *  name. */
  pinnedMembers?: Record<string, string>;
  /** Count `import type` / `export type` edges as real. Off by default (a type
   *  edge is erased and contributes nothing to a daemon's build identity); ON
   *  for the question "what must a consumer of this package install". */
  includeTypeOnly?: boolean;
}): {
  violations: DepEdgeViolation[];
  reachedPackages: string[];
  reachedSpecifiers: string[];
} {
  const {
    repoRoot,
    entries,
    pinnedMembers = {},
    includeTypeOnly = false,
  } = opts;
  const importsOfFile = includeTypeOnly ? allImportsOf : runtimeImportsOf;

  const members = membersByName(repoRoot);
  const extensions = workspacePackageExtensions(repoRoot);
  const declaredEdge = (owner: Manifest, pkgName: string): string | undefined =>
    extensions.get(owner.name ?? "")?.[pkgName] ??
    owner.dependencies?.[pkgName];
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
  const crossed = new Set<string>();
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
    for (const spec of importsOfFile(file)) {
      if (spec.startsWith(".")) {
        const r = resolveSourceFile(resolve(dirname(file), spec));
        if (r) stack.push(r);
        continue;
      }
      if (spec.startsWith("node:")) continue;
      const pkgName = packageNameOf(spec);
      const memberDir = members.get(pkgName);
      if (pkgName !== ownerName) {
        crossed.add(spec);
        const declared = declaredEdge(owner, pkgName);
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
    reachedSpecifiers: [...crossed].sort(),
  };
}

/** A member's DECLARED runtime edges: `dependencies` + `peerDependencies`
 *  (never `devDependencies` — they never ship, and a hydrating consumer that
 *  copies a directory installs only what it declares at runtime), plus what this
 *  workspace declares for the member in `packageExtensions` — an edge a GRAFTED
 *  member's manifest cannot spell, because the `@kolu/*` packages its source
 *  imports do not exist in the repo it is authored in (see
 *  {@link workspacePackageExtensions}). Spec string per package name, later
 *  spreads winning, which is what makes the extension an override. */
export function declaredRuntimeEdges(
  manifest: Manifest,
  extension: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...extension,
  };
}

/**
 * The transitive RUNTIME-dependency closure of `entries` over workspace members —
 * what a consumer that VENDORS a package directory actually has to copy, whose
 * manifests it then installs from its own workspace, and (as `externals`) the
 * npm packages those manifests leave for it to install.
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
  const extensions = workspacePackageExtensions(repoRoot);

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
    for (const dep of Object.keys(
      declaredRuntimeEdges(manifestOf(dir), extensions.get(name)),
    )) {
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
