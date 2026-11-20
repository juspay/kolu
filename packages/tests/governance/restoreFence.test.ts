import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);
const EXCLUDED_PREFIXES = ["packages/tests/"];

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

const SOURCE_FILES = sourceFiles();

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
  readonly promise: string;
  readonly needle: RegExp;
  readonly allowed: readonly string[];
}

const LAWS: readonly Law[] = [
  {
    promise:
      "the wire mark (commandRun, in every casing) is reachable from exactly its carriers",
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
    needle: /\bnoteRawCommand\b/,
    allowed: ["packages/padi/src/terminalEndpoint/local.ts"],
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
