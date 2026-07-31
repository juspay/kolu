import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  assertAppendOnly,
  census,
  readCurrentSuite,
  type ScenarioInventory,
} from "./inventory";
import {
  validateCollectedTests,
  validateLedger,
  type CoverageLedger,
} from "./ledger";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.resolve(packageRoot, "../..");
const inventoryPath = path.join(packageRoot, "scenario-inventory.json");
const ledgerPath = path.join(packageRoot, "coverage-ledger.yaml");

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readInventory(value: string, source: string): ScenarioInventory {
  const parsed = JSON.parse(value) as ScenarioInventory;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) {
    throw new Error(`${source}: invalid scenario inventory`);
  }
  return parsed;
}

const head = git("rev-parse", "HEAD");
const inventory = readInventory(
  readFileSync(inventoryPath, "utf8"),
  inventoryPath,
);
const ledger = parseYaml(readFileSync(ledgerPath, "utf8")) as CoverageLedger;
const current = readCurrentSuite(packageRoot, head);

const currentIds = new Set(current.records.map((record) => record.revisionId));
const inventoryIds = new Set(
  inventory.records.map((record) => record.revisionId),
);
const missing = current.records.filter(
  (record) => !inventoryIds.has(record.revisionId),
);
if (missing.length > 0) {
  throw new Error(
    `scenario inventory is missing ${missing.length} current revision(s):\n${missing
      .map(
        (record) =>
          `  ${record.feature}: ${record.scenario} (${record.revisionId})`,
      )
      .join(
        "\n",
      )}\nRun pnpm inventory:update, then review the appended records.`,
  );
}

const duplicateIds = inventory.records.filter(
  (record, index, records) =>
    records.findIndex(
      (candidate) => candidate.revisionId === record.revisionId,
    ) !== index,
);
if (duplicateIds.length > 0) {
  throw new Error(
    `duplicate inventory revision: ${duplicateIds[0]?.revisionId}`,
  );
}

validateLedger(inventory, current.records, ledger);
const collectionRoot = mkdtempSync(
  path.join(os.tmpdir(), "kolu-e2e-governance-"),
);
const vitestCli = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
if (!existsSync(vitestCli)) {
  throw new Error(`root Vitest entry point does not exist: ${vitestCli}`);
}
try {
  validateCollectedTests(ledger, (file) => {
    const absolute = path.resolve(repoRoot, file);
    if (
      absolute !== repoRoot &&
      !absolute.startsWith(`${repoRoot}${path.sep}`)
    ) {
      throw new Error(`test path escapes the repository: ${file}`);
    }
    if (!existsSync(absolute))
      throw new Error(`test file does not exist: ${file}`);
    let packageDir = path.dirname(absolute);
    while (
      packageDir !== repoRoot &&
      !existsSync(path.join(packageDir, "package.json"))
    ) {
      packageDir = path.dirname(packageDir);
    }
    if (packageDir === repoRoot) {
      throw new Error(`test file has no owning workspace package: ${file}`);
    }
    const relative = path.relative(packageDir, absolute);
    const output = execFileSync(
      process.execPath,
      [vitestCli, "list", relative, "--json"],
      {
        cwd: packageDir,
        encoding: "utf8",
        env: {
          ...process.env,
          KOLU_AGENT_DIR: path.join(collectionRoot, "agents"),
          KOLU_STATE_DIR: path.join(collectionRoot, "state"),
          LOG_LEVEL: "silent",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const tests = JSON.parse(output) as Array<{ name: string }>;
    return new Set(tests.map((test) => test.name));
  });
} finally {
  rmSync(collectionRoot, { recursive: true, force: true });
}

const inventoryHistory = git(
  "log",
  "--format=%H",
  "--diff-filter=AM",
  "HEAD",
  "--",
  "packages/tests/scenario-inventory.json",
)
  .split("\n")
  .filter(Boolean);
for (const revision of inventoryHistory) {
  const historical = git(
    "show",
    `${revision}:packages/tests/scenario-inventory.json`,
  );
  assertAppendOnly(
    readInventory(historical, `inventory at ${revision}`),
    inventory,
  );
}

const counts = census(current);
if (currentIds.size !== current.records.length) {
  throw new Error("current suite contains duplicate revision ids");
}

console.log(
  `e2e governance: ${counts.featureFiles} features, ${counts.declarations} declarations, ${counts.executions} executions (${counts.linuxDefault} Linux default, ${counts.darwinDefault} Darwin default), ${inventory.records.length} immutable revisions`,
);
