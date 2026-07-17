/**
 * Fixture for `processExit.test.ts` — the IMMORTALIZATION red (run as a real
 * child under tsx's loader, never imported by vitest).
 *
 * The abandoned-session shape from the surface-lifetime audit: a process
 * creates a session against a never-connecting endpoint (every dial rejects
 * `"network"`, so the reconnect backoff re-arms forever), `pin()`s it, never
 * calls `destroy()`, and reaches the end of its main script. The process must
 * then EXIT — the session's timers may not hold the event loop on their own.
 * Pre-fix, the ref'd backoff timer pinned the loop and this child ran forever.
 *
 * `reconnectDelayMs` is deliberately LONGER than the test's exit deadline: a
 * clean exit therefore proves the pending timer did not hold the loop — it
 * cannot be explained by the timer having fired.
 */
import { ConnectError, makeSession } from "./session.ts";
import { silentLogger } from "./loggerStubs.testutil.ts";

const session = makeSession({
  initialConnection: "connecting",
  connectOnce: () =>
    Promise.reject(new ConnectError("endpoint gone", "network")),
  reconnectDelayMs: 30_000,
  log: silentLogger,
});

session.pin().catch(() => {
  /* the dial rejects by construction; abandonment is the point */
});

// Drop the session without destroy() and let the main script end. If the
// process exits, this marker is the last thing it said.
console.log("MAIN-END");
