/**
 * The EXECUTE-PATH FENCE, as repo-wide grep laws.
 *
 * **PTY output is a sensor. Nothing that executes may read a value whose
 * provenance is PTY bytes.**
 *
 * The forgery fixed in #2326 was not one bad function — it was a PERMISSION: a
 * value read off a shell's `OSC 633;E` mark was allowed to travel into a
 * persisted restore target and be typed on wake. A schema can make the old shape
 * unspellable, but nothing in the type system stops the next feature from
 * importing the mark and starting again. These laws are that rule, mechanically.
 *
 * Each law names the FILES a concept may appear in. A new consumer anywhere
 * under `packages/` fails here, even if its own types are sound. The compile-time
 * half (no `commandRun` arm on `TerminalEvent`, no launch line in `AgentMemory`)
 * lives beside those schemas in `@kolu/terminal-vocab`.
 *
 * The needles are REGEXES so a PascalCase sibling cannot slip past a camelCase
 * one: `commandRun` alone could not see `CommandRunSample` /
 * `subscribeCommandRun`, which is exactly the "a new package consumes the mark"
 * case this fence claims to catch.
 *
 * `packages/tests` is excluded: it is the e2e harness, which types marks into
 * terminals on purpose.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/** `packages/tests/governance/` → the repo root. */
const REPO_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);
const EXCLUDED_PREFIXES = ["packages/tests/"];

/** Every non-test source file, repo-relative with forward slashes. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.(test|testlib)\.(ts|tsx)$/.test(entry.name)) continue;
      const rel = relative(REPO_ROOT, abs).split("\\").join("/");
      if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      out.push(rel);
    }
  };
  walk(join(REPO_ROOT, "packages"));
  return out.sort();
}

/** Materialized once: five laws over the same tree should walk it once. */
const SOURCE_FILES = sourceFiles();

/** Files whose CODE (not prose) matches `needle` — a comment naming a concept is
 *  documentation, not a dependency. */
function filesMatchingCode(needle: RegExp): string[] {
  return SOURCE_FILES.filter((rel) =>
    readFileSync(join(REPO_ROOT, rel), "utf8")
      .split("\n")
      .some(
        (line) =>
          needle.test(line) &&
          !line.trimStart().startsWith("//") &&
          !line.trimStart().startsWith("*") &&
          !line.trimStart().startsWith("/*"),
      ),
  );
}

interface Law {
  /** Why this set is the complete, sanctioned set of carriers. */
  readonly promise: string;
  readonly needle: RegExp;
  readonly allowed: readonly string[];
}

const LAWS: readonly Law[] = [
  {
    promise:
      "the wire mark (commandRun, in every casing) is reachable from exactly its carriers",
    // kaval produces and serves it; padi's bridge forwards it; the sensor takes
    // its head basename. `index.ts` re-exports the subscription TYPE a new
    // consumer would name to receive it.
    needle: /ommandRun/,
    allowed: [
      "packages/kaval/src/inProcessPtyHost.ts",
      "packages/kaval/src/index.ts",
      "packages/kaval/src/ptyHost.ts",
      "packages/kaval/src/ptyHostSurface.ts",
      "packages/padi/src/terminalEndpoint/local.ts",
      "packages/padi/src/terminalWorkspace/sensors.ts",
    ],
  },
  {
    promise:
      "the recent-agents MRU has exactly one production writer, fed by detection",
    needle: /\btrackRecentAgent\b/,
    allowed: [
      "packages/padi/src/activity/activity.ts",
      "packages/padi/src/terminalEndpoint/local.ts",
    ],
  },
  {
    promise:
      "the raw mark reaches only the log-context watch, never a resolver",
    // `noteRawCommand` hands the raw line to the unresumable-agent warning, where
    // it is LOG CONTEXT. A third caller would be a new reader of PTY text.
    needle: /\bnoteRawCommand\b/,
    allowed: [
      "packages/padi/src/terminalEndpoint/local.ts",
      "packages/padi/src/terminalEndpoint/unresumableAgent.ts",
    ],
  },
  {
    promise:
      "the shim hint is produced in one place and read only by `matchesAgent`",
    needle: /\blastAgentCommandName\b/,
    allowed: [
      "packages/integrations/anyagent/src/agent-adapter.ts",
      "packages/padi/src/terminalWorkspace/sensors.ts",
    ],
  },
  {
    promise:
      "captured launch text survives in exactly one file — the 1.3.0 rung between the two ladder steps",
    // `lastAgentCommand` is the ONE persisted field that still carries command
    // text, and it exists only so the #1621 rung can hand it to the 1.3.0 rung,
    // which deletes it without parsing. Any new reader of it is the old world
    // returning. The regex is word-bounded so `lastAgentCommandName` (a MARK
    // basename, not text) does not satisfy it.
    needle: /\blastAgentCommand\b/,
    allowed: ["packages/padi-client/src/vocab.ts"],
  },
];

test("the execute-path fence — every PTY-bytes concept stays in its carrier set", () => {
  for (const law of LAWS) {
    assert.deepEqual(
      filesMatchingCode(law.needle),
      [...law.allowed].sort(),
      law.promise,
    );
  }
});
