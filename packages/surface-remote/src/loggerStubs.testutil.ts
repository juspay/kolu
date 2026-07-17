/**
 * Shared `Logger` stubs for unit tests — the ONE derivation of "a four-method
 * logger that swallows / funnels lines", instead of an inline object literal
 * copy-pasted per test file (a future `Logger` shape change edits this module,
 * not every copy). Not a test file (no `.test.ts`), so vitest doesn't collect
 * it; it's imported by the tests — same convention as
 * `controllableStream.testutil.ts`. Exported via the package's
 * `./loggerStubs.testutil` subpath so sibling packages' tests (kolu-server's
 * ssh integration test) reuse it too.
 */

import type { Logger } from "@kolu/log";

/** A `Logger` that swallows every line — for tests exercising behavior whose
 *  diagnostics are irrelevant to the assertion. */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** A `Logger` that funnels every level's `line` field to `onLine` — the
 *  collect sink log-routing tests assert against (and console-forwarding
 *  integration tests print through). Severity-blind by design; a test that
 *  asserts WHICH level fired builds its own per-level logger. */
export const collectLogger = (onLine: (line: string) => void): Logger => {
  const f = (obj: Record<string, unknown>): void => onLine(String(obj.line));
  return { debug: f, info: f, warn: f, error: f };
};
