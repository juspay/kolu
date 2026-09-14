/**
 * Harness ↔ registry coverage. The e2e harness (`support/hooks.ts`) keeps its
 * own explicit agent lists on purpose — a harness that DERIVED them from the
 * registry would stop catching a registry mistake. The cost is they can drift
 * behind the registry; this gate catches the safe direction of that drift: a
 * harness var or fake binary that names an agent the registry no longer knows
 * (or never knew) fails here.
 *
 * The lists deliberately DIFFER from `AGENT_DIR_ENV_KEYS` — the harness leaves
 * the `*_DB` keys (codex/opencode) unset, and stages a `node` binary that is
 * not an agent at all — so the assertions are subsets in the direction that
 * matters, not equality.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_DIR_ENV_KEYS, AGENT_VOCABS } from "kolu-agents";
import {
  AGENT_DIR_VARS,
  FAKE_BIN_NAMES,
} from "../support/agentHarnessLists.ts";

/** The staged binaries that are NOT agents (the command-rooted repro's root). */
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
