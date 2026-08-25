/**
 * The HYDRATE-CLEAN guard: what a consumer installs when it installs
 * `@kolu/padi-client`.
 *
 * The whole reason this package exists is that hydration is per-PACKAGE. An
 * out-of-repo consumer (olai) copies a package directory out of a
 * content-addressed kolu pin and resolves its imports from its own root
 * `node_modules`, so the set it must install is the transitive closure of the
 * manifests — not the set of modules its own code happens to reach. That is why
 * `@kolu/padi` was unusable for a server that only wanted to speak the surface:
 * padi's manifest names kaval, which names `node-pty` (a NATIVE module) and
 * `@xterm/headless`, so "give me a spec object and a dial function" arrived as a
 * PTY host with a compile step.
 *
 * A test that only asserted "no kaval import in this package's sources" would
 * pass while the manifest still dragged kaval in. So this walks BOTH facts:
 *
 *   1. the RUNTIME IMPORT closure from every published entry, via the shared
 *      `walkRuntimeDepEdges` (the same walker each daemon's
 *      `buildId.closure.test.ts` uses — one parser, one ownership rule), which
 *      also proves every edge is a declared `dependencies` edge rather than a
 *      devDependency a hydrated consumer would never install; and
 *   2. the DECLARED manifest closure — the set a hydrating consumer actually
 *      has to copy — against the same allowlist.
 *
 * The related rule — that every manifest in this closure must spell a LITERAL
 * dependency version, since `catalog:` is workspace-local and unresolvable for
 * the repo that copies these directories — is NOT checked here. It has an owner
 * already: `packages/tests/governance/effectPin.ts`, which derives the vendored
 * set from this very closure (`vendoredManifests`) and polices both directions
 * across the whole tree. A second copy here could only drift from it.
 *
 * The two walks get their OWN allowlists — `IMPORTED_ALLOWED` and
 * `DECLARED_ALLOWED` — because they are two different sets and the difference
 * between them is the whole subject of this file. One shared list would have to
 * be the union, which leaves the tighter set unpinned by exactly that
 * difference: a package could leave the import graph, or arrive in it while
 * already sitting in the manifest, and nothing here would notice. Split, the gap
 * is a fact a reviewer can read off two lists instead of slack hiding inside one.
 *
 * The point of both lists is that they are short and that a new name in either is
 * a CONSCIOUS act. A package that shows up uninvited is the boundary leaking:
 * either the code belongs in `@kolu/padi` (the daemon package, which may depend
 * on this one — the arrow points OUT), or the new dependency is one every
 * consumer of the padi contract is now required to install, which is a decision
 * worth a sentence in a PR body.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  declaredDependencyClosure,
  walkRuntimeDepEdges,
} from "@kolu/daemon-test-gate/runtimeDepEdges";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SRC, "..");
const REPO_ROOT = resolve(PKG_DIR, "..", "..");

/** Every published entry — read off `exports` so a new entry joins the walk by
 *  existing, not by being remembered here. */
function publishedEntries(): string[] {
  const exportsMap = (
    JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    }
  ).exports;
  return Object.values(exportsMap).map((rel) => resolve(PKG_DIR, rel));
}

/**
 * The workspace packages a consumer of `@kolu/padi-client` must hydrate.
 *
 * Each line is what it costs a server to speak padi's surface:
 *  - `@kolu/surface` + `@kolu/surface-daemon` + `@kolu/surface-daemon-supervisor`
 *    — the transport, the frozen control core, and the socket dial. Already the
 *    shared framework tier every surface consumer installs (drishti's gate list).
 *  - `@kolu/terminal-vocab` — the terminal ids, agent info and snapshot schemas
 *    the surface's records are made of, plus the agent-detection integrations it
 *    declares (`anyagent`, `kolu-{claude-code,codex,grok,opencode,pi}`), which
 *    are pure schema/parse leaves.
 *  - `kolu-git` / `kolu-github` / `anyforge` — the git and PR shapes padi's
 *    per-terminal sensor puts on every terminal record (`pr`, `git`), and the
 *    fs/git procedure schemas.
 *  - `kolu-transcript-core` — the transcript-export vocabulary.
 *  - `@kolu/log`, `kolu-io`, `kolu-shared`, `nonempty`, `memorable-names` —
 *    zero-dependency leaves reached through the above.
 *
 * NOT here, and this is the whole point: `kaval`, `node-pty`, `@xterm/*`,
 * `terminal-snapshot`, `terminal-themes`, `@kolu/xterm-kit`, `@kolu/serve-dir`,
 * `@kolu/surface-remote`, `@kolu/surface-map`, `kolu-pty`, `pino` — the daemon
 * and TUI tier.
 */
