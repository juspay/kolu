import assert from "node:assert/strict";
import { test } from "node:test";
import { RpcCallFailed } from "./rpcWire.ts";
import {
  retryPadiScenarioReset,
  retryTransient,
} from "./scenarioSetupRetry.ts";

/** The wire shape `reServeSurface` answers with while its upstream link is down —
 *  a DEFECT whose `name` survives Effect's defect codec. This is the successor of
 *  the old HTTP 503. */
const upstreamDown = (): RpcCallFailed => {
  const defect = new Error("reServeSurface: … with no live upstream link");
  defect.name = "UpstreamUnavailableError";
  return new RpcCallFailed(
    "surface/padi/activityFeed/test__set",
    defect,
    false,
  );
};

test("an answered wire failure cannot masquerade as a transient transport failure", async () => {
  const failure = new RpcCallFailed(
    "surface/padi/activityFeed/test__set",
    new Error("internal detail: ECONNRESET"),
    false,
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

test("a warming-up padi restarts the whole Padi reset sequence", async () => {
  const operations: string[] = [];
  let attempt = 0;

  await retryPadiScenarioReset(1_000, async () => {
    attempt += 1;
    operations.push("killAll", "activityFeed");
    if (attempt === 1) throw upstreamDown();
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

test("a declared handler failure surfaces without another attempt", async () => {
  const failure = new RpcCallFailed(
    "surface/padi/activityFeed/test__set",
    new Error("handler failed"),
    false,
  );
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
