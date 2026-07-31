/**
 * Test-only pid-gate seams — **not for production**.
 *
 * Import via `@kolu/surface-daemon/pidGate.testlib`. The production package
 * root never re-exports these; they mutate process-wide probe deps and must
 * not be reachable from a normal daemon import.
 *
 * Restore after use: call {@link setSocketProbeDepsForTests} with no args
 * (or with the object it returned) in a `finally` block so a leaked override
 * cannot poison a later test.
 */

export {
  setSocketProbeDepsForTests,
  SOCKET_SERVE_PROBE_MS,
} from "./pidGate.ts";