const DECLARED_ALLOWED = new Set([
  "@kolu/padi-client",
  "@kolu/surface",
  "@kolu/surface-daemon",
  "@kolu/surface-daemon-supervisor",
  "@kolu/terminal-vocab",
  "@kolu/log",
  "@kolu/shell-quote",
  "anyagent",
  "anyforge",
  "kolu-claude-code",
  "kolu-codex",
  "kolu-git",
  "kolu-github",
  "kolu-grok",
  "kolu-io",
  "kolu-opencode",
  "kolu-pi",
  // Zero-dependency leaves, both reached only through `kolu-git`'s manifest
  // (the residual below) — they cost a consumer a directory copy and nothing
  // else. `kolu-pty` here is the ENV-NAME leaf, not the PTY host: that is
  // `kaval`, and it is in DAEMON_TIER.
  "kolu-pty",
  "kolu-shared",
  "kolu-transcript-core",
  "memorable-names",
  "nonempty",
  "osfacts-client",
]);

/** The packages this package's own code actually REACHES from its published
 *  entries — necessarily a subset of `DECLARED_ALLOWED`, and the assertion below
 *  proves it rather than assuming it.
 *
 *  The seven names it drops are the honest cost of hydration being per-manifest:
 *  `@kolu/log`, `kolu-io`, `kolu-shared`, `kolu-pty`, `memorable-names`,
 *  `nonempty` and `osfacts-client` sit in manifests this closure copies, but no
 *  import path from a published entry reaches them. A consumer still copies
 *  seven directories for code it never loads — which is the same shape as the
 *  residual named below, several tiers down, and is why the gap is spelled out
 *  here instead of being folded into one lenient list. */
const IMPORTED_ALLOWED = new Set([
  "@kolu/padi-client",
  "@kolu/shell-quote",
  "@kolu/surface",
  "@kolu/surface-daemon",
  "@kolu/surface-daemon-supervisor",
  "@kolu/terminal-vocab",
  "anyagent",
  "anyforge",
  "kolu-claude-code",
  "kolu-codex",
  "kolu-git",
  "kolu-github",
  "kolu-grok",
  "kolu-opencode",
  "kolu-pi",
  "kolu-transcript-core",
]);

/** Names whose PRESENCE would mean the daemon tier came back. Asserted by name
 *  as well as by the allowlist, so the failure message says what happened
 *  instead of only that a set grew. */
const DAEMON_TIER = [
  "kaval",
  "terminal-snapshot",
  "terminal-themes",
  "@kolu/xterm-kit",
  "@kolu/serve-dir",
  "@kolu/surface-remote",
  "@kolu/surface-map",
  "@kolu/padi",
];

/** What a consumer copies when it vendors this package: the transitive runtime
 *  closure, as package names, as manifest paths, and as the npm packages those
 *  manifests leave it to install.
 *
 *  The walk is `@kolu/daemon-test-gate`'s, not a local copy — it is the TS
 *  mirror of nix's `depClosure`, and `packages/tests/governance/effectPin.ts`
 *  asks it the same question (which manifests are read outside this workspace
 *  and therefore owe a literal version). Two walks that agree today is how a
 *  gate starts lying, which is why the nix one is held to this one by
 *  `packages/tests/governance/closureWalk.ts` and why the externals below come
 *  out of the SAME pass rather than a second edge rule spelled here. */
function hydrateClosure(): ReturnType<typeof declaredDependencyClosure> {
  return declaredDependencyClosure({
    repoRoot: REPO_ROOT,
    entries: ["@kolu/padi-client"],
  });
}

