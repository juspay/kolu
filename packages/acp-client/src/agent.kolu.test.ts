/**
 * THE FIXES kolu's own runner had and this client did not, each pinned against
 * one of the fixture agents kolu's runner was tested with (`./fixtures/`).
 *
 * Each case here failed on the client as it came from olai, and passes because
 * of one change in `./agent.ts`; the commit that adds a case is the commit
 * that makes it pass.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import { type Agent, make } from "./agent.ts";
import type { AgentEvent } from "./events.ts";
import type { Memory } from "./memory.ts";
import { SAYS_NOTHING } from "./testlib/legs.ts";

const REMEMBERS_NOTHING: Memory = {
  recall: Effect.succeed(null),
  remember: () => Effect.void,
};

/** An MCP server to hand every session; no fixture here dials it. */
const TOOLS = { name: "kolu", url: "http://127.0.0.1:7714/mcp", token: "t" };

let cwd = "";
const wasState = process.env["XDG_STATE_HOME"];

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "acp-client-kolu-"));
  process.env["XDG_STATE_HOME"] = cwd;
});

afterEach(() => {
  if (wasState === undefined) delete process.env["XDG_STATE_HOME"];
  else process.env["XDG_STATE_HOME"] = wasState;
  rmSync(cwd, { recursive: true, force: true });
});

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);

/** One agent on one fixture, stopped whatever the body does. */
const withAgent = async (
  fixture: string,
  body: (agent: Agent, events: Array<AgentEvent>) => Promise<void>,
  args: ReadonlyArray<string> = [],
): Promise<void> => {
  const events: Array<AgentEvent> = [];
  const agent = await run(
    make({
      id: "an-agent",
      leg: SAYS_NOTHING,
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures", fixture), ...args],
      cwd,
      tools: () => TOOLS,
      memory: REMEMBERS_NOTHING,
      onEvent: (event) => events.push(event),
    }),
  );
  try {
    await body(agent, events);
  } finally {
    await run(agent.stop);
  }
};

/** What the agent said in the turns after `from`, as one string. */
const saidSince = (events: ReadonlyArray<AgentEvent>, from: number): string =>
  events
    .slice(from)
    .flatMap((event) => (event._tag === "said" ? [event.text] : []))
    .join("");

test("the conversation being left is closed at the agent before the next one opens", async () => {
  // The fixture is the pinned Claude adapter in miniature: every session owns
  // a real child process, and only `session/close` ends it. A client that
  // opens a second conversation without closing the first leaves the first
  // process running for the life of the agent.
  await withAgent("subprocess-agent.ts", async (agent, events) => {
    await run(agent.boot);
    await run(agent.newSession);
    const from = events.length;
    await run(agent.prompt("children"));
    expect(JSON.parse(saidSince(events, from))).toEqual({
      live: 1,
      closed: ["sess-1"],
    });
  });
});

/** Whether a process exists — `kill(pid, 0)` sends nothing and asks only
 *  that. */
const exists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A boot against `refused-initialize-agent.ts` refusing `method` with
 *  `code`, and the pid of the process it started: alive when the failed boot
 *  returned, or not. */
const refusedBoot = async (
  method: string,
  code: number,
): Promise<{ readonly gone: unknown; readonly aliveAfter: boolean }> => {
  const pidFile = join(cwd, "agent.pid");
  let outcome = { gone: null as unknown, aliveAfter: false };
  await withAgent(
    "refused-initialize-agent.ts",
    async (agent) => {
      const failed = await run(Effect.flip(agent.boot));
      const pid = Number(readFileSync(pidFile, "utf8"));
      outcome = { gone: failed, aliveAfter: exists(pid) };
    },
    [pidFile, method, String(code)],
  );
  return outcome;
};

test("a handshake the agent refuses stops the process it started", async () => {
  const { gone, aliveAfter } = await refusedBoot("initialize", -32603);
  expect(gone).toMatchObject({ _tag: "AgentGone", gone: "refused" });
  expect(aliveAfter).toBe(false);
});

test("a first conversation the agent will not open stops the process it started", async () => {
  const { gone, aliveAfter } = await refusedBoot("session/new", -32603);
  expect(gone).toMatchObject({ _tag: "AgentGone", gone: "refused" });
  expect(aliveAfter).toBe(false);
});

test("a first conversation refused for want of a sign-in keeps the process", async () => {
  // The one refusal with something to do about it: the process that refused
  // is the one a sign-in has to run against.
  const { gone, aliveAfter } = await refusedBoot("session/new", -32000);
  expect(gone).toMatchObject({ _tag: "AgentGone", auth: true });
  expect(aliveAfter).toBe(true);
});
