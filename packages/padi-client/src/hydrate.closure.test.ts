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
 * `ALLOWED` is the allowlist, and the point of it is that it is short and that a
 * new name in it is a CONSCIOUS act. A package that shows up here uninvited is
 * the boundary leaking: either the code belongs in `@kolu/padi` (the daemon
 * package, which may depend on this one — the arrow points OUT), or the new
 * dependency is one every consumer of the padi contract is now required to
 * install, which is a decision worth a sentence in a PR body.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  walkRuntimeDepEdges,
  workspacePackageRoots,
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
const ALLOWED = new Set([
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

/** The transitive `dependencies` closure of a workspace package, by manifest —
 *  the set a hydrating consumer copies. Mirrors nix's `depClosure`
 *  (`packages/surface-daemon/nix/workspace-closure.nix`) on the TS side: follow
 *  every `dependencies` edge whose target is a workspace member, stop at
 *  external npm packages. */
function declaredClosure(
  entry: string,
  members: Map<string, string>,
): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = members.get(name);
    if (dir === undefined) continue;
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (members.has(dep)) stack.push(dep);
    }
  }
  return [...seen].sort();
}

/** name → dir for every workspace member, derived from `pnpm-workspace.yaml`
 *  through the same discovery `walkRuntimeDepEdges` uses — one answer to "what
 *  is a workspace package", so this walk and that one cannot disagree. Nameless
 *  members (`packages/tests`) cannot be depended on by name and are skipped. */
function workspaceMembers(): Map<string, string> {
  const members = new Map<string, string>();
  for (const dir of workspacePackageRoots(REPO_ROOT)) {
    const name = (
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
      }
    ).name;
    if (name !== undefined) members.set(name, dir);
  }
  return members;
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

    const unexpected = reachedPackages.filter((p) => !ALLOWED.has(p)).sort();
    expect(
      unexpected,
      `@kolu/padi-client's import closure grew: ${unexpected.join(", ")}. ` +
        `Either the new code belongs in @kolu/padi (which may depend on this ` +
        `package — the arrow points out), or every consumer of padi's contract ` +
        `now has to hydrate these too; say which in ALLOWED above.`,
    ).toEqual([]);
  });

  it("declares a manifest closure a consumer can hydrate — no kaval, no node-pty, no TUI tier", () => {
    const members = workspaceMembers();
    const closure = declaredClosure("@kolu/padi-client", members);

    const daemonTier = closure.filter((p) => DAEMON_TIER.includes(p));
    expect(
      daemonTier,
      `@kolu/padi-client's DECLARED closure pulls the daemon tier back in: ` +
        `${daemonTier.join(", ")}. Hydration is per-package — a manifest edge ` +
        `costs a consumer the whole package even if no code path reaches it, ` +
        `which is exactly why this package was carved out of @kolu/padi.`,
    ).toEqual([]);

    const unexpected = closure.filter((p) => !ALLOWED.has(p));
    expect(
      unexpected,
      `undeclared closure members: ${unexpected.join(", ")}`,
    ).toEqual([]);
  });

  it("costs a consumer exactly these npm packages — the residual is pinned, not assumed", () => {
    const members = workspaceMembers();
    const externals = new Set<string>();
    for (const name of declaredClosure("@kolu/padi-client", members)) {
      const dir = members.get(name);
      if (dir === undefined) continue;
      const manifest = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        if (!members.has(dep)) externals.add(dep);
      }
    }
    expect([...externals].sort()).toEqual(EXPECTED_EXTERNALS);
  });

  it("spells every external dependency version literally — `catalog:` is unresolvable outside this workspace", () => {
    const members = workspaceMembers();
    const catalogued: string[] = [];
    for (const name of declaredClosure("@kolu/padi-client", members)) {
      const dir = members.get(name);
      if (dir === undefined) continue;
      const manifest = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      for (const [dep, spec] of Object.entries({
        ...manifest.dependencies,
        ...manifest.peerDependencies,
      })) {
        if (spec.startsWith("catalog:")) catalogued.push(`${name} → ${dep}`);
      }
    }
    expect(
      catalogued,
      `a package in @kolu/padi-client's hydrate closure spells a dependency as ` +
        `\`catalog:\`: ${catalogued.join(", ")}. The catalog is WORKSPACE-LOCAL ` +
        `(pnpm-workspace.yaml), so a consumer that vendors these directories and ` +
        `installs their dependencies from its own manifest cannot resolve it — ` +
        `the same rule the eight @kolu/surface* packages already follow. Spell ` +
        `the literal version, and bump it in all three places the catalog note lists.`,
    ).toEqual([]);
  });
});