/**
 * The npm packages a hydrating consumer must add to its OWN manifest — pinned
 * as a literal set, because the number is the whole claim and an unpinned
 * "smaller than padi" would rot quietly.
 *
 * What carving this package out actually bought: twenty-six externals dropped,
 * `node-pty` (a NATIVE PTY binding, built or prebuilt per platform) and the
 * whole `@xterm/*` suite among them, plus `@resvg/resvg-wasm`, `pino`(+roll,
 * +pretty), `conf`, `marked`, `columnify` and six more `@solid-primitives/*`.
 *
 * What is left, and where the remaining fat comes from — say it plainly rather
 * than let a reader assume this list is irreducible:
 *
 *  - `effect`, `@effect/platform-{node,browser}`, `ts-pattern`, `solid-js`,
 *    `@solid-primitives/{rootless,scheduled}`, `osfacts-client` — the framework
 *    tier, already installed by every `@kolu/surface` consumer (drishti, odu).
 *    (`osfacts-client` is a workspace MEMBER here — grafted from its npins pin —
 *    so it appears in ALLOWED above rather than in this list.)
 *  - `string-argv` — `anyagent`'s command parse, a pure leaf.
 *  - `@parcel/watcher` (NATIVE), `simple-git`, `p-limit` — `kolu-git`'s, and
 *    `@anthropic-ai/claude-agent-sdk` — `kolu-claude-code`'s. These are the one
 *    residual, and it is the SAME shape as the split this package is: each of
 *    those packages' `/schemas` entry is already a pure-`effect` leaf, but it
 *    shares a MANIFEST with the machinery that produces what it describes, and
 *    hydration is per-manifest. Fixing it is one uniform move across the
 *    integrations tier (vocabulary out of machinery, six packages, ~12 call
 *    sites for `kolu-git/schemas` alone) — a second boundary with its own
 *    consumers, deliberately not folded into this diff. When it lands, delete
 *    these four lines; nothing else here moves.
 */
const EXPECTED_EXTERNALS = [
  "@anthropic-ai/claude-agent-sdk",
  "@effect/platform-browser",
  "@effect/platform-node",
  "@parcel/watcher",
  "@solid-primitives/rootless",
  "@solid-primitives/scheduled",
  "effect",
  "p-limit",
  "simple-git",
  "solid-js",
  "string-argv",
  "ts-pattern",
];

describe("@kolu/padi-client hydrates without the daemon", () => {
  it("reaches only allowlisted packages from its published entries, on declared runtime edges", () => {
    const { violations, reachedPackages } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: publishedEntries(),
    });

    expect(
      violations,
      `@kolu/padi-client reaches an import its manifests do not honestly declare. ` +
        `A hydrating consumer installs the DECLARED dependencies and nothing else, ` +
        `so a devDependency edge here is a module that simply will not resolve there.`,
    ).toEqual([]);

    const unexpected = reachedPackages
      .filter((p) => !IMPORTED_ALLOWED.has(p))
      .sort();
    expect(
      unexpected,
      `@kolu/padi-client's import closure grew: ${unexpected.join(", ")}. ` +
        `Either the new code belongs in @kolu/padi (which may depend on this ` +
        `package — the arrow points out), or every consumer of padi's contract ` +
        `now has to hydrate these too; say which in IMPORTED_ALLOWED above.`,
    ).toEqual([]);

    // The containment this file's whole premise rests on: what the code reaches
    // is a subset of what the manifests cost. Asserted, not assumed — an entry
    // that appears only in IMPORTED_ALLOWED would mean a module resolves through
    // an edge no manifest in the closure declares.
    const undeclared = [...IMPORTED_ALLOWED]
      .filter((p) => !DECLARED_ALLOWED.has(p))
      .sort();
    expect(
      undeclared,
      `IMPORTED_ALLOWED names packages DECLARED_ALLOWED does not: ${undeclared.join(", ")}.`,
    ).toEqual([]);
  });

  it("declares a manifest closure a consumer can hydrate — no kaval, no node-pty, no TUI tier", () => {
    const closure = hydrateClosure().names;

    const daemonTier = closure.filter((p) => DAEMON_TIER.includes(p));
    expect(
      daemonTier,
      `@kolu/padi-client's DECLARED closure pulls the daemon tier back in: ` +
        `${daemonTier.join(", ")}. Hydration is per-package — a manifest edge ` +
        `costs a consumer the whole package even if no code path reaches it, ` +
        `which is exactly why this package was carved out of @kolu/padi.`,
    ).toEqual([]);

    const unexpected = closure.filter((p) => !DECLARED_ALLOWED.has(p));
    expect(
      unexpected,
      `undeclared closure members: ${unexpected.join(", ")}`,
    ).toEqual([]);
  });

  it("costs a consumer exactly these npm packages — the residual is pinned, not assumed", () => {
    // The externals come out of the closure walk itself, on the walk's own edge
    // rule (`dependencies` ∪ `peerDependencies`). Recomputing them here from the
    // manifest paths is how the two halves of one gate came to hold different
    // opinions about whether a peer is a runtime edge — and a workspace member
    // reached only through a peer would then be reported as a third-party
    // package while its own subtree went unwalked.
    expect(hydrateClosure().externals).toEqual(EXPECTED_EXTERNALS);
  });
});
