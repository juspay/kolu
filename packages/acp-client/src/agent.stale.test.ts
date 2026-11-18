/**
 * Leftovers from a conversation that just closed must not land on the next
 * one. The e2e flake was two sightings of that one leak: a new-conversation
 * transcript that did not empty, and a server still `connected` on a
 * conversation nobody had spoken in.
 *
 * The fixture emits both leftovers on the second `session/new` BEFORE it
 * answers — which is the window olai is in after announcing the next roster
 * as `handed` and before `entered` records the new id. Pre-fix both leftovers
 * apply; post-fix neither does.
 *
 * THE AGENT IS BUILT WITH NO PROBES, by omission ({@link ./agent.ts}'s
 * `Options.probes`), so the window this file is about is the one the fixture
 * makes and not one this machine happens to add. It used to be said by
 * emptying `PATH` and unsetting a daemon's socket variable in a `beforeEach`.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Agent, make } from "./agent.ts";
import { FORWARDS } from "./testlib/legs.ts";
import type { AgentEvent } from "./events.ts";
import type { Memory } from "./memory.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "stale-session-agent.ts");

const REMEMBERS_NOTHING: Memory = {
  recall: Effect.succeed(null),
  remember: () => Effect.void,
};

const TOOLS = [
  {
    kind: "http" as const,
    name: "olai",
    url: "http://127.0.0.1:7714/mcp",
    headers: { Authorization: "Bearer secret" },
  },
];

let cwd = "";
const wasState = process.env["XDG_STATE_HOME"];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "olai-stale-"));
  process.env["XDG_STATE_HOME"] = cwd;
});

afterEach(() => {
  if (wasState === undefined) delete process.env["XDG_STATE_HOME"];
  else process.env["XDG_STATE_HOME"] = wasState;
  rmSync(cwd, { recursive: true, force: true });
});

const withAgent = async (
  body: (agent: Agent, events: Array<AgentEvent>) => Promise<void>,
): Promise<void> => {
  const events: Array<AgentEvent> = [];
  const agent = await Effect.runPromise(
    make({
      id: "an-agent",
      leg: FORWARDS,
      command: process.execPath,
      args: [FIXTURE],
      cwd,
      tools: () => TOOLS,
      memory: REMEMBERS_NOTHING,
      onEvent: (event) => events.push(event),
    }),
  );
  try {
    await body(agent, events);
  } finally {
    await Effect.runPromise(agent.stop);
  }
};

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

const standingOf = (
  events: ReadonlyArray<AgentEvent>,
  name: string,
): string | undefined => {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?._tag !== "servers") continue;
    return event.servers.find((server) => server.name === name)?.standing;
  }
  return undefined;
};

const afterOver = (
  events: ReadonlyArray<AgentEvent>,
): ReadonlyArray<AgentEvent> => {
  const at = events.findLastIndex((event) => event._tag === "sessionOver");
  return at < 0 ? events : events.slice(at + 1);
};

describe("leftovers from a conversation that just closed", () => {
  test("PIN: a leftover init does not connect the next conversation's servers", async () => {
    await withAgent(async (agent, events) => {
      await run(agent.boot);
      await run(agent.prompt([{ type: "text", text: "hello" }]));
      expect(standingOf(events, "olai")).toBe("connected");

      await run(agent.newSession);
      // The next conversation has been handed its servers and nobody has
      // spoken in it. A leftover `init` from the last turn naming `connected`
      // is news about a conversation nobody is in.
      expect(standingOf(events, "olai")).toBe("handed");
    });
  }, 15_000);

  test("PIN: a leftover chunk does not refill the transcript a new conversation emptied", async () => {
    await withAgent(async (agent, events) => {
      await run(agent.boot);
      await run(agent.prompt([{ type: "text", text: "hello" }]));
      await run(agent.newSession);
      expect(afterOver(events).some((event) => event._tag === "said")).toBe(
        false,
      );
    });
  }, 15_000);

  test("PIN: a load of a conversation we left still replays", async () => {
    // The un-close. Refusing every named leftover while `session` is null
    // would also drop the replay of a conversation we just left — the frames
    // name that id before `entered` records it.
    await withAgent(async (agent, events) => {
      await run(agent.boot);
      await run(agent.newSession);
      events.length = 0;
      await run(agent.loadSession("sess-1"));
      expect(afterOver(events).some((event) => event._tag === "said")).toBe(
        true,
      );
    });
  }, 15_000);
});
