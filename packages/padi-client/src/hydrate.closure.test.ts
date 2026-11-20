import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  declaredDependencyClosure,
  walkRuntimeDepEdges,
  workspacePackageRoots,
} from "@kolu/daemon-test-gate/runtimeDepEdges";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SRC, "..");
const REPO_ROOT = resolve(PKG_DIR, "..", "..");

function publishedEntries(): string[] {
  const exportsMap = (
    JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    }
  ).exports;
  return Object.values(exportsMap).map((rel) => resolve(PKG_DIR, rel));
}

const DECLARED_ALLOWED = new Set([
  "@kolu/agent-distro",
  "@kolu/acp",
  "@kolu/acp-claude",
  "@juspay/agent-distro",
  "@kolu/byte-units",
  "@kolu/padi-client",
  "@kolu/surface",
  "@kolu/surface-app",
  "@kolu/url-shape",
  "@kolu/surface-daemon",
  "@kolu/surface-daemon-supervisor",
  "@kolu/terminal-vocab",
  "@kolu/log",
  "@kolu/shell-quote",
  "@odu/run-client",
  "@odu/run-history",
  "@odu/service-client",
  "anyagent",
  "anyforge",
  "kolu-agents",
  "kolu-claude-code",
  "kolu-codex",
  "kolu-git",
  "kolu-github",
  "kolu-grok",
  "kolu-io",
  "kolu-omp",
  "kolu-opencode",
  "kolu-pi",
  "kolu-pty",
  "kolu-shared",
  "kolu-transcript-core",
  "kolu-xyne",
  "memorable-names",
  "nonempty",
  "osfacts-client",
]);

const IMPORTED_ALLOWED = new Set([
  "@juspay/agent-distro",
  "@kolu/agent-distro",
  "@kolu/byte-units",
  "@kolu/log",
  "@kolu/padi-client",
  "@kolu/shell-quote",
  "@kolu/surface",
  "@kolu/surface-daemon",
  "@kolu/surface-daemon-supervisor",
  "@kolu/terminal-vocab",
  "@odu/run-client",
  "@odu/run-history",
  "@odu/service-client",
  "anyagent",
  "anyforge",
  "kolu-agents",
  "kolu-claude-code",
  "kolu-codex",
  "kolu-git",
  "kolu-github",
  "kolu-grok",
  "kolu-io",
  "kolu-omp",
  "kolu-opencode",
  "kolu-pi",
  "kolu-transcript-core",
  "kolu-xyne",
]);

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

const HYDRATE_CLOSURE = declaredDependencyClosure({
  repoRoot: REPO_ROOT,
  entries: ["@kolu/padi-client"],
});

const EXPECTED_EXTERNALS = [
  "@agentclientprotocol/sdk",
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
  "ws",
  "zod",
];

describe("@kolu/padi-client hydrates without the daemon", () => {
  it("reaches only allowlisted packages from its published entries, on declared runtime edges", () => {
    const { violations, reachedPackages, reachedSpecifiers } =
      walkRuntimeDepEdges({
        repoRoot: REPO_ROOT,
        entries: publishedEntries(),
        includeTypeOnly: true,
      });

    expect(
      violations,
      `@kolu/padi-client reaches an import its manifests do not honestly declare. ` +
        `A hydrating consumer installs the DECLARED dependencies and nothing else, ` +
        `so a devDependency edge here is a module that simply will not resolve there.`,
    ).toEqual([]);

    const stale = [...IMPORTED_ALLOWED]
      .filter((p) => p !== "@kolu/padi-client" && !reachedPackages.includes(p))
      .sort();
    expect(
      stale,
      `IMPORTED_ALLOWED names packages nothing reaches: ${stale.join(", ")}. ` +
        `Delete them — an entry here is a directory a consumer's compiler is ` +
        `told to expect, and this list is read as the honest cost of hydration.`,
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

    const daemonBarrels = reachedSpecifiers.filter(
      (spec) =>
        spec === "@kolu/surface-daemon" ||
        spec === "@kolu/surface-daemon-supervisor",
    );
    expect(
      daemonBarrels,
      "a BARE daemon barrel is back in this package's import closure. Both " +
        "barrels value-re-export the daemon runtime (`daemonMain`, " +
        "`daemonProcessMain`, the endpoint's osfacts process-identity client), " +
        "so every consumer of `connectPadi` would compile it — which is how a " +
        "module this package documents BROWSER-SAFE once pulled a daemon's " +
        "signal handling into an out-of-repo consumer's program " +
        "(juspay/kolu#2216). The leaf entries exist: reach " +
        "`@kolu/surface-daemon-supervisor/dial`, `@kolu/surface-daemon/home` " +
        "or `@kolu/surface-daemon/lifetime` instead.",
    ).toEqual([]);

    const undeclared = [...IMPORTED_ALLOWED]
      .filter((p) => !DECLARED_ALLOWED.has(p))
      .sort();
    expect(
      undeclared,
      `IMPORTED_ALLOWED names packages DECLARED_ALLOWED does not: ${undeclared.join(", ")}.`,
    ).toEqual([]);
  });

  it("declares a manifest closure a consumer can hydrate — no kaval, no node-pty, no TUI tier", () => {
    const closure = HYDRATE_CLOSURE.names;

    const members = new Set(
      workspacePackageRoots(REPO_ROOT).map(
        (dir) =>
          (
            JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
              name?: string;
            }
          ).name,
      ),
    );
    const ghosts = DAEMON_TIER.filter((p) => !members.has(p));
    expect(
      ghosts,
      `DAEMON_TIER names packages that are not workspace members: ` +
        `${ghosts.join(", ")}. A renamed package leaves a string here that can ` +
        `never match — the refusal it stands for would be silently gone.`,
    ).toEqual([]);

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
    expect(HYDRATE_CLOSURE.externals).toEqual(EXPECTED_EXTERNALS);
  });
});
