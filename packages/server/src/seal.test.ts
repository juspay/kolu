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
import { declaredDependencyClosure } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { Effect } from "effect";
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
  // The new-terminal THEME POLICY pusher — derives the resolved policy from the web
  // shell's own `preferences` + `viewerMode` cells and writes it into every bound padi's
  // `newTerminalPolicy` cell on connect (#2045). Web-shell orchestration: it drives the
  // padi pool from the server shell and runs no terminal domain — the theme DECISION
  // (inherit vs shuffle, against which peers) is padi's, in @kolu/padi.
  "padi/newTerminalPolicy",
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
  // ── the port-forward arm (packages/server/src/portForward/) ──
  // PRT2's forward subsystem, isolated the same way the padi arm is: a POLICY
  // over `@kolu/port-forward`'s map (auto-vs-manual death, "only a real port
  // observation may close a door"), the port READING the reaper acts on, and the
  // per-viewer identity RESOLVER (its pure decision table graduated to
  // `@kolu/surface/viewer-identity` — proxy topology is not a kolu concern). All
  // web-shell code by construction — the LISTENERS are sockets in THIS process on
  // THIS machine, and the identity fact is a property of a connection only the
  // serving process can see. None of it runs terminal domain.
  "portForward/forwards",
  "portForward/hostPorts",
  "portForward/resolveViewerHost",
  // ── the serving shell + true leaves (top-level) ──
  // The web face's boot CONTRACT — the `KoluBootFlags` interface `bootKoluWeb` is
  // written against, and nothing else. A LEAF with ZERO imports: the FLAG schema
  // and its projection live in the command tree (`kolu-cli/src/webFlags.ts`),
  // because how argv is parsed is the CLI's volatility and a flag declaration is
  // a runtime call this package must not hold. kolu-cli deep-imports this as a
  // TYPE (erased) and annotates its projection with it, so schema and contract
  // still cannot drift. Web-shell code (it names how the web face boots), not
  // terminal domain.
  "bootFlags",
  "hostname",
  // W10 host-membership persistence — the pool (the web shell's authority for map
  // membership) is its one writer, so its atomic-JSON load/validate/save leaf lives
  // beside the shell, wired into `buildRemotePool`'s `persist` hook from `index.ts`.
  // Pure shell glue (a file codec keyed by pool membership), not terminal domain.
  "hostPersistence",
  // The liveness probe route — a constant 200 `kolu` with no dependencies, so it
  // answers as soon as the HTTP handler is attached (which is what `ci::dev-smoke`
  // and the packaged-binary smoke both wait on). Pure HTTP shell code.
  "healthRoute",
  // The web shell's HTTP middleware: the catch-all fault logger (an uncaught route
  // fault — e.g. the artifact-sdk HTML decorator draining a remote-preview stream
  // that faults past the route's own 503 `try` — becomes a LOGGED 500) plus the
  // per-request debug log. The one bridge between the serving stack and pino.
  // Pure HTTP shell code, runs no terminal domain.
  "httpMiddleware",
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
  "router",
  "state",
  // The state-backup ring's server face (#1658) — web-shell store management,
  // not terminal domain (the generic ring mechanics live in `kolu-shared`).
  "stateBackups",
  "surface",
  "tls",
  // `kolu-rpc` — the harness CLIENT of this shell's own wire: one call by wire tag
  // over `/rpc/ws`, printing the answer as JSON, so a shell (the NixOS adoption VM
  // probes) can reach in now that the HTTP RPC arm is gone. Web-shell code by the
  // seal's own test: it dials the shell's transport and runs no terminal domain —
  // the terminal verbs it can NAME are padi's, reached the way any client reaches
  // them, over the wire. `wireCallMain` is its argv entry (nix wraps it); nothing
  // in `index.ts`'s graph imports either.
  "wireCall",
  "wireCallMain",
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
/** The terminal domain's CLIENT half. It is padi's — the spec padi serves, the
 *  dial its clients share — carved into its own package only so a consumer can
 *  hydrate it without the daemon (juspay/kolu#2216). So every reverse seal below
 *  covers it too: a `koluSurface` reference or an app import here would be the
 *  exact inversion arms (d)/(e) exist to forbid, and carving the files out must
 *  not be a way to leave the seal. */
