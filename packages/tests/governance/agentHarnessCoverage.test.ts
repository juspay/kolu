import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_DIR_ENV_KEYS, AGENT_VOCABS } from "kolu-agents";
import {
  AGENT_DIR_VARS,
  FAKE_BIN_NAMES,
} from "../support/agentHarnessLists.ts";

const NON_AGENT_FAKE_BINS = new Set(["node"]);

test("the harness's agent-dir vars are a subset of the registry's env keys", () => {
  const known = new Set(AGENT_DIR_ENV_KEYS);
  const unknown = AGENT_DIR_VARS.filter((v) => !known.has(v));
  assert.deepEqual(
    unknown,
    [],
    `harness sets agent dir vars the registry does not know: ${unknown.join(", ")}`,
  );
});

test("the harness's agent fake-bins are a subset of the registry basenames", () => {
  const basenames = new Set(
    Object.values(AGENT_VOCABS).map((v) => v.cli.basename),
  );
  const unknown = FAKE_BIN_NAMES.filter(
    (name) => !NON_AGENT_FAKE_BINS.has(name) && !basenames.has(name),
  );
  assert.deepEqual(
    unknown,
    [],
    `harness stages agent binaries the registry does not know: ${unknown.join(", ")}`,
  );
});
