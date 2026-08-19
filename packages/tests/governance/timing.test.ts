import assert from "node:assert/strict";
import { test } from "node:test";
import { formatE2eVerdict, reduceMessages } from "./timing";

test("timing reports every attempt and keeps retry cost", () => {
  const envelopes = [
    { testRunStarted: { timestamp: { seconds: 10, nanos: 0 } } },
    {
      pickle: {
        id: "pickle",
        uri: "features/one.feature",
        name: "one promise",
        location: { line: 3 },
      },
    },
    { testCase: { id: "case", pickleId: "pickle" } },
    {
      testCaseStarted: {
        id: "attempt-1",
        testCaseId: "case",
        attempt: 0,
        timestamp: { seconds: 10, nanos: 0 },
      },
    },
    {
      testStepFinished: {
        testCaseStartedId: "attempt-1",
        testStepResult: {
          status: "FAILED",
          duration: { seconds: 1, nanos: 0 },
        },
      },
    },
    {
      testCaseFinished: {
        testCaseStartedId: "attempt-1",
        timestamp: { seconds: 12, nanos: 0 },
        willBeRetried: true,
      },
    },
    {
      testCaseStarted: {
        id: "attempt-2",
        testCaseId: "case",
        attempt: 1,
        timestamp: { seconds: 12, nanos: 0 },
      },
    },
    {
      testStepFinished: {
        testCaseStartedId: "attempt-2",
        testStepResult: {
          status: "PASSED",
          duration: { seconds: 3, nanos: 0 },
        },
      },
    },
    {
      testCaseFinished: {
        testCaseStartedId: "attempt-2",
        timestamp: { seconds: 16, nanos: 0 },
        willBeRetried: false,
      },
    },
    { testRunFinished: { timestamp: { seconds: 16, nanos: 0 } } },
  ];
  const report = reduceMessages(envelopes, "linux");
  assert.deepEqual(report.totals, {
    executions: 1,
    attempts: 2,
    retries: 1,
    finalAttemptDurationMs: 4_000,
    allAttemptDurationMs: 6_000,
  });
  assert.equal(report.suiteDurationMs, 6_000);
  assert.deepEqual(
    report.attempts.map(({ attempt, status, willBeRetried, durationMs }) => ({
      attempt,
      status,
      willBeRetried,
      durationMs,
    })),
    [
      { attempt: 1, status: "FAILED", willBeRetried: true, durationMs: 2_000 },
      { attempt: 2, status: "PASSED", willBeRetried: false, durationMs: 4_000 },
    ],
  );
});

test("formatE2eVerdict names only the last attempt of each failed scenario", () => {
  const report = {
    schemaVersion: 1 as const,
    platform: "linux" as const,
    suiteDurationMs: 1000,
    attempts: [
      {
        feature: "features/split.feature",
        scenario: "echo lands",
        pickleId: "a",
        attempt: 1,
        status: "FAILED",
        willBeRetried: true,
        durationMs: 100,
        stepDurationMs: 100,
      },
      {
        feature: "features/split.feature",
        scenario: "echo lands",
        pickleId: "a",
        attempt: 2,
        status: "PASSED",
        willBeRetried: false,
        durationMs: 80,
        stepDurationMs: 80,
      },
      {
        feature: "features/ports.feature",
        scenario: "split listener",
        pickleId: "b",
        attempt: 2,
        status: "FAILED",
        willBeRetried: false,
        durationMs: 200,
        stepDurationMs: 200,
      },
    ],
    totals: {
      executions: 2,
      attempts: 3,
      retries: 1,
      finalAttemptDurationMs: 280,
      allAttemptDurationMs: 380,
    },
    features: [],
  };
  const text = formatE2eVerdict(report);
  assert.match(text, /1 passed, 1 failed \(2 scenarios\)/);
  assert.match(text, /FAIL features\/ports\.feature {2}split listener/);
  assert.doesNotMatch(text, /echo lands/);
});

test("CI cucumber format omits pretty so the odu log keeps the verdict", async () => {
  const { cucumberFormat } = await import("../cucumber.js");
  assert.deepEqual(cucumberFormat(false), [
    "progress-bar",
    "html:reports/report.html",
    "message:reports/messages.ndjson",
  ]);
  assert.ok(cucumberFormat(true).includes("pretty:/dev/stderr"));
});
