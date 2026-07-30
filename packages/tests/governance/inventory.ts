import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateMessages } from "@cucumber/gherkin";
import {
  IdGenerator,
  SourceMediaType,
  type GherkinDocument,
  type Pickle,
  type Step,
} from "@cucumber/messages";

export const INVENTORY_SCHEMA_VERSION = 1;

export interface ExampleRevision {
  id: string;
  name: string;
}

export interface ScenarioRevision {
  revisionId: string;
  scenarioKey: string;
  feature: string;
  rule?: string;
  scenario: string;
  kind: "scenario" | "outline";
  tags: string[];
  bodyHash: string;
  exampleRows: ExampleRevision[];
  executions: number;
  firstSeenSha: string;
}

export interface ScenarioInventory {
  schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  records: ScenarioRevision[];
}

export interface SuiteCensus {
  featureFiles: number;
  declarations: number;
  executions: number;
  linuxDefault: number;
  darwinDefault: number;
}

interface ParsedSuite {
  records: ScenarioRevision[];
  pickles: Pickle[];
  featureFiles: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeStep(step: Step): unknown {
  const argument = step.dataTable
    ? {
        dataTable: step.dataTable.rows.map((row) =>
          row.cells.map((cell) => cell.value),
        ),
      }
    : step.docString
      ? {
          docString: {
            content: step.docString.content,
            mediaType: step.docString.mediaType ?? null,
          },
        }
      : null;
  return {
    keywordType: step.keywordType,
    text: step.text,
    argument,
  };
}

function normalizePickle(pickle: Pickle): unknown {
  return {
    name: pickle.name,
    tags: pickle.tags.map((tag) => tag.name).sort(),
    steps: pickle.steps.map((step) => ({
      type: step.type,
      text: step.text,
      argument: step.argument
        ? step.argument.dataTable
          ? {
              dataTable: step.argument.dataTable.rows.map((row) =>
                row.cells.map((cell) => cell.value),
              ),
            }
          : {
              docString: {
                content: step.argument.docString?.content ?? "",
                mediaType: step.argument.docString?.mediaType ?? null,
              },
            }
        : null,
    })),
  };
}

function scenariosIn(document: GherkinDocument): Array<{
  scenario: NonNullable<
    GherkinDocument["feature"]
  >["children"][number]["scenario"];
  rule?: string;
}> {
  const feature = document.feature;
  if (!feature) return [];
  const result: Array<{
    scenario: NonNullable<
      GherkinDocument["feature"]
    >["children"][number]["scenario"];
    rule?: string;
  }> = [];
  for (const child of feature.children) {
    if (child.scenario) result.push({ scenario: child.scenario });
    if (!child.rule) continue;
    for (const ruleChild of child.rule.children) {
      if (ruleChild.scenario) {
        result.push({ scenario: ruleChild.scenario, rule: child.rule.name });
      }
    }
  }
  return result;
}

export function parseFeature(
  uri: string,
  source: string,
  firstSeenSha: string,
): { records: ScenarioRevision[]; pickles: Pickle[] } {
  const envelopes = generateMessages(
    source,
    uri,
    SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
    {
      defaultDialect: "en",
      includeSource: false,
      includeGherkinDocument: true,
      includePickles: true,
      newId: IdGenerator.incrementing(),
    },
  );
  const parseErrors = envelopes.flatMap((envelope) =>
    envelope.parseError ? [envelope.parseError.message] : [],
  );
  if (parseErrors.length > 0) {
    throw new Error(`${uri}: ${parseErrors.join("\n")}`);
  }
  const document = envelopes.find(
    (envelope) => envelope.gherkinDocument,
  )?.gherkinDocument;
  if (!document?.feature) throw new Error(`${uri}: no Feature found`);
  const pickles = envelopes.flatMap((envelope) =>
    envelope.pickle ? [envelope.pickle] : [],
  );
  const records = scenariosIn(document).map(({ scenario, rule }) => {
    if (!scenario) throw new Error(`${uri}: malformed scenario`);
    const scenarioPickles = pickles.filter((pickle) =>
      pickle.astNodeIds.includes(scenario.id),
    );
    const tags = [
      ...new Set(
        scenarioPickles.flatMap((pickle) => pickle.tags.map((tag) => tag.name)),
      ),
    ].sort();
    const normalizedExecutions = scenarioPickles
      .map(normalizePickle)
      .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
    const normalizedDeclaration = {
      feature: document.feature?.name,
      rule: rule ?? null,
      keyword: scenario.keyword,
      name: scenario.name,
      tags,
      description: scenario.description,
      steps: scenario.steps.map(normalizeStep),
      executions: normalizedExecutions,
    };
    const bodyHash = sha256(stableJson(normalizedDeclaration));
    const scenarioKey = `scenario-${sha256(
      stableJson({
        uri,
        feature: document.feature?.name,
        rule,
        name: scenario.name,
      }),
    ).slice(0, 20)}`;
    const exampleRows =
      scenario.examples.length === 0
        ? []
        : scenarioPickles.map((pickle) => {
            const normalized = stableJson(normalizePickle(pickle));
            return {
              id: `example-${sha256(normalized).slice(0, 20)}`,
              name: pickle.name,
            };
          });
    return {
      revisionId: `revision-${sha256(`${scenarioKey}\0${bodyHash}`).slice(0, 20)}`,
      scenarioKey,
      feature: uri,
      ...(rule ? { rule } : {}),
      scenario: scenario.name,
      kind:
        scenario.examples.length > 0 ||
        /outline|template/i.test(scenario.keyword)
          ? ("outline" as const)
          : ("scenario" as const),
      tags,
      bodyHash,
      exampleRows,
      executions: scenarioPickles.length,
      firstSeenSha,
    };
  });
  const keys = new Set<string>();
  for (const record of records) {
    if (keys.has(record.scenarioKey)) {
      throw new Error(
        `${uri}: duplicate scenario identity for "${record.scenario}"; scenario names must be unique within a feature/rule`,
      );
    }
    keys.add(record.scenarioKey);
  }
  return { records, pickles };
}

export function readCurrentSuite(
  packageRoot: string,
  firstSeenSha: string,
): ParsedSuite {
  const featureRoot = path.join(packageRoot, "features");
  const featureFiles = readdirSync(featureRoot)
    .filter((name) => name.endsWith(".feature"))
    .sort();
  const parsed = featureFiles.map((name) => {
    const uri = `features/${name}`;
    return parseFeature(
      uri,
      readFileSync(path.join(featureRoot, name), "utf8"),
      firstSeenSha,
    );
  });
  return {
    records: parsed.flatMap((item) => item.records),
    pickles: parsed.flatMap((item) => item.pickles),
    featureFiles: featureFiles.length,
  };
}

function isDefaultPickle(
  pickle: Pickle,
  platform: "linux" | "darwin",
): boolean {
  const tags = new Set(pickle.tags.map((tag) => tag.name));
  return (
    !tags.has("@skip") &&
    !tags.has("@recording") &&
    (platform !== "darwin" || !tags.has("@skip-darwin"))
  );
}

export function census(suite: ParsedSuite): SuiteCensus {
  return {
    featureFiles: suite.featureFiles,
    declarations: suite.records.length,
    executions: suite.pickles.length,
    linuxDefault: suite.pickles.filter((pickle) =>
      isDefaultPickle(pickle, "linux"),
    ).length,
    darwinDefault: suite.pickles.filter((pickle) =>
      isDefaultPickle(pickle, "darwin"),
    ).length,
  };
}

export function appendCurrentRevisions(
  inventory: ScenarioInventory,
  current: ScenarioRevision[],
): ScenarioInventory {
  if (inventory.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
    throw new Error(`unsupported inventory schema ${inventory.schemaVersion}`);
  }
  const known = new Set(inventory.records.map((record) => record.revisionId));
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    records: [
      ...inventory.records,
      ...current
        .filter((record) => !known.has(record.revisionId))
        .sort((a, b) =>
          `${a.feature}\0${a.rule ?? ""}\0${a.scenario}`.localeCompare(
            `${b.feature}\0${b.rule ?? ""}\0${b.scenario}`,
          ),
        ),
    ],
  };
}

export function assertAppendOnly(
  base: ScenarioInventory,
  candidate: ScenarioInventory,
): void {
  const candidateById = new Map(
    candidate.records.map((record) => [record.revisionId, record]),
  );
  for (const record of base.records) {
    const next = candidateById.get(record.revisionId);
    if (!next)
      throw new Error(`inventory record removed: ${record.revisionId}`);
    if (stableJson(next) !== stableJson(record)) {
      throw new Error(`inventory record mutated: ${record.revisionId}`);
    }
  }
}
