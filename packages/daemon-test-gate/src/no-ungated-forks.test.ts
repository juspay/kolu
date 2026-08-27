/**
 * The REAL deny-by-default fork inventory (juspay/kolu#1334/#1375, F4).
 *
 * Lock 3's whole safety property is that a bare `vitest` / `pnpm test:unit` forks NO
 * real, long-lived daemon or PTY (the #1375 fork bomb that OOM-reaped a production
 * kaval on a workstation). Two mechanisms enforce it — the ergonomic
 * {@link describeDaemon} gate and the runtime {@link assertDaemonSpawnAllowed} leash —
 * and THIS test is the check that no real-spawn site slips both.
 *
 * ── What changed at F4 (an AST inventory, not a regex net) ──
 * The prior version was an ENUMERATIVE textual scan that (a) walked only immediate
 * `packages/<name>/src` dirs — MISSING nested workspaces like `packages/integrations/
 * claude-code` and `packages/integrations/pty`; (b) recognized a handful of textual
 * spellings; (c) certified a whole FILE on any mention of a gate primitive, so a file
 * that fenced one fork and left another bare passed; and (d) swallowed directory-read
 * failures as "no coverage". This version:
 *   - derives EVERY workspace package root RECURSIVELY from `pnpm-workspace.yaml` (the
 *     one source of truth for what a package is), so nested workspaces are covered;
 *   - parses each `*.{test,testlib}.{ts,cts,mts,tsx}` with `@babel/parser` and finds
 *     the real child-process / node-pty CALL EXPRESSIONS structurally (never a comment
 *     or string false-match);
 *   - RESOLVES the fork funnels' BINDINGS (F4) — the local name each of
 *     `node:child_process` (`spawn`/`fork`/`execFile`/`execFileSync`) and `node-pty`
 *     (`spawn`) is bound to, from a static `import`, a CJS `require`, OR a dynamic
 *     `import()`, incl. `as`/destructure aliases and a namespace `cp.spawn` — and matches
 *     CALLS of the bound name, so `import { spawn as launch }`, `import * as cp`, and a
 *     `.cts` `const { spawn } = require("node:child_process")` no longer hide a fork;
 *   - associates each such call PER-CALL-SITE with its gate STATEMENT-ORDER-CAUSALLY: a
 *     fork is covered iff it is inside a `describeDaemon(...)` block OR an
 *     `assertDaemonSpawnAllowed(...)` leash runs BEFORE it in statement order in an
 *     enclosing scope — so a bare second fork in a partly-gated file, AND a fork followed
 *     by a LATER leash (`spawn(...); assertDaemonSpawnAllowed()`), now both fail;
 *   - throws on any traversal error that is NOT a genuine ENOENT/ENOTDIR.
 *
 * ── Documented residual (this is an ADVISORY HYGIENE lint, not the security barrier) ──
 * The real-fork call shapes recognized are the ones that fork a LONG-LIVED OS process:
 * a binding-resolved child_process fork fn whose arg0 is `process.execPath` (a
 * node/kaval/padi re-exec, incl. the tsx-loader form) or a real detached child
 * (`"sleep"|"systemd-run"|"ssh"`), a binding-resolved `node-pty` `spawn` (any call),
 * `createPtyHost(…)` (a real node-pty host — NOT the no-fork `createInProcessPtyHost`),
 * and `new ShellRunner(…)` (a persistent shell subprocess). DELIBERATELY excluded:
 * short-lived coreutils (`git`, `mkfifo`, …) even through a fork fn (the arg0 heuristic
 * gates them out), `servePtyHostOverUnixSocket` (a SOCKET server over an EXISTING host —
 * not a fork) and `terminal.spawn(` (an RPC verb, not an OS fork).
 *
 * Two things this lint deliberately does NOT do — because a full control-flow proof is
 * beyond an advisory hygiene check, and the SECURITY rests elsewhere:
 *   1. It does not prove a leash DOMINATES the fork. `isForkCovered` requires an
 *      `assertDaemonSpawnAllowed(...)` to precede the fork in STATEMENT ORDER in an
 *      enclosing scope — which closes the realistic "leash after the fork" bypass — but a
 *      leash sitting inside a PRECEDING conditional/loop sibling is still counted as
 *      covering it. A sound dominates-analysis is a CFG pass this lint intentionally omits.
 *   2. It resolves only DIRECT bindings, not fork reachability through arbitrary helper
 *      indirection.
 *   3. It classifies the child_process funnels by the SAME arg0 heuristic, so two shapes
 *      are advisory-UNCOVERED even though they can fork a long-lived process: a
 *      `child_process.fork(modulePath)` — whose arg0 is the module path, never
 *      `process.execPath` (Node supplies the executable implicitly), so it matches
 *      neither the execPath nor the detached-child check even though `fork` is in
 *      {@link CP_FORK_FNS} — and `exec`/`execSync`, which take a shell STRING (not an
 *      arg0 vector) and are not tracked at all. Neither appears in the tree today (every
 *      real spawn is a `spawn`/node-pty/ShellRunner shape); were one added, the structural
 *      barriers below — not this scan — are what keep a bare `vitest` safe, and closing
 *      the advisory gap would mean a fork-specific rule (a local-path arg0) + adding
 *      `exec`/`execSync` with a shell-string execPath match.
 * The real isolation barriers are STRUCTURAL, not this scan: (1) `describeDaemon`'s
 * default-OFF gating — a real fork site lives inside a block that is `describe.skip` when
 * `KOLU_DAEMON_TESTS` is unset, so a bare `vitest` never enters it; and (2) the runtime
 * `assertDaemonSpawnAllowed` leash at the production spawn FUNNELS (F5) plus the testlib
 * spawn helpers, which THROWS from a gate-off worker at the moment of the fork. This lint
 * is the belt-and-suspenders hygiene backstop that catches an ADDED ungated fork by
 * binding-resolved presence; it is not what makes a bare `vitest` safe. A new fork SHAPE
 * that isn't one of the above still needs adding to {@link isForkCall}; the AST makes
 * that a structural edit, not a regex.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { expect, test } from "vitest";
import { workspacePackageRoots } from "./runtimeDepEdges.testlib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/daemon-test-gate/src → the repo root (…/kolu or a worktree).
const REPO_ROOT = join(HERE, "..", "..", "..");

// ── AST plumbing ────────────────────────────────────────────────────────────
type AstNode = { type: string; [key: string]: unknown };

const isAstNode = (v: unknown): v is AstNode =>
  v !== null &&
  typeof v === "object" &&
  typeof (v as { type?: unknown }).type === "string";

/** Depth-first walk carrying the ancestor stack (root → parent) so a per-call-site
 *  gate check can inspect a node's enclosing blocks. */
