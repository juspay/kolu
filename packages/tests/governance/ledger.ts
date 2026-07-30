import type { ScenarioInventory, ScenarioRevision } from "./inventory";

export type TestLayer = "L1" | "L2" | "L3" | "L4" | "L5";
export type TestLane = "unit" | "daemon" | "e2e";

export interface TestProof {
  file: string;
  test: string;
  lane: TestLane;
  platforms: Array<"linux" | "darwin">;
  realism: string[];
  reviewEvidence: {
    file: string;
    test: string;
    note: string;
  };
}

export interface Retirement {
  id: string;
  revisionId: string;
  action:
    | "replace"
    | "retain-smoke"
    | "collapse-outline"
    | "renamed"
    | "revised";
  status: "planned" | "landed" | "blocked";
  promise: string;
  defectSurface: string[];
  destinationLayer: TestLayer;
  replacements: TestProof[];
  survivorRevisionIds: string[];
  sameCodePathEvidence?: {
    file: string;
    symbol: string;
    test: string;
  };
}

export interface CoverageLedger {
  schemaVersion: 2;
  retirements: Retirement[];
}

export interface TestReference {
  file: string;
  test: string;
  owner: string;
}

function nonEmpty(value: string, field: string, id: string): void {
  if (value.trim().length === 0) throw new Error(`${id}: ${field} is empty`);
}

export function validateLedger(
  inventory: ScenarioInventory,
  current: ScenarioRevision[],
  ledger: CoverageLedger,
): void {
  if (ledger.schemaVersion !== 2) throw new Error("unsupported ledger schema");
  const inventoryIds = new Set(
    inventory.records.map((record) => record.revisionId),
  );
  const currentIds = new Set(current.map((record) => record.revisionId));
  const entries = new Map<string, Retirement>();
  for (const entry of ledger.retirements) {
    nonEmpty(entry.id, "id", entry.id || "retirement");
    if (entries.has(entry.revisionId)) {
      throw new Error(`${entry.revisionId}: more than one retirement row`);
    }
    if (!inventoryIds.has(entry.revisionId)) {
      throw new Error(
        `${entry.id}: unknown inventory revision ${entry.revisionId}`,
      );
    }
    nonEmpty(entry.promise, "promise", entry.id);
    if (entry.defectSurface.length === 0) {
      throw new Error(`${entry.id}: defectSurface is empty`);
    }
    for (const proof of entry.replacements) {
      nonEmpty(proof.file, "replacement.file", entry.id);
      nonEmpty(proof.test, "replacement.test", entry.id);
      if (proof.platforms.length === 0) {
        throw new Error(`${entry.id}: replacement platforms are empty`);
      }
      if (proof.realism.length === 0) {
        throw new Error(`${entry.id}: replacement realism is empty`);
      }
      nonEmpty(proof.reviewEvidence.file, "reviewEvidence.file", entry.id);
      nonEmpty(proof.reviewEvidence.test, "reviewEvidence.test", entry.id);
      nonEmpty(proof.reviewEvidence.note, "reviewEvidence.note", entry.id);
    }
    if (
      entry.status === "landed" &&
      entry.replacements.length === 0 &&
      entry.survivorRevisionIds.length === 0
    ) {
      throw new Error(
        `${entry.id}: landed retirement has no replacement or survivor`,
      );
    }
    for (const survivorId of entry.survivorRevisionIds) {
      if (!currentIds.has(survivorId)) {
        throw new Error(`${entry.id}: survivor is not current: ${survivorId}`);
      }
    }
    entries.set(entry.revisionId, entry);
  }

  for (const record of inventory.records) {
    if (currentIds.has(record.revisionId)) continue;
    const entry = entries.get(record.revisionId);
    if (!entry || entry.status !== "landed") {
      throw new Error(
        `${record.revisionId} (${record.feature}: ${record.scenario}) disappeared without a landed ledger row`,
      );
    }
  }

  for (const entry of ledger.retirements) {
    if (entry.status === "landed" && currentIds.has(entry.revisionId)) {
      throw new Error(
        `${entry.id}: landed retirement still exists in the suite`,
      );
    }
  }
}

export function referencedTests(ledger: CoverageLedger): TestReference[] {
  return ledger.retirements.flatMap((entry) =>
    entry.replacements.flatMap((proof) => [
      { file: proof.file, test: proof.test, owner: entry.id },
      {
        file: proof.reviewEvidence.file,
        test: proof.reviewEvidence.test,
        owner: entry.id,
      },
    ]),
  );
}

export function validateCollectedTests(
  ledger: CoverageLedger,
  collect: (file: string) => Set<string>,
): void {
  const byFile = new Map<string, Set<string>>();
  for (const reference of referencedTests(ledger)) {
    const collected = byFile.get(reference.file) ?? collect(reference.file);
    byFile.set(reference.file, collected);
    if (!collected.has(reference.test)) {
      throw new Error(
        `${reference.owner}: active Vitest test not collected: ${reference.file} > ${reference.test}`,
      );
    }
  }
}
