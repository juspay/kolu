import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoundedErrorBody,
  HttpStatusError,
  retryPadiScenarioReset,
  retryTransient,
} from "./scenarioSetupRetry.ts";

test("error response capture is bounded and reports truncation", () => {
  const body = new BoundedErrorBody(5);
  body.push(Buffer.from("abc"));
  body.push(Buffer.from("defgh"));

  assert.equal(body.text(), "abcde\n[response body truncated at 5 bytes]");
});

test("an HTTP error body cannot masquerade as a transient transport failure", async () => {
  const failure = new HttpStatusError(
    500,
    "activityFeed",
    "internal detail: ECONNRESET",
  );
  let attempts = 0;

  await assert.rejects(
    retryTransient("reset", async () => {
      attempts += 1;
      throw failure;
    }),
    (err) => err === failure,
  );
  assert.equal(attempts, 1);
});

test("a 503 restarts the whole Padi reset sequence", async () => {
  const operations: string[] = [];
  let attempt = 0;

  await retryPadiScenarioReset(1_000, async () => {
    attempt += 1;
    operations.push("killAll", "activityFeed");
    if (attempt === 1) {
      throw new HttpStatusError(503, "activityFeed", "link down");
    }
    operations.push("session");
  });

  assert.deepEqual(operations, [
    "killAll",
    "activityFeed",
    "killAll",
    "activityFeed",
    "session",
  ]);
});

test("a non-503 HTTP failure surfaces without another attempt", async () => {
  const failure = new HttpStatusError(500, "activityFeed", "handler failed");
  let attempts = 0;

  await assert.rejects(
    retryPadiScenarioReset(1_000, async () => {
      attempts += 1;
      throw failure;
    }),
    (err) => err === failure,
  );
  assert.equal(attempts, 1);
});
