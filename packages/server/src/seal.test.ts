/**
 * The package-boundary SEAL for `packages/server` (W1.R7 — the final member).
 *
 * By the end of W1.R the terminal domain has fully relocated into `@kolu/padi`:
 * kolu-server is the staying WEB SHELL (HTTP/ws transport, static serving, the
 * surface wiring, the memory sampler, TLS, branding) and reaches the terminal
 * domain ONLY through `@kolu/padi`'s published entry points that `ALLOWED_PADI`
 * names (`/assembly`, `/dial`, `/surface`, `/log`). This test makes that boundary a
 * compile-and-CI fact rather than a convention — it fails the moment a
 * terminal-domain module reappears under `packages/server/src`, a deep
 * `@kolu/padi/src/...` import bypasses the barrel, or a root `terminal.*` /
 * `git.*` namespace is reintroduced on the contract.
 *
 * Modeled on `@kolu/surface-daemon-supervisor`'s `deps.closure.test.ts` (the
 * parser-backed import-graph walk), extended with the file-list
 * allowlist (a), the root-namespace assertion (c), and the two REVERSE arms that
 * prove the dependency ARROW POINTS OUT of `@kolu/padi` (the terminal-domain
 * AUTHORITY): (d) no `packages/padi/src` file references the `koluSurface`
 * spec/ctx in any form, and (e) padi's whole dependency cone excludes the app
 * (`kolu-common`/`kolu-server`/`kolu-client`). The terminal vocabulary lives in
 * `@kolu/padi` now, so padi imports nothing from the app; the app consumes padi.
 *
 * The forward `@kolu/padi` boundary (b) walks only PRODUCTION reachable from
 * `index.ts`; arm (f) closes the remaining flank (W4 ledger L13) by walking the
 * SERVER's TEST files too — a test may reach any of padi's PUBLISHED subpaths
 * (derived from `package.json`'s `exports`, so it can't drift), but never a deep
 * `@kolu/padi/src/...` that bypasses the barrel. `ALLOWED_PADI` (the tighter
 * production door) is a documented SUBSET of that published set.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { contract } from "kolu-common/contract";
import { describe, expect, it } from "vitest";
import { buildAppRouter } from "./router.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(SRC, "index.ts");

// ── (a) The web-shell file-list allowlist ─────────────────────────────────

/** The EXACT set of non-test `.ts` modules that may live under
 *  `packages/server/src` after the seal — the web shell and nothing else. A new
 *  file here is a conscious decision: either it is web-shell code (add it) or it
 *  is terminal-domain code that belongs in `@kolu/padi` (the seal caught it).
 *
 *  The **padi hosting arm** — the binder cluster (local + remote), its convergence
 *  declaration, session shape, link projection, and the pool satellites
 *  (`reServeEviction`, `supervisorClaim`, `daemonInventory`) — lives under the
 *  `padi/` subdirectory (W4 ledger L27: the arm co-varies on every remote/switch
 *  phase, so it earns its own home). It is STILL web-shell code (it re-serves
 *  padi's surface; it runs no terminal domain), so these modules stay inside the
 *  seal — just under `padi/`. The serving shell and the true leaves stay top-level. */