function walkWithAncestors(
  node: AstNode,
  ancestors: AstNode[],
  visit: (node: AstNode, ancestors: AstNode[]) => void,
): void {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value)
        if (isAstNode(item)) walkWithAncestors(item, next, visit);
    } else if (isAstNode(value)) {
      walkWithAncestors(value, next, visit);
    }
  }
}

/** True if `node`'s subtree contains any node matching `pred`. */
function subtreeHas(node: AstNode, pred: (n: AstNode) => boolean): boolean {
  let found = false;
  walkWithAncestors(node, [], (n) => {
    if (!found && pred(n)) found = true;
  });
  return found;
}

const identName = (n: unknown): string | null =>
  isAstNode(n) && n.type === "Identifier" && typeof n.name === "string"
    ? n.name
    : null;

const stringValue = (n: unknown): string | null =>
  isAstNode(n) && n.type === "StringLiteral" && typeof n.value === "string"
    ? n.value
    : null;

const calleeName = (node: AstNode): string | null => {
  const callee = node.callee;
  if (isAstNode(callee) && callee.type === "Identifier") {
    return typeof callee.name === "string" ? callee.name : null;
  }
  return null;
};

/** The property name of a `<obj>.<prop>(…)` call, plus the object's identifier name. */
function memberCallee(node: AstNode): { obj: string; prop: string } | null {
  const callee = node.callee;
  if (!isAstNode(callee) || callee.type !== "MemberExpression") return null;
  const obj = callee.object;
  const prop = callee.property;
  if (
    isAstNode(obj) &&
    obj.type === "Identifier" &&
    typeof obj.name === "string" &&
    isAstNode(prop) &&
    prop.type === "Identifier" &&
    typeof prop.name === "string"
  ) {
    return { obj: obj.name, prop: prop.name };
  }
  return null;
}