const PADI_CLIENT_SRC = resolve(SRC, "..", "..", "padi-client", "src");

/** Every `.ts` under the terminal domain's two package roots, INCLUDING tests —
 *  the whole cone must be app-free, not just production (a test importing the app
 *  is still a reverse edge). */
function padiSrcFilesAll(): string[] {
  return [PADI_SRC, PADI_CLIENT_SRC].flatMap((root) =>
    readdirSync(root, { recursive: true })
      .map((f) => String(f).split(sep).join("/"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => resolve(root, f)),
  );
}

const PACKAGES_DIR = resolve(PADI_SRC, "..", "..");
const REPO_ROOT = resolve(PACKAGES_DIR, "..");
const PADI_PKG = resolve(PADI_SRC, "..", "package.json");
const PADI_CLIENT_PKG = resolve(PADI_CLIENT_SRC, "..", "package.json");

/** The app packages @kolu/padi (the terminal-domain AUTHORITY) must never depend
 *  on — the arrow points OUT. `@kolu/padi/*` is not among them (it IS padi). */
const APP_PACKAGES = ["kolu-common", "kolu-server", "kolu-client"];

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

/** The packages that ARE the terminal domain, listed. Membership is what arms
 *  (b) and (f) police, so it must be a fact a reviewer edits rather than a shape
 *  a name happens to have: `startsWith("@kolu/padi")` reads like a rule and is a
 *  coincidence, and it fails silently in both directions — a third domain
 *  package under a different name (`@kolu/terminal-domain`) would slip out of the
 *  seal while the arrow it polices inverts, and an unrelated `@kolu/padi-foo`
 *  would slip in. */
const TERMINAL_DOMAIN = ["@kolu/padi", "@kolu/padi-client"] as const;

/** True for a specifier naming the terminal domain — the package itself or one
 *  of its subpaths.
 *
 *  The exact-or-`root/` shape is spelled again in `packages/kolu-mcp/src/tools.test.ts`.
 *  That duplication is DELIBERATE: sharing three lines would cost kolu-mcp a new
 *  devDependency on this package's home, which is a worse trade than typing them twice. */
function inTerminalDomain(spec: string): boolean {
  return TERMINAL_DOMAIN.some((n) => spec === n || spec.startsWith(`${n}/`));
}

/** The `@kolu/padi` specifiers kolu-server's PRODUCTION code (everything reachable
 *  from `index.ts`) may import — the TIGHT boundary. A DELIBERATE subset of padi's
 *  published `exports` (arm f asserts the subset relation): production reaches the
 *  terminal domain through the narrowest surface that works, so e.g.
 *  `supervisorClaim` routes through `/assembly` rather than importing
 *  `@kolu/padi/stateRoot` directly (its own header records that choice). Each entry
 *  earns its place:
 *   - `@kolu/padi-client/surface` — the terminal VOCABULARY (schemas · records ·
 *     pure helpers). It moved to the client package at juspay/kolu#2216 so a
 *     consumer can hydrate the contract without the daemon; the DOOR is the same
 *     door, and the seal counts `@kolu/padi-client` as part of the terminal
 *     domain (`TERMINAL_DOMAIN` names both), never as a way out of it;
 *   - `/assembly` — the padi binder's assembly surface (socket paths, preview, the
 *     kaval/padi probe types) — the one production door for state-root-adjacent needs;
 *   - `@kolu/padi-client/dial` — the shared dial kit (`connectPadi`), so `padi-tui`
 *     and the binder share ONE control-core handshake (the kaval precedent);
 *   - `/log` — padi's pino logger, so a server log line joins padi's stream;
 *   - `/remote-dial` — the ssh half of the dial: the closure this build
 *     provisions onto a host (`PADI_REMOTE_DIAL`) and the one-shot dial through
 *     it. It stayed in `@kolu/padi` when the local dial left, because what it
 *     names is a nix package and a binary — the daemon, not the contract — and
 *     the binder is the one production caller that genuinely ships a padi;
 *   - `/convergence-policy` — padi's own declaration of WHO IT IS and how a
 *     supervisor of it converges (juspay/kolu#2101). It earned a door of its own
 *     rather than riding `/assembly` precisely because of the rule above: it is
 *     NARROWER. Two pure factories, no terminal domain, no state-root vocabulary
 *     — and it must be shared, because `padi --stdio` now converges its own daemon
 *     too, so this binder and padi's front cannot be allowed to hold two opinions
 *     about padi's contract version or its drain semantics.
 *  A deep `@kolu/padi/src/...` import (bypassing the barrel) or any UNLISTED subpath
 *  fails arm (b). TESTS get a wider door — the full published set — via arm (f). */
const ALLOWED_PADI = [
  "@kolu/padi/assembly",
  "@kolu/padi/convergence-policy",
  "@kolu/padi/log",
  "@kolu/padi/remote-dial",
  "@kolu/padi-client/dial",
  "@kolu/padi-client/surface",
];

/** The terminal domain's PUBLISHED subpaths, derived from BOTH package.jsons'
 *  `exports` (so this can't drift from the real contract). This is the deliberate
 *  published surface — the set a TEST file may reach (arm f), and the superset
 *  `ALLOWED_PADI` (the production door) is a documented subset of.
 *
 *  Two manifests, one door set: the split into `@kolu/padi-client` is about what a
 *  consumer HYDRATES, not about how many contracts the server may reach past. */
function padiPublishedSubpaths(): Set<string> {
  const published = new Set<string>();
  for (const [pkgJson, name] of [
    [PADI_PKG, "@kolu/padi/"],
    [PADI_CLIENT_PKG, "@kolu/padi-client/"],
  ] as const) {
    const exportsMap = JSON.parse(readFileSync(pkgJson, "utf8"))
      .exports as Record<string, unknown>;
    for (const key of Object.keys(exportsMap)) {
      published.add(key.replace(/^\.\//, name));
    }
  }
  return published;
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

  it("(b) reaches the terminal domain only through its named doors — no deep src import", () => {
    const padiSpecs = [...externalsFromEntry()]
      .filter((s) => inTerminalDomain(s))
      .sort();
    // Every @kolu/padi edge is one of the ALLOWED_PADI published entry points; a
    // `@kolu/padi/src/...` deep import (or any other subpath) fails here.
    const illegal = padiSpecs.filter((s) => !ALLOWED_PADI.includes(s));
    expect(
      illegal,
      `illegal terminal-domain import(s) from packages/server: ${illegal.join(
        ", ",
      )}. kolu-server must reach the terminal domain only via ` +
        `@kolu/padi/{assembly,convergence-policy,log,remote-dial} and ` +
        `@kolu/padi-client/{surface,dial}.`,
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
    // `@kolu/padi-client/surface` — both PUBLISHED entry points other packages
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
        if (!inTerminalDomain(spec)) continue;
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

  it("(c) the root terminal/* and git/* tag namespaces are gone — only server, daemon, hosts beside surface/", () => {
    // Under Effect RPC the contract is one FLAT `RpcGroup` and a "namespace" is a
    // tag's first segment, so the same seal reads off `requests` rather than off
    // object keys. Nothing else about the assertion moved.
    const roots = new Set(
      [...contract.requests.keys()].map((tag) => tag.split("/")[0]),
    );
    expect(roots.has("terminal")).toBe(false);
    expect(roots.has("git")).toBe(false);
    expect([...roots].sort()).toEqual(["daemon", "hosts", "server", "surface"]);

    // The bound ROOT handlers are assembled in `index.ts`'s async boot now, so
    // build them here with stub deps to assert the same fact on the serving side:
    // no terminal/git root tag survives beside server/daemon/hosts.
    const bound = new Set(
      Object.keys(
        buildAppRouter({
          drainBoundPadi: () => Effect.void,
          addHost: async () => {},
          removeHost: async () => {},
          reconnectHost: () => {},
          renewHostDaemon: () => Effect.void,
          listStateBackups: () => ({ backups: [] }),
          restoreStateBackup: async () => ({ hostFailures: [] }),
          // No viewer identity in a shape assertion — `null` is the answer for
          // every uncertain case anyway.
          viewerHost: async () => null,
        }).handlers,
      ).map((tag) => tag.split("/")[0]),
    );
    expect(bound.has("terminal")).toBe(false);
    expect(bound.has("git")).toBe(false);
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
          `${o.f
            .replace(PADI_SRC, "@kolu/padi/src")
            .replace(
              PADI_CLIENT_SRC,
              "@kolu/padi-client/src",
            )}: ${o.refs.join(", ")}`,
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

    // (1) NEITHER terminal-domain package.json declares an app package (runtime
    //     OR dev). Both, because the vocabulary lives in the client half now and a
    //     manifest edge there would invert the arrow just as surely.
    for (const pkgJson of [PADI_PKG, PADI_CLIENT_PKG]) {
      expect(
        declaredDeps(pkgJson).filter((d) => APP_PACKAGES.includes(d)),
        `${pkgJson} lists an app package (kolu-common/server/client) as a ` +
          "dependency — padi owns its vocabulary; the app depends on padi, not the reverse.",
      ).toEqual([]);
    }

    // (2) no @kolu/padi src file (INCLUDING tests) imports an app package.
    const APP_SPEC = new RegExp(`^(${APP_PACKAGES.join("|")})($|/)`);
    const importOffenders: string[] = [];
    for (const file of padiSrcFilesAll()) {
      for (const spec of importsOf(file)) {
        if (APP_SPEC.test(spec)) {
          importOffenders.push(
            `${file
              .replace(PADI_SRC, "@kolu/padi/src")
              .replace(PADI_CLIENT_SRC, "@kolu/padi-client/src")}: ${spec}`,
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

    // (3) transitive: padi's WHOLE workspace dependency cone — every workspace
    //     runtime dep (integrations included, at any nesting under `packages/**`)
    //     reachable from either terminal-domain manifest — must be free of app
    //     packages. A one-hop check saw only padi's DIRECT deps, so
    //     `padi → <lib> → <lib2> → app` slipped through.
    //
    //     The cone itself is `declaredDependencyClosure`'s, not a third
    //     hand-rolled fixpoint beside it and nix's `depClosure` — "the transitive
    //     workspace-dependency closure" is one derivation and this file consumes
    //     it. That also retires the old vacuity guard here (`byName.has("kolu-pty")`,
    //     which existed because a top-level-only discovery once silently dropped
    //     `packages/integrations/*`): the shared walk THROWS on an entry that is
    //     not a workspace member, so a stale seed can no longer be answered with a
    //     quiet empty closure.
    //
    //     Seeded from BOTH manifests. `@kolu/padi-client` is a declared dep of
    //     padi, so the walk would reach it anyway — naming it keeps the arm honest
    //     if that edge ever inverts (the client half is the one an out-of-repo
    //     consumer hydrates alone, so its cone matters on its own terms).
    const cone = declaredDependencyClosure({
      repoRoot: REPO_ROOT,
      entries: TERMINAL_DOMAIN,
    });
    const transitiveOffenders: string[] = [];
    for (const manifestPath of cone.manifestPaths) {
      const pkgJson = resolve(REPO_ROOT, manifestPath);
      for (const a of declaredDeps(pkgJson).filter((d) =>
        APP_PACKAGES.includes(d),
      )) {
        transitiveOffenders.push(`${manifestPath} → ${a}`);
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
