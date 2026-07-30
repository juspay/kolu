import assert from "node:assert/strict";
import { test } from "node:test";
import {
  distribution,
  summarizeBaseline,
  type BaselineSample,
} from "./baseline";

test("distribution reports median and IQR", () => {
  assert.deepEqual(distribution([9, 1, 5, 3, 7]), {
    median: 5,
    q1: 2,
    q3: 8,
    iqr: 6,
  });
});

test("baseline requires five independent samples on both platforms", () => {
  const sample = (
    platform: BaselineSample["platform"],
    index: number,
  ): BaselineSample => ({
    platform,
    runId: `${platform}-${index}`,
    sha: "abc",
    e2eMs: 100 + index,
    unitMs: 20 + index,
    daemonMs: 30 + index,
    criticalPathMs: 110 + index,
    attempts: 541,
    retries: index,
  });
  assert.throws(
    () =>
      summarizeBaseline([0, 1, 2, 3].map((index) => sample("linux", index))),
    /linux: need at least 5 samples/,
  );
  const summary = summarizeBaseline(
    (["linux", "darwin"] as const).flatMap((platform) =>
      [0, 1, 2, 3, 4].map((index) => sample(platform, index)),
    ),
  );
  assert.equal(summary.platforms[0]?.criticalPathMs.median, 112);
  assert.equal(summary.platforms[1]?.samples, 5);
});
