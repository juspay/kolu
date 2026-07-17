/**
 * Fixture for `processExit.test.ts` — the MUST-FIRE guarantee pin (run as a
 * real child under tsx's loader, never imported by vitest).
 *
 * A caller awaits `pin()` while the admit handshake wedges (the `admit` hook
 * never settles) over a transport that holds NO event-loop handle — so
 * `withHandshakeTimeout`'s timer is the process's ONLY handle. A pending
 * `await` holds no handle itself, so if that timer were `unref()`'d the
 * process would exit here silently, mid-await, without ever delivering the
 * rejection `pin()` promised. The pin: the timeout rejection REACHES the
 * awaiter (the marker prints, carrying the timeout's own message), and only
 * then does the process exit — the backoff armed after the failure is
 * unref'd, which is exactly the exit window.
 */
import { makeSession } from "./session.ts";

const session = makeSession<{ hello: () => Promise<void> }>({
  initialConnection: "connecting",
  // A live in-process "transport" with no libuv handle behind it: the client
  // is inert, `closed` never settles (and holds nothing), teardown is a no-op.
  connectOnce: (ctx) => {
    ctx.connecting();
    return Promise.resolve({
      client: { hello: () => Promise.resolve() },
      closed: new Promise<never>(() => {
        /* never settles; holds no handle */
      }),
      isAlive: () => Promise.resolve(),
      teardown: () => {
        /* nothing to tear down */
      },
    });
  },
  // The hello that never settles — the wedged-daemon shape withHandshakeTimeout
  // exists for.
  admit: () =>
    new Promise<never>(() => {
      /* never settles; holds no handle */
    }),
  connectTimeoutMs: 1_500,
  onLog: () => {},
});

session.pin().then(
  () => {
    console.log("UNEXPECTED-RESOLVE");
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`HANDSHAKE-REJECTED: ${message}`);
  },
);