const WEB_SHELL_FILES = [
  // ── the padi hosting arm (packages/server/src/padi/) ──
  // The read-only host-daemon inventory sampler — the web shell's diagnostic
  // enumeration of every running kaval + padi (reusing kaval/padi discovery), marking
  // kolu's active one. Shell code (it publishes koluSurface's `daemonInventory` cell,
  // runs no terminal domain), not a terminal-domain module.
  "padi/daemonInventory",
  // The W2.2 padi BINDER — the web shell's supervisor/client of the padi PROCESS
  // (spawn/adopt + dial + the reconnect-mirror session `reServeSurface` consumes).
  // Web-shell code (it runs no terminal domain — it re-serves padi's), so it lives
  // beside the shell, not in @kolu/padi.
  "padi/padiBinding",
  // padi's CONVERGENCE declaration into the shared daemon-convergence kit (the
  // contract-skew policy, the frozen-control-core probe, the drain plumbing) —
  // carved out of `padiBinding` in W4 ledger L6 as its own volatility. Web-shell
  // code (it declares padi's policy + adapts its hello; the kit owns the mechanism),
  // so it lives beside the binder, not in @kolu/padi.
  "padi/padiConvergence",
  // The W3.1 REMOTE padi binder — the ssh twin of `padiBinding`: it fronts a padi on
  // another host over `getHostSession`/`padi --stdio` and re-serves its surface through
  // the SAME `reServeSurface` seam. Web-shell code (it runs no terminal domain — it
  // re-serves a remote padi's), so it lives beside the shell, not in @kolu/padi.
  "padi/remotePadiBinding",
  // The stale-reserve-on-flap eviction: prunes `index.ts`'s per-host `reServeSurface`
  // mirror cache to the pool's live membership (wired to `pool.subscribe`), so a guest
  // remove→re-add of the same key builds a FRESH mirror over the new session rather than
  // reusing the dead one pinned to the destroyed session (#1708). Web-shell glue (a cache
  // prune keyed by pool membership), not terminal domain.
  "padi/reServeEviction",
  // The padi SESSION shape both arms return (post-S9): a base `Session` from
  // `makeSession` + the daemon-supervision members by spread — no `BoundPadi`, no
  // wrapper class. Web-shell glue (the arms' shared session type + spread helper).
  "padi/padiSession",
  // The pure `SessionState.phase` → koluSurface `padiLink` mapping — the web
  // shell's own honest view of its binding to padi (#1034), driven off the binding
  // session. Shell code (a projection of the binder's state onto kolu-server's OWN
  // surface), not terminal domain.
  "padi/padiLink",
  // The P0 local-supervisor ownership gate — the web shell's own "only one
  // kolu-server supervises this padi state root" fence (a `supervisor.pid` claim
  // reusing the daemon pid-gate). Shell/supervisor code (it guards the binder's
  // ownership; runs no terminal domain), so it lives beside the binder.
  "padi/supervisorClaim",
  // ── the serving shell + true leaves (top-level) ──
  // The web face's boot contract — the ONE flag artifact (cleye schema +
  // derived `KoluBootFlags`), a LEAF importing only kolu-common/config so the
  // kolu-cli parse deep-imports it without loading index.ts's runtime graph.
  // Web-shell code (it names how the web face boots), not terminal domain.
  "bootFlags",
  // PRT2's forward POLICY — auto-vs-manual death, "only a real port observation
  // may close a door", the host-key ↔ ssh-target mapping — over
  // `@kolu/port-forward`'s map. Web-shell code by construction: the LISTENERS are
  // sockets in THIS process on THIS machine, so they belong to the serving shell
  // and die with it. It runs no terminal domain (it consumes a port READING the
  // shell hands it), so it is not a @kolu/padi module.
  "forwards",
  "hostname",
  // W10 host-membership persistence — the pool (the web shell's authority for map
  // membership) is its one writer, so its atomic-JSON load/validate/save leaf lives
  // beside the shell, wired into `buildRemotePool`'s `persist` hook from `index.ts`.
  // Pure shell glue (a file codec keyed by pool membership), not terminal domain.
  "hostPersistence",
  "iframePreviewRoute",
  "index",
  "log",
  // The pure process-memory poll READ behind koluSurface's derived `processMemory`
  // cell (the retired sampler LOOP's read half — SR8.a). Web-shell code.
  "memorySampler",
  // The memory-rail liveness POLICY (`padiMemoryReadable` — LIVE-FIX): `readPadiMemoryOnce`
  // gates its deferred mirror read on padi's honest connected phase, read off
  // `padiSession.currentState()`, never `currentClient()`. A side-effect-free leaf so the
  // gate is pinnable apart from index.ts's boot-only closure. Web-shell policy.
  "padiMemoryGate",
  "pwaIdentity",
  // The web shell's catch-all `app.onError` logger — turns an uncaught route/
  // middleware fault (e.g. the artifact-sdk HTML decorator draining a remote-preview
  // stream that faults past the route's own 503 `try`) into a LOGGED 500. Pure HTTP
  // shell code, runs no terminal domain.
  "routeErrors",
  "router",
  "state",
  "surface",
  "tls",
].sort();

