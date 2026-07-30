import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendCurrentRevisions,
  readCurrentSuite,
  type ScenarioInventory,
} from "./inventory";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.resolve(packageRoot, "../..");
const inventoryPath = path.join(packageRoot, "scenario-inventory.json");
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const existing = JSON.parse(
  readFileSync(inventoryPath, "utf8"),
) as ScenarioInventory;
const current = readCurrentSuite(packageRoot, head);
const next = appendCurrentRevisions(existing, current.records);
writeFileSync(inventoryPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  `scenario inventory: ${existing.records.length} -> ${next.records.length} immutable revisions`,
);
