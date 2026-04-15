/**
 * Vitest setup — initialise server modules before any test file runs.
 *
 * Modules are inert on import (no side effects), so the init functions
 * must be called explicitly. This file is the single place that does it
 * for the entire test suite, replacing per-file init calls.
 */
import { initHostname } from "./hostname.ts";
import { initLog } from "./log.ts";
import { initState } from "./state.ts";

initHostname();
initLog();

// KOLU_STATE_DIR is set by the `test:unit` script in package.json.
// Tests that don't touch state still work — Conf just writes to $TMPDIR.
initState();