const stringArg0 = (node: AstNode): string | null => {
  const args = node.arguments;
  if (!Array.isArray(args) || args.length === 0) return null;
  const a0 = args[0];
  return isAstNode(a0) &&
    a0.type === "StringLiteral" &&
    typeof a0.value === "string"
    ? a0.value
    : null;
};

const isProcessExecPathArg0 = (node: AstNode): boolean => {
  const args = node.arguments;
  if (!Array.isArray(args) || args.length === 0) return false;
  const a0 = args[0];
  if (!isAstNode(a0) || a0.type !== "MemberExpression") return false;
  const obj = a0.object;
  const prop = a0.property;
  return (
    isAstNode(obj) &&
    obj.type === "Identifier" &&
    obj.name === "process" &&
    isAstNode(prop) &&
    prop.type === "Identifier" &&
    prop.name === "execPath"
  );
};

const REAL_DETACHED_CHILD = new Set(["sleep", "systemd-run", "ssh"]);

// The fork FUNNELS whose IMPORTED BINDINGS we resolve (F4): matching CALLS of the
// bound name — incl. an `as` alias and a namespace member — rather than a textual
// spelling, so `import { spawn as launch }` / `import * as cp` cannot hide a fork.
const CHILD_PROCESS_MODULES = new Set(["node:child_process", "child_process"]);
const NODE_PTY_MODULE = "node-pty";
// child_process fork/exec funnels that can launch a long-lived process.
const CP_FORK_FNS = new Set(["spawn", "fork", "execFile", "execFileSync"]);

/** The local names / namespace aliases the fork funnels are bound to IN THIS FILE. */
type ForkBindings = {
  /** Local names bound to a `node:child_process` fork fn (incl. `as` aliases). */
  cpFns: Set<string>;
  /** Namespace aliases of `node:child_process` (`import * as cp` → `cp.spawn`). */
  cpNamespaces: Set<string>;
  /** Local names bound to `node-pty`'s `spawn` (incl. `as` aliases). */
  ptySpawns: Set<string>;
  /** Namespace aliases of `node-pty` (`import * as pty` → `pty.spawn`). */
  ptyNamespaces: Set<string>;
};

/** The module a `require(...)` / dynamic `import(...)` call (optionally `await`ed) loads,
 *  or `null`. Resolves the CJS + dynamic binding forms an `ImportDeclaration`-only scan
 *  missed (F4) — e.g. a `.test.cts` doing `const { spawn } = require("node:child_process")`.
 *  `import(...)` parses here as a `CallExpression` with an `Import` callee (this file's
 *  parser does not set `createImportExpressions`), but the `ImportExpression` form is
 *  accepted too for robustness. */
function requiredOrImportedModule(init: unknown): string | null {
  let node = init;
  if (isAstNode(node) && node.type === "AwaitExpression") node = node.argument;
  if (!isAstNode(node)) return null;
  if (node.type === "ImportExpression") return stringValue(node.source);
  if (node.type === "CallExpression") {
    const callee = node.callee;
    const isImport = isAstNode(callee) && callee.type === "Import";
    const isRequire = identName(callee) === "require";
    if (!isImport && !isRequire) return null;
    const args = node.arguments;
    return stringValue(Array.isArray(args) ? args[0] : undefined);
  }
  return null;
}

/** Bind the fork funnels selected by an id pattern against a `require`/`import` of a fork
 *  module: an Identifier id binds the whole module (namespace), an ObjectPattern binds each
 *  destructured fork fn under its (possibly aliased / computed-string) local name. */
