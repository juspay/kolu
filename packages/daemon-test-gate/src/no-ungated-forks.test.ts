import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { expect, test } from "vitest";
import {
  graftedMembers,
  workspacePackageRoots,
} from "./runtimeDepEdges.testlib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

type AstNode = { type: string; [key: string]: unknown };

const isAstNode = (v: unknown): v is AstNode =>
  v !== null &&
  typeof v === "object" &&
  typeof (v as { type?: unknown }).type === "string";

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

const LONG_LIVED_ARG0: Record<string, true> = {
  sleep: true,
  "systemd-run": true,
  ssh: true,
};

const CHILD_PROCESS_MODULES = new Set(["node:child_process", "child_process"]);
const NODE_PTY_MODULE = "node-pty";
const CP_FORK_FNS = new Set(["spawn", "fork", "execFile", "execFileSync"]);

type ForkFamily = "cp-fork" | "pty-spawn" | "createPtyHost" | "shell-runner";

const FORK_SHAPES: Record<ForkFamily, "any-arg0" | "long-lived-arg0"> = {
  "cp-fork": "long-lived-arg0",
  "pty-spawn": "any-arg0",
  createPtyHost: "any-arg0",
  "shell-runner": "any-arg0",
};

type ForkBindings = {
  cpFns: Set<string>;
  cpNamespaces: Set<string>;
  ptySpawns: Set<string>;
  ptyNamespaces: Set<string>;
};

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
    const local = identName(p.value) ?? key;
    if (key === null || local === null) continue;
    if (isCp && CP_FORK_FNS.has(key)) b.cpFns.add(local);
    if (!isCp && key === "spawn") b.ptySpawns.add(local);
  }
}

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

function resolveForkFamily(node: AstNode, b: ForkBindings): ForkFamily | null {
  if (node.type === "NewExpression") {
    return calleeName(node) === "ShellRunner" ? "shell-runner" : null;
  }
  if (node.type !== "CallExpression") return null;
  const name = calleeName(node);
  if (name !== null) {
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

const hasLongLivedArg0 = (node: AstNode): boolean => {
  if (isProcessExecPathArg0(node)) return true;
  const arg0 = stringArg0(node);
  return arg0 !== null && LONG_LIVED_ARG0[arg0] === true;
};

function isForkCall(node: AstNode, b: ForkBindings): boolean {
  const family = resolveForkFamily(node, b);
  if (family === null) return false;
  return FORK_SHAPES[family] === "any-arg0" || hasLongLivedArg0(node);
}

const isDescribeDaemonCall = (n: AstNode): boolean =>
  n.type === "CallExpression" && calleeName(n) === "describeDaemon";

const isAssertSpawnAllowedCall = (n: AstNode): boolean =>
  n.type === "CallExpression" && calleeName(n) === "assertDaemonSpawnAllowed";

function leashInPrecedingStatement(
  ancestors: AstNode[],
  fork: AstNode,
): boolean {
  const chain = [...ancestors, fork];
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

function forkHasPrecedingLeashOrGateAncestor(
  ancestors: AstNode[],
  fork: AstNode,
): boolean {
  for (const a of ancestors) {
    if (isDescribeDaemonCall(a)) return true;
  }
  return leashInPrecedingStatement(ancestors, fork);
}

const isTestFile = (name: string): boolean =>
  /\.(test|testlib)\.(ts|cts|mts|tsx)$/.test(name);

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
  const grafted = graftedRoots();
  for (const root of workspacePackageRoots(REPO_ROOT)) {
    if (grafted.has(root)) continue;
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
  timeout: 60000,
}, () => {
  const offenders: string[] = [];
  for (const file of allTestFiles()) {
    let ast: AstNode;
    try {
      ast = parseFile(file);
    } catch (err) {
      throw new Error(`failed to parse ${file}: ${(err as Error).message}`);
    }
    const bindings = collectForkBindings(ast);
    walkWithAncestors(ast, [], (node, ancestors) => {
      if (
        isForkCall(node, bindings) &&
        !forkHasPrecedingLeashOrGateAncestor(ancestors, node)
      ) {
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

const LANE_BY_SCRIPT = {
  "test:unit": "unit",
  "test:daemon": "daemon",
} as const;

type Lane = (typeof LANE_BY_SCRIPT)[keyof typeof LANE_BY_SCRIPT];

function graftedRoots(): Set<string> {
  return new Set(
    [...graftedMembers(REPO_ROOT).values()].map((dir) => join(REPO_ROOT, dir)),
  );
}

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
    throw new Error(`no workspace package owns ${file}`);
  }
  return owner;
}

function lanesDeclaredBy(packageRoot: string): Lane[] {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, unknown> };
  const scripts = manifest.scripts ?? {};
  return Object.entries(LANE_BY_SCRIPT)
    .filter(([script]) => scripts[script] !== undefined)
    .map(([, lane]) => lane);
}

const show = (p: string): string => relative(REPO_ROOT, p);

test("a package holding a daemon-gate call site declares `test:daemon`, so the daemon lane actually runs it", {
  timeout: 60000,
}, () => {
  const roots = workspacePackageRoots(REPO_ROOT);
  const grafted = graftedRoots();
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
  for (const root of grafted) gated.delete(root);
  gated.delete(join(HERE, ".."));
  const misfiled = [...gated]
    .filter((root) => !lanesDeclaredBy(root).includes("daemon"))
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
  const grafted = graftedRoots();
  const withTests = new Set<string>();
  for (const file of allTestFiles()) {
    if (/\.test\.(ts|cts|mts|tsx)$/.test(file)) {
      const owner = owningPackage(file, roots);
      if (!grafted.has(owner)) withTests.add(owner);
    }
  }
  const offenders = [...withTests]
    .map((root) => ({ root, lanes: lanesDeclaredBy(root) }))
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
  expect(
    forkDetected(
      `import { execFileSync as run } from "node:child_process";\n` +
        `run("git", ["status"]);\nrun("mkfifo", ["/tmp/x"]);`,
    ),
  ).toBe(false);
});

test("F4 fixture: a `spawn` NOT bound to child_process/node-pty is not resolved (no textual false-match)", () => {
  expect(
    forkDetected(
      `import { spawn } from "./my-actor-lib.ts";\nspawn(process.execPath);`,
    ),
  ).toBe(false);
});

test("F4 fixture: a `.cts`-style CJS `require` destructure binding of child_process.spawn is resolved", () => {
  expect(
    forkDetected(
      `const { spawn } = require("node:child_process");\n` +
        `spawn(process.execPath, ["--serve"]);`,
    ),
  ).toBe(true);
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

const uncoveredForks = (code: string): number[] => {
  const ast = parseSource(code);
  const bindings = collectForkBindings(ast);
  const lines: number[] = [];
  walkWithAncestors(ast, [], (node, ancestors) => {
    if (
      isForkCall(node, bindings) &&
      !forkHasPrecedingLeashOrGateAncestor(ancestors, node)
    ) {
      const loc = node.loc as { start?: { line?: number } } | undefined;
      lines.push(loc?.start?.line ?? -1);
    }
  });
  return lines;
};

test("F4 fixture: a leash AFTER the fork does NOT cover it (the `spawn(...); assert()` bypass)", () => {
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
