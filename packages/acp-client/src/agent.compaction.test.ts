import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Leg } from "@kolu/acp/engine";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { type Agent, make } from "./agent.ts";
import type { AgentEvent } from "./events.ts";
import { SAYS_NOTHING } from "./testlib/legs.ts";

const COMPACTING: Leg = { ...SAYS_NOTHING, compaction: true };

let cwd = "";
const wasState = process.env["XDG_STATE_HOME"];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "acp-client-compaction-"));
  process.env["XDG_STATE_HOME"] = cwd;
});

afterEach(() => {
  if (wasState === undefined) delete process.env["XDG_STATE_HOME"];
  else process.env["XDG_STATE_HOME"] = wasState;
  rmSync(cwd, { recursive: true, force: true });
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

const withAgent = async (
  leg: Leg,
  body: (agent: Agent, events: Array<AgentEvent>) => Promise<void>,
): Promise<void> => {
  const events: Array<AgentEvent> = [];
  const agent = await run(
    make({
      id: "an-agent",
      leg,
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures", "agent.ts")],
      cwd,
      tools: () => [],
      memory: {
        recall: Effect.succeed(null),
        remember: () => Effect.void,
      },
      onEvent: (event) => events.push(event),
    }),
  );
  try {
    await run(agent.boot);
    await run(agent.newSession);
    await body(agent, events);
  } finally {
    await run(agent.stop);
  }
};

const ask = (agent: Agent, text: string) =>
  run(agent.prompt([{ type: "text", text }]));

const compactions = (events: ReadonlyArray<AgentEvent>) =>
  events.flatMap((event) => (event._tag === "compaction" ? [event] : []));

describe("compaction reports", () => {
  test("are asked for only by a leg that reads them", async () => {
    for (const [leg, asked] of [
      [COMPACTING, true],
      [SAYS_NOTHING, false],
    ] as const) {
      await withAgent(leg, async (agent, events) => {
        const from = events.length;
        await ask(agent, "capabilities");
        const said = events
          .slice(from)
          .flatMap((event) => (event._tag === "said" ? [event.text] : []))
          .join("");
        const session = JSON.parse(said).session;
        expect("compaction" in session).toBe(asked);
        if (asked) expect(session.compaction).toEqual({});
      });
    }
  });

  test("become one event per report, with the summary folded per compaction", async () => {
    await withAgent(COMPACTING, async (agent, events) => {
      await ask(agent, "compact");
      expect(
        compactions(events).map(({ status, summary, error }) => ({
          status,
          summary,
          error,
        })),
      ).toEqual([
        { status: "in_progress", summary: null, error: null },
        {
          status: "in_progress",
          summary: "Two works are open. ",
          error: null,
        },
        {
          status: "in_progress",
          summary: "Two works are open. Nothing waits on you.",
          error: null,
        },
        {
          status: "completed",
          summary: "Two works are open. Nothing waits on you.",
          error: null,
        },
        {
          status: "completed",
          summary: "Two works are open. Nothing waits on you.",
          error: null,
        },
      ]);
      expect(new Set(compactions(events).map((one) => one.id)).size).toBe(1);
    });
  });

  test("a failed one carries its reason, and the next one starts its own fold", async () => {
    await withAgent(COMPACTING, async (agent, events) => {
      await ask(agent, "compact");
      const from = events.length;
      await ask(agent, "compactFails");
      const failed = compactions(events.slice(from));
      expect(failed.at(-1)).toMatchObject({
        status: "failed",
        summary: null,
        error: "the summary request was refused (overloaded)",
      });
      expect(failed[0]?.id).not.toBe(compactions(events)[0]?.id);
    });
  });
});