function bindDestructuredFork(
  id: unknown,
  isCp: boolean,
  b: ForkBindings,
): void {
  if (isAstNode(id) && id.type === "Identifier") {
    const local = identName(id);
    if (local) (isCp ? b.cpNamespaces : b.ptyNamespaces).add(local);
    return;
  }
  if (!isAstNode(id) || id.type !== "ObjectPattern") return;
  for (const p of (id.properties as AstNode[]) ?? []) {
    if (p.type !== "ObjectProperty") continue;
    const key = identName(p.key) ?? stringValue(p.key);
    const local = identName(p.value) ?? key; // `value` is the (aliased) local binding
    if (key === null || local === null) continue;
    if (isCp && CP_FORK_FNS.has(key)) b.cpFns.add(local);
    if (!isCp && key === "spawn") b.ptySpawns.add(local);
  }
}

/** Resolve every `node:child_process` / `node-pty` fork binding in `ast` (F4) — from a
 *  static `import`, a CJS `require`, OR a dynamic `import()` (incl. an awaited one). A
 *  namespace / default / whole-module binding resolves members by property; a named or
 *  destructured import binds each fork fn under its local (aliased) name. */
function collectForkBindings(ast: AstNode): ForkBindings {
  const b: ForkBindings = {
    cpFns: new Set(),
    cpNamespaces: new Set(),
    ptySpawns: new Set(),
    ptyNamespaces: new Set(),
  };
  walkWithAncestors(ast, [], (n) => {
    if (n.type === "ImportDeclaration") {
      const src = stringValue(n.source);
      if (src === null) return;
      const isCp = CHILD_PROCESS_MODULES.has(src);
      const isPty = src === NODE_PTY_MODULE;
      if (!isCp && !isPty) return;
      for (const spec of (n.specifiers as AstNode[]) ?? []) {
        if (
          spec.type === "ImportNamespaceSpecifier" ||
          spec.type === "ImportDefaultSpecifier"
        ) {
          const local = identName(spec.local);
          if (local) (isCp ? b.cpNamespaces : b.ptyNamespaces).add(local);
        } else if (spec.type === "ImportSpecifier") {
          const imported = identName(spec.imported);
          const local = identName(spec.local) ?? imported;
          if (imported === null || local === null) continue;
          if (isCp && CP_FORK_FNS.has(imported)) b.cpFns.add(local);
          if (isPty && imported === "spawn") b.ptySpawns.add(local);
        }
      }
      return;
    }
    // CJS `require(...)` / dynamic `import(...)` bound through a variable declarator:
    // `const { spawn } = require("node:child_process")`, `const cp = require(...)`,
    // `const { spawn } = await import("node-pty")`, … (F4).
    if (n.type === "VariableDeclarator") {
      const src = requiredOrImportedModule(n.init);
      if (src === null) return;
      const isCp = CHILD_PROCESS_MODULES.has(src);
      const isPty = src === NODE_PTY_MODULE;
      if (!isCp && !isPty) return;
      bindDestructuredFork(n.id, isCp, b);
    }
  });
  return b;
}

/** Resolve a call's callee to a fork FAMILY via the file's bindings, or `null`. */
function resolveForkCallee(
  node: AstNode,
  b: ForkBindings,
): "cp-fork" | "pty-spawn" | "createPtyHost" | null {
  const name = calleeName(node);
  if (name !== null) {
    // `createPtyHost(…)` — a real node-pty host (NOT the no-fork `createInProcessPtyHost`).
    // A kolu helper, matched by name (not a child_process/node-pty binding).
    if (name === "createPtyHost") return "createPtyHost";
    if (b.cpFns.has(name)) return "cp-fork";
    if (b.ptySpawns.has(name)) return "pty-spawn";
    return null;
  }
  const member = memberCallee(node);
  if (member === null) return null;
  if (b.cpNamespaces.has(member.obj) && CP_FORK_FNS.has(member.prop))
    return "cp-fork";
  if (b.ptyNamespaces.has(member.obj) && member.prop === "spawn")
    return "pty-spawn";
  return null;
}

/** Does `node` fork a real, long-lived OS process? Resolved by IMPORTED BINDING (F4),
 *  not textual spelling. (See the header for the shapes and deliberate exclusions.) */
