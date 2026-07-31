import { readFileSync, writeFileSync } from "node:fs";

interface Timestamp {
  seconds?: number | string;
  nanos?: number;
}

interface Duration {
  seconds?: number | string;
  nanos?: number;
}

interface Envelope {
  pickle?: {
    id: string;
    uri: string;
    name: string;
    location?: { line?: number };
  };
  testCase?: { id: string; pickleId: string };
  testCaseStarted?: {
    id: string;
    testCaseId: string;
    attempt: number;
    timestamp?: Timestamp;
  };
  testStepFinished?: {
    testCaseStartedId: string;
    testStepResult?: { status?: string; duration?: Duration };
  };
  testCaseFinished?: {
    testCaseStartedId: string;
    timestamp?: Timestamp;
    willBeRetried: boolean;
  };
  testRunStarted?: { timestamp?: Timestamp };
  testRunFinished?: { timestamp?: Timestamp };
}

export interface AttemptTiming {
  feature: string;
  scenario: string;
  pickleId: string;
  attempt: number;
  status: string;
  willBeRetried: boolean;
  durationMs: number;
  stepDurationMs: number;
}

export interface TimingReport {
  schemaVersion: 1;
  platform: NodeJS.Platform;
  suiteDurationMs: number;
  attempts: AttemptTiming[];
  totals: {
    executions: number;
    attempts: number;
    retries: number;
    finalAttemptDurationMs: number;
    allAttemptDurationMs: number;
  };
  features: Array<{
    feature: string;
    executions: number;
    attempts: number;
    finalAttemptDurationMs: number;
    allAttemptDurationMs: number;
  }>;
}

function milliseconds(value?: Timestamp | Duration): number {
  if (!value) return 0;
  return (
    Number(value.seconds ?? 0) * 1_000 + Number(value.nanos ?? 0) / 1_000_000
  );
}

const STATUS_RANK = new Map([
  ["UNKNOWN", 0],
  ["PASSED", 1],
  ["SKIPPED", 2],
  ["PENDING", 3],
  ["UNDEFINED", 4],
  ["AMBIGUOUS", 5],
  ["FAILED", 6],
]);

function worstStatus(statuses: string[]): string {
  return statuses.reduce(
    (worst, status) =>
      (STATUS_RANK.get(status) ?? 99) > (STATUS_RANK.get(worst) ?? 99)
        ? status
        : worst,
    "UNKNOWN",
  );
}

export function reduceMessages(
  envelopes: Envelope[],
  platform: NodeJS.Platform = process.platform,
): TimingReport {
  const pickles = new Map(
    envelopes.flatMap((envelope) =>
      envelope.pickle ? [[envelope.pickle.id, envelope.pickle] as const] : [],
    ),
  );
  const testCases = new Map(
    envelopes.flatMap((envelope) =>
      envelope.testCase
        ? [[envelope.testCase.id, envelope.testCase] as const]
        : [],
    ),
  );
  const started = new Map(
    envelopes.flatMap((envelope) =>
      envelope.testCaseStarted
        ? [[envelope.testCaseStarted.id, envelope.testCaseStarted] as const]
        : [],
    ),
  );
  const steps = new Map<string, NonNullable<Envelope["testStepFinished"]>[]>();
  for (const envelope of envelopes) {
    if (!envelope.testStepFinished) continue;
    const id = envelope.testStepFinished.testCaseStartedId;
    steps.set(id, [...(steps.get(id) ?? []), envelope.testStepFinished]);
  }
  const attempts = envelopes.flatMap((envelope): AttemptTiming[] => {
    const finished = envelope.testCaseFinished;
    if (!finished) return [];
    const start = started.get(finished.testCaseStartedId);
    if (!start)
      throw new Error(`missing testCaseStarted ${finished.testCaseStartedId}`);
    const testCase = testCases.get(start.testCaseId);
    if (!testCase) throw new Error(`missing testCase ${start.testCaseId}`);
    const pickle = pickles.get(testCase.pickleId);
    if (!pickle) throw new Error(`missing pickle ${testCase.pickleId}`);
    const results = (steps.get(start.id) ?? []).flatMap((step) =>
      step.testStepResult ? [step.testStepResult] : [],
    );
    return [
      {
        feature: pickle.uri,
        scenario: pickle.name,
        pickleId: pickle.id,
        attempt: start.attempt + 1,
        status: worstStatus(
          results.map((result) => result.status ?? "UNKNOWN"),
        ),
        willBeRetried: finished.willBeRetried,
        durationMs: Math.max(
          0,
          milliseconds(finished.timestamp) - milliseconds(start.timestamp),
        ),
        stepDurationMs: results.reduce(
          (total, result) => total + milliseconds(result.duration),
          0,
        ),
      },
    ];
  });
  const finals = attempts.filter((attempt) => !attempt.willBeRetried);
  const featureNames = [
    ...new Set(attempts.map((attempt) => attempt.feature)),
  ].sort();
  const runStarted = envelopes.find((envelope) => envelope.testRunStarted)
    ?.testRunStarted?.timestamp;
  const runFinished = envelopes.findLast((envelope) => envelope.testRunFinished)
    ?.testRunFinished?.timestamp;
  return {
    schemaVersion: 1,
    platform,
    suiteDurationMs: Math.max(
      0,
      milliseconds(runFinished) - milliseconds(runStarted),
    ),
    attempts,
    totals: {
      executions: finals.length,
      attempts: attempts.length,
      retries: attempts.length - finals.length,
      finalAttemptDurationMs: finals.reduce(
        (total, attempt) => total + attempt.durationMs,
        0,
      ),
      allAttemptDurationMs: attempts.reduce(
        (total, attempt) => total + attempt.durationMs,
        0,
      ),
    },
    features: featureNames.map((feature) => {
      const featureAttempts = attempts.filter(
        (attempt) => attempt.feature === feature,
      );
      const featureFinals = featureAttempts.filter(
        (attempt) => !attempt.willBeRetried,
      );
      return {
        feature,
        executions: featureFinals.length,
        attempts: featureAttempts.length,
        finalAttemptDurationMs: featureFinals.reduce(
          (total, attempt) => total + attempt.durationMs,
          0,
        ),
        allAttemptDurationMs: featureAttempts.reduce(
          (total, attempt) => total + attempt.durationMs,
          0,
        ),
      };
    }),
  };
}

export function reduceMessageFile(input: string, output: string): TimingReport {
  const envelopes = readFileSync(input, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Envelope);
  const report = reduceMessages(envelopes);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