/** Terminal-domain modules that MUST NOT reappear under `packages/server/src` —
 *  they all live in `@kolu/padi` now. An explicit denylist beside the exact
 *  allowlist so a regression names the offender, not just "the set changed". */
const FORBIDDEN_TERMINAL_MODULES = [
  "terminal-registry",
  "terminals",
  "session",
  "activity",
  "terminalScratch",
  "koluRoot",
  "reconcile",
  "publisher",
  "surfaceCtx",
  "padiSurfaceCtx",
  "workspaceSurfaceCtx",
  "servePadi",
  "urgency",
  "transcript",
  "preview",
  "sessionRestore",
];

/** Every `.ts` under `packages/server/src`, as forward-slash relative paths.
 *  Walk RECURSIVELY: a terminal-domain module smuggled back into a NEW
 *  subdirectory (e.g. a resurrected `terminalEndpoint/` or `ptyHost/`) must be
 *  seen too, not just a top-level file. `recursive` yields subdir-prefixed
 *  relative paths (`sub/mod.ts`), normalized here to `sub/mod.ts`. The two
 *  callers below split this one walk into complementary sets. */
function serverSrcTsFiles(): string[] {
  return readdirSync(SRC, { recursive: true })
    .map((f) => String(f).split(sep).join("/"))
    .filter((f) => f.endsWith(".ts"));
}