function isForkCall(node: AstNode, b: ForkBindings): boolean {
  if (node.type === "NewExpression") {
    return calleeName(node) === "ShellRunner";
  }
  if (node.type !== "CallExpression") return false;
  const resolved = resolveForkCallee(node, b);
  // A node-pty `spawn` is ALWAYS a real PTY fork (its arg is a shell path, not a
  // leash-able marker), as is `createPtyHost`.
  if (resolved === "pty-spawn" || resolved === "createPtyHost") return true;
  // A child_process fork fn (spawn/fork/execFile/execFileSync, by binding) forks a real,
  // long-lived process only when its arg0 marks one: `process.execPath` (a node/kaval/
  // padi re-exec) or a known real detached child. Other targets (git, mkfifo, …) are
  // short-lived utilities the leash does not guard — see the header's residual.
  if (resolved === "cp-fork") {
    if (isProcessExecPathArg0(node)) return true;
    const s = stringArg0(node);
    if (s !== null && REAL_DETACHED_CHILD.has(s)) return true;
  }
  return false;
}

const isDescribeDaemonCall = (n: AstNode): boolean =>
  n.type === "CallExpression" && calleeName(n) === "describeDaemon";

const isAssertSpawnAllowedCall = (n: AstNode): boolean =>
  n.type === "CallExpression" && calleeName(n) === "assertDaemonSpawnAllowed";

/** Does an `assertDaemonSpawnAllowed(...)` leash appear BEFORE `fork` in STATEMENT ORDER
 *  within an enclosing scope (F4)? Walks `fork`'s ancestor chain; at each enclosing block /
 *  statement list, scans the siblings that PRECEDE the branch leading to the fork for a
 *  leash call. A leash in a PRECEDING sibling statement executes before control reaches the
 *  fork; a leash AFTER the fork (or below it in the same block) never does — closing the
 *  `spawn(...); assertDaemonSpawnAllowed()` bypass the old presence-anywhere check certified.
 *  This is statement-order-before, NOT a full dominance proof: a leash sitting inside a
 *  PRECEDING conditional/loop sibling is still counted (a CFG dominates-analysis is out of
 *  scope — see the header). */
function precededByLeash(ancestors: AstNode[], fork: AstNode): boolean {
  const chain = [...ancestors, fork]; // root → … → fork
  for (let i = chain.length - 1; i >= 1; i--) {
    const parent = chain[i - 1];
    const child = chain[i];
    if (parent === undefined || child === undefined) continue;
    for (const value of Object.values(parent)) {
      if (!Array.isArray(value)) continue;
      const idx = value.indexOf(child);
      if (idx < 0) continue;
      for (let j = 0; j < idx; j++) {
        const sib = value[j];
        if (isAstNode(sib) && subtreeHas(sib, isAssertSpawnAllowedCall))
          return true;
      }
    }
  }
  return false;
}

/** Is this fork call PER-CALL-SITE covered by the gate? Covered iff some ANCESTOR is a
 *  `describeDaemon(...)` block (the whole block is `describe.skip` when the gate is off),
 *  OR an `assertDaemonSpawnAllowed(...)` leash runs BEFORE it in statement order within an
 *  enclosing scope (the runtime leash — so a helper that leashes THEN forks is covered, but
 *  a fork followed by a later leash, or a bare fork in a different function, is not). The
 *  leash check is statement-order-causal, not a dominance proof — see the header. */
function isForkCovered(ancestors: AstNode[], fork: AstNode): boolean {
  for (const a of ancestors) {
    if (isDescribeDaemonCall(a)) return true;
  }
  return precededByLeash(ancestors, fork);
}

// ── Workspace + file discovery ────────────────────────────────────────────────
// The pnpm-workspace.yaml discovery (patterns → recursive package roots) lives
// in `runtimeDepEdges.testlib.ts`, shared with the daemons' dependency-edge
// guards — one parse of the one source of truth for what a package is.

const isTestFile = (name: string): boolean =>
  /\.(test|testlib)\.(ts|cts|mts|tsx)$/.test(name);

