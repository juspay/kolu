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
 * import-graph walk via `ts.preProcessFile`), extended with the file-list
 * allowlist (a) and the root-namespace assertion (c).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { contract } from "kolu-common/contract";
import { appRouter } from "./router.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(SRC, "index.ts");

// ── (a) The web-shell file-list allowlist ─────────────────────────────────

/** The EXACT set of non-test `.ts` modules that may live under
 *  `packages/server/src` after the seal — the web shell and nothing else. A new
 *  file here is a conscious decision: either it is web-shell code (add it) or it
 *  is terminal-domain code that belongs in `@kolu/padi` (the seal caught it). */
const WEB_SHELL_FILES = [
  "hostname",
  "iframePreviewRoute",
  "index",
  "log",
  "memorySampler",
  "pwaIdentity",
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

function serverSrcModules(): string[] {
  // Walk RECURSIVELY: a terminal-domain module smuggled back into a NEW
  // subdirectory (e.g. a resurrected `terminalEndpoint/` or `ptyHost/`) must
  // fail this allowlist too, not just a top-level file. `recursive` yields
  // subdir-prefixed relative paths (`sub/mod.ts`), so any nested module lands
  // as a `sub/mod` key that isn't in the flat WEB_SHELL_FILES set.
  return readdirSync(SRC, { recursive: true })
    .map((f) => String(f).split(sep).join("/"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

// ── (b) The @kolu/padi import-boundary walk ───────────────────────────────

/** The ONLY `@kolu/padi` specifiers kolu-server may import — its three published
 *  entry points. A deep `@kolu/padi/src/...` import (bypassing the barrel) or any
 *  other subpath fails the boundary. */
const ALLOWED_PADI = [
  "@kolu/padi/assembly",
  "@kolu/padi/surface",
  "@kolu/padi/log",
];

function importsOf(file: string): string[] {
  const pre = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  return pre.importedFiles.map((f) => f.fileName);
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
    ).toEqual(["daemon", "server"]);

    const r = appRouter as Record<string, unknown>;
    expect(r.terminal).toBeUndefined();
    expect(r.git).toBeUndefined();
  });
});