function serverSrcModules(): string[] {
  // The non-test modules, as bare `sub/mod` keys — any nested module that isn't
  // in the flat WEB_SHELL_FILES set fails the allowlist.
  return serverSrcTsFiles()
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test-d.ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

/** Every `.ts` test file under `packages/server/src` (recursive — the padi arm's
 *  tests live in `padi/` now), as absolute paths. Arm (f) walks these so a TEST
 *  file's `@kolu/padi` imports are checked too, closing the flank the
 *  production-only forward walk (arm b) leaves open. */
function serverTestFiles(): string[] {
  return serverSrcTsFiles()
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test-d.ts"))
    .map((f) => resolve(SRC, f));
}

// ── (d/e) The REVERSE seals — the arrow points OUT of @kolu/padi ───────────
//
// The forward seal (a–c) proves kolu-server reaches padi only through the barrel.
// The REVERSE arms prove padi (the terminal-domain AUTHORITY) never reaches back
// into the kolu app:
//   (d) no `packages/padi/src` file references the `koluSurface` SPEC/ctx — the
//       reverse dependency the `surfaceCtx`-style holder once was (a
//       `createLateBoundSurfaceCtx<(typeof koluSurface)["spec"]>` in padi, the
//       mechanism behind the boot-recursion crash) — in ANY form (named import,
//       `typeof`, namespace member, re-export).
//   (e) padi's whole dependency CONE (package.json + import graph + one transitive
//       hop) excludes the app packages `kolu-common`/`kolu-server`/`kolu-client`.
// The terminal VOCABULARY (`SavedSession` / `ActivityFeed` / `TerminalInfo` … and
// the whole Authored/Saved/compose family) LIVES IN `@kolu/padi` now — padi owns
// it and imports it locally; the app consumes it FROM padi. So (e) can ban every
// `kolu-common` import outright, not just the surface value: nothing terminal
// remains in the app for padi to reach for.

const PADI_SRC = resolve(SRC, "..", "..", "padi", "src");

/** Every `.ts` under `packages/padi/src` INCLUDING tests — the whole cone must be
 *  app-free, not just production (a test importing the app is still a reverse edge). */
function padiSrcFilesAll(): string[] {
  return readdirSync(PADI_SRC, { recursive: true })
    .map((f) => String(f).split(sep).join("/"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => resolve(PADI_SRC, f));
}

const PACKAGES_DIR = resolve(PADI_SRC, "..", "..");
const PADI_PKG = resolve(PADI_SRC, "..", "package.json");

/** The app packages @kolu/padi (the terminal-domain AUTHORITY) must never depend
 *  on — the arrow points OUT. `@kolu/padi/*` is not among them (it IS padi). */
const APP_PACKAGES = ["kolu-common", "kolu-server", "kolu-client"];

/** Map every workspace package NAME → its `package.json` path, so a workspace
 *  dep (`@kolu/terminal-vocab`, `kaval`, `kolu-pty`, …) resolves to its dir
 *  even when the dir name differs from the package name.
 *
 *  Discovery is RECURSIVE, mirroring the ROOT `pnpm-workspace.yaml`, whose sole
 *  workspace glob is a fully-recursive `packages/**`: a workspace package may live
 *  at ANY depth under `packages/` — top-level (`packages/kaval`), nested
 *  (`packages/integrations/kolu-pty`), an `example/*` sub-package, and so on. The
 *  old top-level-only `readdirSync(PACKAGES_DIR)` silently DROPPED
 *  `packages/integrations/*` — ~7 of padi's OWN deps (kolu-pty, kolu-git,
 *  anyagent, anyforge, kolu-claude-code, kolu-codex, kolu-opencode) — so arm (e)'s
 *  cone walk never reached them and passed vacuously. We prune `node_modules`
 *  (pnpm never treats it as a workspace root) and dot-dirs; every remaining
 *  `package.json` is a workspace member, keyed by its declared `name`. */
function workspacePkgJsonByName(): Map<string, string> {
  const byName = new Map<string, string>();
  const walk = (dir: string): void => {
    const pj = resolve(dir, "package.json");
    if (existsSync(pj)) {
      try {
        const name = JSON.parse(readFileSync(pj, "utf8")).name;
        if (typeof name === "string" && name) byName.set(name, pj);
      } catch {}
    }
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      walk(resolve(dir, ent.name));
    }
  };
  walk(PACKAGES_DIR);
  return byName;
}

function declaredDeps(pkgJsonPath: string): string[] {
  const p = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  return [
    ...Object.keys(p.dependencies ?? {}),
    ...Object.keys(p.devDependencies ?? {}),
  ];
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

function parseTsFile(file: string): AstNode {
  return parse(readFileSync(file, "utf8"), {
    sourceFilename: file,
    sourceType: "module",
    createImportExpressions: true,
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;
}

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

const identifierName = (node: unknown): string | null =>
  isAstNode(node) && node.type === "Identifier" && typeof node.name === "string"
    ? node.name
    : stringLiteralValue(node);

const nodeList = (value: unknown): AstNode[] =>
  Array.isArray(value) ? value.filter(isAstNode) : [];

/** The two ways a module could BIND the `koluSurface` surface value: a named
 *  import of it, or a `typeof koluSurface` type-query. Parsed off the AST, so a
 *  comment or string that merely MENTIONS "koluSurface" is NOT a hit (the arrow
 *  ban is about a real dependency, not the word). */
function koluSurfaceBindings(file: string): string[] {
  const hits: string[] = [];
  visitAst(parseTsFile(file), (node) => {
    if (node.type === "ImportDeclaration") {
      for (const specifier of nodeList(node.specifiers)) {
        if (
          specifier.type === "ImportSpecifier" &&
          identifierName(specifier.imported) === "koluSurface"
        ) {
          hits.push(
            `import { koluSurface } (as ${identifierName(specifier.local) ?? "?"})`,
          );
        }
      }
    }
    if (
      node.type === "TSTypeQuery" &&
      identifierName(node.exprName) === "koluSurface"
    ) {
      hits.push("typeof koluSurface");
    }
    // Namespace access: `import * as ns from "…"; ns.koluSurface` — reaching the
    // surface value through a namespace member (value position).
    if (
      (node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression") &&
      identifierName(node.property) === "koluSurface"
    ) {
      hits.push("ns.koluSurface (namespace member)");
    }
    // Qualified type: `typeof ns.koluSurface` / `ns.koluSurface[…]` in type position.
    if (
      node.type === "TSQualifiedName" &&
      identifierName(node.right) === "koluSurface"
    ) {
      hits.push("ns.koluSurface (qualified type)");
    }
    // Re-export FROM another module — a padi barrel forwarding the surface value:
    //   `export { koluSurface } from "…"`   (named re-export)
    //   `export * from "kolu-common/surface"` (star re-export of the module that
    //                                          owns koluSurface)
    if (node.type === "ExportNamedDeclaration") {
      const spec = stringLiteralValue(node.source) ?? "";
      for (const el of nodeList(node.specifiers)) {
        if (
          el.type === "ExportSpecifier" &&
          identifierName(el.local) === "koluSurface"
        ) {
          hits.push(`export { koluSurface } from "${spec}"`);
        }
      }
    }
    if (
      node.type === "ExportAllDeclaration" &&
      stringLiteralValue(node.source) === "kolu-common/surface"
    ) {
      hits.push('export * from "kolu-common/surface"');
    }
  });
  return hits;
}

// ── (b) The @kolu/padi import-boundary walk ───────────────────────────────

/** The `@kolu/padi` specifiers kolu-server's PRODUCTION code (everything reachable
 *  from `index.ts`) may import — the TIGHT boundary. A DELIBERATE subset of padi's
 *  published `exports` (arm f asserts the subset relation): production reaches the
 *  terminal domain through the narrowest surface that works, so e.g.
 *  `supervisorClaim` routes through `/assembly` rather than importing
 *  `@kolu/padi/stateRoot` directly (its own header records that choice). Each entry
 *  earns its place:
 *   - `/surface` — the terminal VOCABULARY (schemas · records · pure helpers);
 *   - `/assembly` — the padi binder's assembly surface (socket paths, preview, the
 *     kaval/padi probe types) — the one production door for state-root-adjacent needs;
 *   - `/dial` — the shared dial kit (`connectPadi`), so `padi-tui` and the binder
 *     share ONE state-root→socket resolve + control-core handshake (the kaval precedent);
 *   - `/log` — padi's pino logger, so a server log line joins padi's stream.
 *  A deep `@kolu/padi/src/...` import (bypassing the barrel) or any UNLISTED subpath
 *  fails arm (b). TESTS get a wider door — the full published set — via arm (f). */
const ALLOWED_PADI = [
  "@kolu/padi/assembly",
  "@kolu/padi/dial",
  "@kolu/padi/surface",
  "@kolu/padi/log",
];

/** padi's PUBLISHED subpaths, derived from its `package.json` `exports` (so this
 *  can't drift from the real contract) as `@kolu/padi/<name>` specifiers. This is
 *  the deliberate published surface — the set a TEST file may reach (arm f), and
 *  the superset `ALLOWED_PADI` (the production door) is a documented subset of. */
function padiPublishedSubpaths(): Set<string> {
  const exportsMap = JSON.parse(readFileSync(PADI_PKG, "utf8"))
    .exports as Record<string, unknown>;
  return new Set(
    Object.keys(exportsMap).map((k) => k.replace(/^\.\//, "@kolu/padi/")),
  );
}

function importsOf(file: string): string[] {
  const specs = new Set<string>();
  visitAst(parseTsFile(file), (node) => {
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

/** Every external specifier reached from `index.ts` (following only relative
 *  edges within `packages/server/src`). */
function externalsFromEntry(): Set<string> {
  const reached = new Set<string>();
  const externals = new Set<string>();
  const stack = [ENTRY];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    if (file.endsWith(".test.ts")) continue;
    for (const spec of importsOf(file)) {
      if (spec.startsWith(".")) {
        // Follow only relative edges to a real `.ts` module — a relative `.json`
        // import (e.g. `../package.json` for the version) resolves to a
        // non-existent `.ts` and is a leaf, not a module to walk into.
        const resolved = resolveRelative(file, spec);
        if (resolved.endsWith(".ts") && existsSync(resolved))
          stack.push(resolved);
      } else externals.add(spec);
    }
  }
  return externals;
}

describe("packages/server package-boundary seal (W1.R7)", () => {
  it("(a) contains exactly the web-shell modules — no terminal-domain file", () => {
    expect(serverSrcModules()).toEqual(WEB_SHELL_FILES);
  });

  it("(a) none of the relocated terminal-domain modules reappear under server/src", () => {
    const present = new Set(serverSrcModules());
    const leaked = FORBIDDEN_TERMINAL_MODULES.filter((m) => present.has(m));
    expect(
      leaked,
      `terminal-domain module(s) reappeared under packages/server/src: ${leaked.join(
        ", ",
      )} — they belong in @kolu/padi.`,
    ).toEqual([]);
  });

  it("(a) no hand-rolled setInterval sampler remains in the web shell (SR8.a — zero allowlist)", () => {
    // SR8 converted the campaign's three hand-rolled samplers to the framework poll
    // cell (`derived.cell(source({ read, install }))`); SR8.a converts the last two
    // kolu-server holdouts (`processMemory`, `daemonInventory`) and grounding found a
    // SECOND structurally-identical hand-roll one seam over (`daemonInventory`), so the
    // negative property ships with ZERO allowlist: NO non-test web-shell module drives a
    // sampler with a raw `setInterval`. The reactor's `everyMs` owns every interval now
    // (in `@kolu/surface`, not here), so a re-introduced `setInterval(` under
    // `packages/server/src` is a resurrected hand-rolled cadence — the exact defect
    // SR8.a closed. (The fused-cadence leaf `pollCadence.ts` graduated into
    // `@kolu/surface`'s reactor at SR8.c and is gone from the web shell.)
    const offenders: string[] = [];
    for (const rel of serverSrcTsFiles()) {
      if (rel.endsWith(".test.ts") || rel.endsWith(".test-d.ts")) continue;
      const src = readFileSync(resolve(SRC, rel), "utf8");
      if (/\bsetInterval\s*\(/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      `a web-shell module drives a raw setInterval: ${offenders.join(", ")}. ` +
        `Sampler cadence rides the reactor's poll source (@kolu/surface's everyMs) ` +
        `since SR8.a — a hand-rolled setInterval sampler is the retired defect.`,
    ).toEqual([]);
    // Non-vacuous: the walk actually read web-shell modules.
    expect(serverSrcTsFiles().length).toBeGreaterThan(0);
  });

  it("(b) reaches @kolu/padi only through /assembly, /dial, /surface, /log — no deep src import", () => {
    const padiSpecs = [...externalsFromEntry()]
      .filter((s) => s.startsWith("@kolu/padi"))
      .sort();
    // Every @kolu/padi edge is one of the ALLOWED_PADI published entry points; a
    // `@kolu/padi/src/...` deep import (or any other subpath) fails here.
    const illegal = padiSpecs.filter((s) => !ALLOWED_PADI.includes(s));
    expect(
      illegal,
      `illegal @kolu/padi import(s) from packages/server: ${illegal.join(
        ", ",
      )}. kolu-server must reach the terminal domain only via @kolu/padi/{assembly,dial,surface,log}.`,
    ).toEqual([]);
    // And it genuinely reaches the barrel (not a vacuous pass).
    expect(padiSpecs.length).toBeGreaterThan(0);
  });

  it("(f) test files reach @kolu/padi only through PUBLISHED subpaths — no deep src bypass", () => {
    // The forward arm (b) walks only production reachable from `index.ts`, so a
    // TEST file's `@kolu/padi` imports were never checked — the one flank the seal
    // left open (W4 ledger L13). A test legitimately needs MORE of padi than
    // production does (it drives internals: `padi/padiBinding.test` reaches
    // `@kolu/padi/stateRoot`, `exportTranscriptHtml.test` reaches
    // `@kolu/padi/transcript` — both PUBLISHED entry points other packages
    // (`tests`, `client`) consume too, so narrowing them out of padi's exports
    // would break real consumers). But a test must still go through the PUBLISHED
    // contract, never a deep `@kolu/padi/src/...` that bypasses the barrel.
    const published = padiPublishedSubpaths();

    // ALLOWED_PADI (the production door) is a documented SUBSET of the published
    // exports — so the two "agree on purpose", and a typo or a removed export in
    // ALLOWED_PADI is caught here rather than passing vacuously.
    const notPublished = ALLOWED_PADI.filter((s) => !published.has(s));
    expect(
      notPublished,
      `ALLOWED_PADI names a @kolu/padi subpath that padi/package.json no longer ` +
        `publishes: ${notPublished.join(", ")}. The production door must be a ` +
        `subset of the deliberate export set.`,
    ).toEqual([]);

    // Every @kolu/padi import in a server TEST file is a published subpath.
    const offenders: string[] = [];
    let sawPadiImport = false;
    for (const file of serverTestFiles()) {
      for (const spec of importsOf(file)) {
        if (!spec.startsWith("@kolu/padi")) continue;
        sawPadiImport = true;
        if (!published.has(spec)) {
          offenders.push(
            `${file.replace(SRC, "packages/server/src")}: ${spec}`,
          );
        }
      }
    }
    expect(
      offenders,
      `a server test imports a @kolu/padi specifier that is not a published ` +
        `subpath (a deep @kolu/padi/src/... bypass, or an unpublished entry): ` +
        `${offenders.join(", ")}. Tests reach padi through its published exports, ` +
        `same as any consumer — never a deep src path.`,
    ).toEqual([]);
    // Non-vacuous: the walk actually found a padi import to check.
    expect(sawPadiImport).toBe(true);
  });

  it("(c) the root terminal.* / git.* namespaces are gone — only server + daemon beside surface", () => {
    const c = contract as Record<string, unknown>;
    expect(c.terminal).toBeUndefined();
    expect(c.git).toBeUndefined();
    expect(
      Object.keys(contract)
        .filter((k) => k !== "surface")
        .sort(),
    ).toEqual(["daemon", "hosts", "server"]);

    // `appRouter` is assembled in `index.ts`'s async boot now (the padi sibling is
    // an `await`ed re-serve), so build it here with stub deps to assert the same
    // fact: no terminal/git root namespace survives beside surface/server/daemon.
    const r = buildAppRouter({
      surfaceRouter: { surface: {} },
      drainBoundPadi: async () => {},
      addHost: async () => {},
      removeHost: async () => {},
      reconnectHost: () => {},
      renewHostDaemon: async () => {},
    }) as Record<string, unknown>;
    expect(r.terminal).toBeUndefined();
    expect(r.git).toBeUndefined();
  });

  it("(d) REVERSE seal — no @kolu/padi src file references koluSurface (import/type/namespace/re-export)", () => {
    const files = padiSrcFilesAll();
    // Non-vacuous: the scan actually found padi modules (a wrong path would make
    // this pass trivially).
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .map((f) => ({ f, refs: koluSurfaceBindings(f) }))
      .filter((x) => x.refs.length > 0);
    expect(
      offenders.map(
        (o) =>
          `${o.f.replace(PADI_SRC, "@kolu/padi/src")}: ${o.refs.join(", ")}`,
      ),
      "a @kolu/padi src file references the koluSurface SPEC/ctx — a reverse-" +
        "direction dependency the forward seal can't see. It's caught in ALL forms: " +
        "a named import, `typeof koluSurface`, a namespace member (`ns.koluSurface`), " +
        "or a re-export (`export { koluSurface } from …` / `export * from " +
        '"kolu-common/surface"`). padi serves its OWN padiSurface ctx and OWNS the ' +
        "terminal vocabulary now (arm e); it never reaches back into the app surface.",
    ).toEqual([]);
  });

  it("(e) REVERSE seal — @kolu/padi's dependency cone excludes the app (packages/{common,server,client})", () => {
    // The structural inversion the human reviewer caught: padi (the terminal-
    // domain AUTHORITY) must not depend on the kolu APP. Three checks pin the
    // cone — package.json, the import graph, and one transitive hop.

    // (1) padi/package.json declares no app package (runtime OR dev).
    expect(
      declaredDeps(PADI_PKG).filter((d) => APP_PACKAGES.includes(d)),
      "packages/padi/package.json lists an app package (kolu-common/server/client) " +
        "as a dependency — padi owns its vocabulary; the app depends on padi, not the reverse.",
    ).toEqual([]);

    // (2) no @kolu/padi src file (INCLUDING tests) imports an app package.
    const APP_SPEC = new RegExp(`^(${APP_PACKAGES.join("|")})($|/)`);
    const importOffenders: string[] = [];
    for (const file of padiSrcFilesAll()) {
      for (const spec of importsOf(file)) {
        if (APP_SPEC.test(spec)) {
          importOffenders.push(
            `${file.replace(PADI_SRC, "@kolu/padi/src")}: ${spec}`,
          );
        }
      }
    }
    expect(importOffenders.length).toBeGreaterThanOrEqual(0); // (padi src exists — the loop ran)
    expect(padiSrcFilesAll().length).toBeGreaterThan(0);
    expect(
      importOffenders,
      "a @kolu/padi src file imports from the kolu app (kolu-common/server/client). " +
        "The terminal vocabulary lives in @kolu/padi now; import it locally, not from the app.",
    ).toEqual([]);

    // (3) transitive: walk padi's WHOLE workspace dependency cone to a FIXPOINT —
    //     follow every workspace runtime dep (integrations included, at any
    //     nesting under `packages/**`) until no new package appears — and flag any
    //     node that declares an app package. A one-hop check saw only padi's
    //     DIRECT deps, so `padi → <lib> → <lib2> → app` slipped through; and with
    //     the old top-level-only discovery, padi's integrations deps (kolu-pty,
    //     kolu-git, …) weren't even in the map, so this arm passed vacuously.
    const byName = workspacePkgJsonByName();
    // The discovery fix as a CI-enforced fact: a known `packages/integrations/*`
    // package IS in scope now, so the cone walk below is non-vacuous.
    expect(
      byName.has("kolu-pty"),
      "workspace discovery is missing packages/integrations/* (e.g. kolu-pty) — " +
        "the cone walk would skip ~7 of padi's own deps and pass vacuously.",
    ).toBe(true);
    const transitiveOffenders: string[] = [];
    const expanded = new Set<string>(); // package NAMES already expanded
    const worklist = Object.keys(
      JSON.parse(readFileSync(PADI_PKG, "utf8")).dependencies ?? {},
    );
    while (worklist.length > 0) {
      const dep = worklist.pop() as string;
      if (expanded.has(dep)) continue;
      expanded.add(dep);
      const depPkg = byName.get(dep);
      if (!depPkg) continue; // non-workspace (registry) dep — can't reach app workspaces
      for (const a of declaredDeps(depPkg).filter((d) =>
        APP_PACKAGES.includes(d),
      )) {
        transitiveOffenders.push(`${dep} → ${a}`);
      }
      // Follow this node's own RUNTIME deps — the runtime cone that determines
      // padi's staleKey/closure. Registry deps aren't in `byName`, so the worklist
      // only ever grows by workspace packages and the fixpoint terminates.
      for (const next of Object.keys(
        JSON.parse(readFileSync(depPkg, "utf8")).dependencies ?? {},
      )) {
        if (!expanded.has(next) && byName.has(next)) worklist.push(next);
      }
    }
    expect(
      transitiveOffenders,
      "a package in @kolu/padi's transitive dependency cone depends on the app — " +
        "padi's cone is polluted (this is why the flip matters for W2.2: padi's " +
        "staleKey/closure must not move when app-only code churns).",
    ).toEqual([]);
  });
});
