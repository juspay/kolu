import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceMessages } from "./timing";

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
