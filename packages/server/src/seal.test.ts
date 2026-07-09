/**
 * The package-boundary SEAL for `packages/server` (W1.R7 — the final member).
 *
 * By the end of W1.R the terminal domain has fully relocated into `@kolu/padi`:
 * kolu-server is the staying WEB SHELL (HTTP/ws transport, static serving, the
 * surface wiring, the memory sampler, TLS, branding) and reaches the terminal
 * domain ONLY through `@kolu/padi`'s three published entry points
 * (`/assembly`, `/surface`, `/log`). This test makes that boundary a
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
 *  is terminal-domain code that belongs in `@kolu/padi` (the seal caught it). */
const WEB_SHELL_FILES = [
  // The read-only host-daemon inventory sampler — the web shell's diagnostic
  // enumeration of every running kaval + padi (reusing kaval/padi discovery), marking
  // kolu's active one. Shell code (it publishes koluSurface's `daemonInventory` cell,
  // runs no terminal domain), not a terminal-domain module.
  "daemonInventory",
  "hostname",
  "iframePreviewRoute",
  "index",
  "log",
  "memorySampler",
  // The W2.2 padi BINDER — the web shell's supervisor/client of the padi PROCESS
  // (spawn/adopt + dial + the reconnect-mirror session `reServeSurface` consumes).
  // Web-shell code (it runs no terminal domain — it re-serves padi's), so it lives
  // beside the shell, not in @kolu/padi.
  "padiBinding",
  // padi's CONVERGENCE declaration into the shared daemon-convergence kit (the
  // contract-skew policy, the frozen-control-core probe, the drain plumbing) —
  // carved out of `padiBinding` in W4 ledger L6 as its own volatility. Web-shell
  // code (it declares padi's policy + adapts its hello; the kit owns the mechanism),
  // so it lives beside the binder, not in @kolu/padi.
  "padiConvergence",
  // The W3.1 REMOTE padi binder — the ssh twin of `padiBinding`: it fronts a padi on
  // another host over `getHostSession`/`padi --stdio` and re-serves its surface through
  // the SAME `reServeSurface` seam. Web-shell code (it runs no terminal domain — it
  // re-serves a remote padi's), so it lives beside the shell, not in @kolu/padi.
  "remotePadiBinding",
  // The stale-reserve-on-flap eviction: prunes `index.ts`'s per-host `reServeSurface`
  // mirror cache to the pool's live membership (wired to `pool.subscribe`), so a guest
  // remove→re-add of the same key builds a FRESH mirror over the new session rather than
  // reusing the dead one pinned to the destroyed session (#1708). Web-shell glue (a cache
  // prune keyed by pool membership), not terminal domain.
  "reServeEviction",
  // The padi SESSION shape both arms return (post-S9): a base `Session` from
  // `makeSession` + the daemon-supervision members by spread — no `BoundPadi`, no
  // wrapper class. Web-shell glue (the arms' shared session type + spread helper).
  "padiSession",
  // The pure `SessionState.connection` → koluSurface `padiLink` mapping — the web
  // shell's own honest view of its binding to padi (#1034), driven off the binding
  // session. Shell code (a projection of the binder's state onto kolu-server's OWN
  // surface), not terminal domain.
  "padiLink",
  "pwaIdentity",
  // The web shell's catch-all `app.onError` logger — turns an uncaught route/
  // middleware fault (e.g. the artifact-sdk HTML decorator draining a remote-preview
  // stream that faults past the route's own 503 `try`) into a LOGGED 500. Pure HTTP
  // shell code, runs no terminal domain.
  "routeErrors",
  "router",
  "state",
  // The P0 local-supervisor ownership gate — the web shell's own "only one
  // kolu-server supervises this padi state root" fence (a `supervisor.pid` claim
  // reusing the daemon pid-gate). Shell/supervisor code (it guards the binder's
  // ownership; runs no terminal domain), so it lives beside the binder.
  "supervisorClaim",
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

function serverSrcModules(): string[] {
  // Walk RECURSIVELY: a terminal-domain module smuggled back into a NEW
  // subdirectory (e.g. a resurrected `terminalEndpoint/` or `ptyHost/`) must
  // fail this allowlist too, not just a top-level file. `recursive` yields
  // subdir-prefixed relative paths (`sub/mod.ts`), so any nested module lands
  // as a `sub/mod` key that isn't in the flat WEB_SHELL_FILES set.
  return readdirSync(SRC, { recursive: true })
    .map((f) => String(f).split(sep).join("/"))
    .filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".test-d.ts"),
    )
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
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
 *  dep (`@kolu/terminal-workspace`, `kaval`, `kolu-pty`, …) resolves to its dir
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

/** The ONLY `@kolu/padi` specifiers kolu-server may import — its published entry
 *  points. A deep `@kolu/padi/src/...` import (bypassing the barrel) or any other
 *  subpath fails the boundary. `/dial` joined the list in W2.3: `connectPadi` (the
 *  state-root→socket resolve + control-core handshake) was carved out of the
 *  binder into `@kolu/padi/dial` so `padi-tui` and the binder share ONE dial kit
 *  (the kaval precedent — a daemon's package owns its client-side dial kit). */
const ALLOWED_PADI = [
  "@kolu/padi/assembly",
  "@kolu/padi/dial",
  "@kolu/padi/surface",
  "@kolu/padi/log",
];

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

  it("(b) reaches @kolu/padi only through /assembly, /surface, /log — no deep src import", () => {
    const padiSpecs = [...externalsFromEntry()]
      .filter((s) => s.startsWith("@kolu/padi"))
      .sort();
    // Every @kolu/padi edge is one of the three published entry points; a
    // `@kolu/padi/src/...` deep import (or any other subpath) fails here.
    const illegal = padiSpecs.filter((s) => !ALLOWED_PADI.includes(s));
    expect(
      illegal,
      `illegal @kolu/padi import(s) from packages/server: ${illegal.join(
        ", ",
      )}. kolu-server must reach the terminal domain only via @kolu/padi/{assembly,surface,log}.`,
    ).toEqual([]);
    // And it genuinely reaches the barrel (not a vacuous pass).
    expect(padiSpecs.length).toBeGreaterThan(0);
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
