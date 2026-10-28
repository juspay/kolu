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

/** Files whose CODE (not prose) contains `needle` — a comment naming a concept
 *  is documentation, not a dependency. */
function filesMatchingCode(needle: string): string[] {
  return sourceFiles().filter((rel) =>
    readFileSync(join(REPO_ROOT, rel), "utf8")
      .split("\n")
      .some(
        (line) =>
          line.includes(needle) &&
          !line.trimStart().startsWith("//") &&
          !line.trimStart().startsWith("*") &&
          !line.trimStart().startsWith("/*"),
      ),
  );
}

test("the wire mark (`commandRun`) is reachable from exactly its carriers", () => {
  // kaval produces and serves it; padi's bridge forwards it; the sensor takes its
  // head basename. Anything else is a new consumer of PTY bytes.
  assert.deepEqual(filesMatchingCode("commandRun"), [
    "packages/kaval/src/inProcessPtyHost.ts",
    "packages/kaval/src/ptyHost.ts",
    "packages/kaval/src/ptyHostSurface.ts",
    "packages/padi/src/terminalEndpoint/local.ts",
    "packages/padi/src/terminalWorkspace/sensors.ts",
  ]);
});

test("the recent-agents MRU has exactly one production writer, fed by detection", () => {
  assert.deepEqual(filesMatchingCode("trackRecentAgent"), [
    "packages/padi/src/activity/activity.ts",
    "packages/padi/src/terminalEndpoint/local.ts",
  ]);
});

test("only kaval may read the retained mark", () => {
  assert.deepEqual(filesMatchingCode("getLastCommand"), [
    "packages/kaval/src/ptyHost.ts",
  ]);
});

test("the raw mark reaches only the log-context watch, never a resolver", () => {
  // `noteRawCommand` hands the raw line to the unresumable-agent warning, where
  // it is LOG CONTEXT. A third caller would be a new reader of PTY text.
  assert.deepEqual(filesMatchingCode("noteRawCommand"), [
    "packages/padi/src/terminalEndpoint/local.ts",
    "packages/padi/src/terminalEndpoint/unresumableAgent.ts",
  ]);
});

test("the shim hint is produced in one place and read only by `matchesAgent`", () => {
  assert.deepEqual(filesMatchingCode("lastAgentCommandName"), [
    "packages/integrations/anyagent/src/agent-adapter.ts",
    "packages/padi/src/terminalWorkspace/sensors.ts",
  ]);
});
