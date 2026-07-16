/**
 * The shared lifetime-pin contract — served by the stdio child fixture
 * (`peer-server.lifetime.fixture.testlib.ts`) and implemented in-process by
 * transport lifetime tests (`peer-server.lifetime.test.ts`,
 * `unix-socket.test.ts`). A module of its own so the
 * test never has any reason to import the fixture at all: a VALUE import
 * would run the fixture's top-level code and serve the importing process's
 * stdio, and while an `import type` would be erased at compile time, nothing
 * enforces keeping the `type` keyword — the separate module removes that
 * one-keystroke hazard structurally instead of by convention.
 */
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";

export const lifetimeContract = {
  ping: oc.output(z.string()),
  /** Yields forever — keeps the agent PUSHING frames so a parent-side read
   *  death surfaces as a write EPIPE mid-stream (the benign-write pin). */
  tick: oc.output(eventIterator(z.object({ n: z.number() }))),
};
