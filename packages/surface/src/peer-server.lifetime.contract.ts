/**
 * The shared lifetime-pin surface — served by the stdio child fixture
 * (`peer-server.lifetime.fixture.testlib.ts`), implemented in-process by
 * `unix-socket.test.ts`, and used as the client-side group by
 * `peer-server.lifetime.test.ts`. A module of its own so the test never has any
 * reason to import the fixture at all: a VALUE import would run the fixture's
 * top-level code and serve the importing process's stdio, and while an `import
 * type` would be erased at compile time, nothing enforces keeping the `type`
 * keyword — the separate module removes that one-keystroke hazard structurally
 * instead of by convention.
 */
import { Schema } from "effect";
import { defineSurface } from "./define";

export const lifetimeSurface = defineSurface({
  procedures: {
    sys: { ping: { output: Schema.String } },
  },
  /** Yields forever — keeps the agent PUSHING frames so a parent-side read
   *  death surfaces as a write EPIPE mid-stream (the benign-write pin). */
  streams: {
    tick: {
      inputSchema: Schema.Void,
      outputSchema: Schema.Struct({ n: Schema.Number }),
    },
  },
});

/** The wire tags the two ends agree on — spelled once so a rename cannot
 *  silently 404 one side. */
export const LIFETIME_PING_TAG = "surface/sys/ping";
export const LIFETIME_TICK_TAG = "surface/tick/get";
