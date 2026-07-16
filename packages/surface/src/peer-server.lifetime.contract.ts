/**
 * Contract shared by `peer-server.lifetime.fixture.ts` (the child agent) and
 * `peer-server.lifetime.test.ts` (the parent). A module of its own because
 * the test cannot import the fixture — the fixture is a script whose
 * top-level code serves the importing process's stdio.
 */
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";

export const lifetimeContract = {
  ping: oc.output(z.string()),
  /** Yields forever — keeps the agent PUSHING frames so a parent-side read
   *  death surfaces as a write EPIPE mid-stream (the benign-write pin). */
  tick: oc.output(eventIterator(z.object({ n: z.number() }))),
};