/** Every test/testlib file under `dir` (recursively, excluding node_modules). */
function testFilesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return out;
    throw err;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") out.push(...testFilesUnder(full));
    } else if (e.isFile() && isTestFile(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function allTestFiles(): string[] {
  const files = new Set<string>();
  for (const root of workspacePackageRoots(REPO_ROOT)) {
    for (const f of testFilesUnder(root)) files.add(f);
  }
  return [...files];
}

function parseSource(code: string): AstNode {
  return parse(code, {
    sourceType: "module",
    plugins: ["typescript"],
  }) as unknown as AstNode;
}

function parseFile(file: string): AstNode {
  const plugins: ("typescript" | "jsx")[] = ["typescript"];
  if (file.endsWith(".tsx")) plugins.push("jsx");
  return parse(readFileSync(file, "utf8"), {
    sourceFilename: file,
    sourceType: "module",
    plugins,
  }) as unknown as AstNode;
}

test("advisory hygiene: every real-spawn test site is describeDaemon-gated or statement-order-leashed, per call-site (a backstop, not a dominance proof — F4)", {
  // A whole-repo AST walk — its cost tracks checkout count and parse-cache
  // warmth, not this test's logic. ~4.7s warm; a fresh CI snapshot's cold
  // transform cache blows the 5s default, as e0f1457's linux lane did.
  timeout: 60000,
}, () => {
  const offenders: string[] = [];
  for (const file of allTestFiles()) {
    let ast: AstNode;
    try {
      ast = parseFile(file);
    } catch (err) {
      // A test file that won't parse is a real defect — surface it, never skip silently.
      throw new Error(`failed to parse ${file}: ${(err as Error).message}`);
    }
    // Resolve THIS file's fork-funnel import bindings first, so calls are matched by
    // bound name (incl. `as` aliases and namespace members), never a textual spelling.
    const bindings = collectForkBindings(ast);
    walkWithAncestors(ast, [], (node, ancestors) => {
      if (isForkCall(node, bindings) && !isForkCovered(ancestors, node)) {
        const loc = node.loc as { start?: { line?: number } } | undefined;
        offenders.push(`${file}:${loc?.start?.line ?? "?"}`);
      }
    });
  }
  expect(
    offenders,
    `these test sites fork a real, long-lived daemon/PTY/shell but are NOT behind the ` +
      `daemon-test gate at the CALL SITE — wrap the forking block in \`describeDaemon(...)\` ` +
      `(so a bare \`vitest\` skips it) or call \`assertDaemonSpawnAllowed(...)\` in the same ` +
      `function before the fork, both from \`@kolu/daemon-test-gate\` ` +
      `(juspay/kolu#1334/#1375):\n${offenders.join("\n")}`,
  ).toEqual([]);
});

// ── Lane assignment: which CI node runs a package's suite ────────────────────
//
// CI has two workspace-wide suite nodes: `unit` (fork-free, gate OFF) and
// `daemon` (gate ON). Which one runs a package is decided by the SCRIPT NAME its
// manifest declares — `test:unit` or `test:daemon` — because `pnpm -r <script>`
// already skips a package that doesn't have it. That is the whole selector: no
// filter list to keep in sync, and each suite runs in exactly ONE lane instead
// of twice (before this split both recipes traversed all 54 suites, so every
// fork-free test in the tree ran a second time under the gate for nothing).
//
// The split is only safe while the manifest agrees with the code, which is what
// the two tests below hold: a package holding a gate call site MUST be in the
// daemon lane (else its gated blocks are `describe.skip` forever and the
// coverage evaporates silently — #1375 A7's failure mode, one level down), and
// a package with tests must be in exactly one lane (else its suite runs
// nowhere, or twice again).

const LANE_SCRIPTS = ["test:unit", "test:daemon"] as const;

/** The nearest workspace package root at or above `file` — nearest, so a nested
 *  member (`packages/surface/example/mini-ci`) owns its own files rather than
 *  its parent claiming them. */
function owningPackage(file: string, roots: readonly string[]): string {
  let owner = "";
  for (const root of roots) {
    if (
      (file === root || file.startsWith(root + sep)) &&
      root.length > owner.length
    ) {
      owner = root;
    }
  }
  if (owner === "") {
    // Every file here came from a walk rooted AT a package, so no owner means
    // the walk and the roots disagree — a real defect, never a skipped file.
    throw new Error(`no workspace package owns ${file}`);
  }
  return owner;
}

/** The lane scripts a package declares (0, 1, or — a defect — 2). */
function lanesOf(packageRoot: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, unknown> };
  const scripts = manifest.scripts ?? {};
  return LANE_SCRIPTS.filter((s) => scripts[s] !== undefined);
}

const show = (p: string): string => relative(REPO_ROOT, p);

test("a package holding a daemon-gate call site declares `test:daemon`, so the daemon lane actually runs it", {
  // Same whole-repo AST walk as the inventory above — see its timeout note.
  timeout: 60000,
}, () => {
  const roots = workspacePackageRoots(REPO_ROOT);
  const gated = new Set<string>();
  for (const file of allTestFiles()) {
    const ast = parseFile(file);
    let hit = false;
    walkWithAncestors(ast, [], (node) => {
      if (isDescribeDaemonCall(node) || isAssertSpawnAllowedCall(node))
        hit = true;
    });
    if (hit) gated.add(owningPackage(file, roots));
  }
  // The gate's OWN package names these primitives to test them (here, and
  // against synthetic sources); it forks nothing. It also holds
  // `daemon-node.test.ts`, the backstop that fails when the `daemon` CI node is
  // unwired — which only works from the always-on lane, since a test inside the
  // node it guards disappears with it. So the gate stays fork-free by
  // construction and in `test:unit` on purpose.
  gated.delete(join(HERE, ".."));
  const misfiled = [...gated]
    .filter((root) => !lanesOf(root).includes("test:daemon"))
    .map(show)
    .sort();
  expect(
    misfiled,
    `these packages hold a \`describeDaemon(...)\` / \`assertDaemonSpawnAllowed(...)\` ` +
      `call site but declare \`test:unit\`, so \`just test-daemon\` (which runs ` +
      `\`pnpm -r test:daemon\`) skips them and every gated block in them is ` +
      `\`describe.skip\` in BOTH CI lanes. Rename the manifest's \`test:unit\` script ` +
      `to \`test:daemon\`:\n${misfiled.join("\n")}`,
  ).toEqual([]);
});

test("every test-bearing package declares exactly one lane script, so its suite runs in exactly one CI node", () => {
  const roots = workspacePackageRoots(REPO_ROOT);
  const withTests = new Set<string>();
  for (const file of allTestFiles()) {
    // `.testlib.ts` files are helpers vitest never collects on their own; a
    // package needs a lane only if it owns a real `*.test.*` file.
    if (/\.test\.(ts|cts|mts|tsx)$/.test(file))
      withTests.add(owningPackage(file, roots));
  }
  const offenders = [...withTests]
    .map((root) => ({ root, lanes: lanesOf(root) }))
    .filter(({ lanes }) => lanes.length !== 1)
    .map(({ root, lanes }) => `${show(root)}: [${lanes.join(", ")}]`)
    .sort();
  expect(
    offenders,
    `each of these packages owns test files but declares neither or both of ` +
      `\`test:unit\` / \`test:daemon\`. Neither ⇒ \`pnpm -r\` skips it in both CI ` +
      `lanes and the suite runs NOWHERE; both ⇒ it runs twice. Declare exactly ` +
      `one:\n${offenders.join("\n")}`,
  ).toEqual([]);
});

// ── Binding-resolution fixtures (F4): each is a tiny SYNTHETIC source proving a call is
// resolved (or NOT) by its IMPORTED BINDING, so an aliased/namespaced fork can't hide and
// a short-lived utility isn't false-flagged. A regression fails HERE, not only in the
// tree. ─────────────────────────────────────────────────────────────────────────────────
const forkDetected = (code: string): boolean => {
  const ast = parseSource(code);
  const bindings = collectForkBindings(ast);
  let hit = false;
  walkWithAncestors(ast, [], (node) => {
    if (isForkCall(node, bindings)) hit = true;
  });
  return hit;
};

test("F4 fixture: an ALIASED child_process.spawn import (`spawn as launch`) forking execPath is detected", () => {
  expect(
    forkDetected(
      `import { spawn as launch } from "node:child_process";\n` +
        `launch(process.execPath, ["--serve"]);`,
    ),
  ).toBe(true);
});

test("F4 fixture: a NAMESPACE child_process import (`cp.spawn`) forking a detached child is detected", () => {
  expect(
    forkDetected(
      `import * as cp from "node:child_process";\n` +
        `cp.spawn("systemd-run", ["--user", "sleep", "1"]);`,
    ),
  ).toBe(true);
});

test("F4 fixture: an ALIASED node-pty spawn (`spawn as ptySpawn`) is detected (a PTY fork)", () => {
  expect(
    forkDetected(
      `import { spawn as ptySpawn } from "node-pty";\nptySpawn("bash", []);`,
    ),
  ).toBe(true);
});

test("F4 fixture: an aliased execFileSync on a SHORT-LIVED utility (git/mkfifo) is NOT flagged", () => {
  // Binding-resolved, but the arg0 heuristic keeps a short-lived coreutil off the
  // inventory — otherwise every `git`/`mkfifo` test helper would trip the gate.
  expect(
    forkDetected(
      `import { execFileSync as run } from "node:child_process";\n` +
        `run("git", ["status"]);\nrun("mkfifo", ["/tmp/x"]);`,
    ),
  ).toBe(false);
});

test("F4 fixture: a `spawn` NOT bound to child_process/node-pty is not resolved (no textual false-match)", () => {
  // A local `spawn` from an unrelated module must not be matched by spelling alone.
  expect(
    forkDetected(
      `import { spawn } from "./my-actor-lib.ts";\nspawn(process.execPath);`,
    ),
  ).toBe(false);
});

test("F4 fixture: a `.cts`-style CJS `require` destructure binding of child_process.spawn is resolved", () => {
  // The exact bypass an ImportDeclaration-only scan missed: a `.test.cts` forks through a
  // `require(...)` destructure, no static import in sight.
  expect(
    forkDetected(
      `const { spawn } = require("node:child_process");\n` +
        `spawn(process.execPath, ["--serve"]);`,
    ),
  ).toBe(true);
  // Aliased destructure + whole-module namespace require both resolve too.
  expect(
    forkDetected(
      `const { spawn: launch } = require("node:child_process");\n` +
        `launch(process.execPath);`,
    ),
  ).toBe(true);
  expect(
    forkDetected(
      `const cp = require("node:child_process");\n` +
        `cp.spawn("systemd-run", ["--user", "sleep", "1"]);`,
    ),
  ).toBe(true);
});

test("F4 fixture: a dynamic `import()` destructure binding of node-pty spawn is resolved", () => {
  expect(
    forkDetected(
      `const { spawn } = await import("node-pty");\nspawn("bash", []);`,
    ),
  ).toBe(true);
});

// ── Statement-order-causal coverage fixtures (F4): a leash only covers a fork it PRECEDES.
// `uncoveredForks` reports the lines of forks the gate does NOT cover. ───────────────────
const uncoveredForks = (code: string): number[] => {
  const ast = parseSource(code);
  const bindings = collectForkBindings(ast);
  const lines: number[] = [];
  walkWithAncestors(ast, [], (node, ancestors) => {
    if (isForkCall(node, bindings) && !isForkCovered(ancestors, node)) {
      const loc = node.loc as { start?: { line?: number } } | undefined;
      lines.push(loc?.start?.line ?? -1);
    }
  });
  return lines;
};

test("F4 fixture: a leash AFTER the fork does NOT cover it (the `spawn(...); assert()` bypass)", () => {
  // An assertion placed after the fork cannot gate a fork that already threw — it must be
  // flagged, exactly as a fully-bare fork would be.
  expect(
    uncoveredForks(
      `import { spawn } from "node:child_process";\n` +
        `it("x", () => {\n` +
        `  spawn(process.execPath, ["--serve"]);\n` +
        `  assertDaemonSpawnAllowed("too late");\n` +
        `});`,
    ),
  ).toHaveLength(1);
});

test("F4 fixture: a leash BEFORE the fork in the enclosing scope DOES cover it", () => {
  // The funnel-helper pattern — leash, then fork — is covered; the fork may be nested in
  // an inner callback, as long as the leash precedes the statement that reaches it.
  expect(
    uncoveredForks(
      `import { spawn } from "node:child_process";\n` +
        `function helper() {\n` +
        `  assertDaemonSpawnAllowed("early");\n` +
        `  return new Promise((res) => spawn(process.execPath, ["--serve"]).on("exit", res));\n` +
        `}`,
    ),
  ).toEqual([]);
});
