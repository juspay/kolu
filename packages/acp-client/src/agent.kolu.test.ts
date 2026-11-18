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
import type { Leg } from "@kolu/acp/engine";
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

/** What a case can do with the agent's events: read them, or wait for the
 *  first one that satisfies `holds` (one already seen counts). */
interface Events {
  readonly all: Array<AgentEvent>;
  readonly first: (holds: (event: AgentEvent) => boolean) => Promise<void>;
}

/** One agent on one fixture, stopped whatever the body does. */
const withAgent = async (
  fixture: string,
  body: (agent: Agent, events: Events) => Promise<void>,
  args: ReadonlyArray<string> = [],
  leg: Leg = SAYS_NOTHING,
): Promise<void> => {
  const all: Array<AgentEvent> = [];
  const waiting = new Set<(event: AgentEvent) => void>();
  const first = (holds: (event: AgentEvent) => boolean): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    if (all.some(holds)) resolve();
    const check = (event: AgentEvent): void => {
      if (!holds(event)) return;
      waiting.delete(check);
      resolve();
    };
    waiting.add(check);
    return promise;
  };
  const agent = await run(
    make({
      id: "an-agent",
      leg,
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures", fixture), ...args],
      cwd,
      tools: () => TOOLS,
      memory: REMEMBERS_NOTHING,
      onEvent: (event) => {
        all.push(event);
        for (const check of [...waiting]) check(event);
      },
    }),
  );
  try {
    await body(agent, { all, first });
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
    const from = events.all.length;
    await run(agent.prompt("children"));
    expect(JSON.parse(saidSince(events.all, from))).toEqual({
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

test("a cancel that lost the race to a login that landed answers `signed-in`", async () => {
  // The login command exits 0 under the cancel's own SIGTERM, which for every
  // one of these CLIs means the credential store was written. `cancelled`
  // would leave the caller no reason to restart, and the running agent would
  // keep the old signature against a store that holds the new one.
  await withAgent(
    "signed-out-open-agent.ts",
    async (agent, events) => {
      await run(agent.boot);
      const signing = run(agent.signIn("console-login"));
      // The URL is the login's own word that it is up and waiting for a code:
      // the cancel has to land on a running login, not on one still starting.
      await events.first(
        (event) =>
          event._tag === "signIn" &&
          event.signIn?.kind === "terminal" &&
          event.signIn.output.includes("https://"),
      );
      expect(await run(agent.signInCancel)).toBe(true);
      expect(await signing).toBe("signed-in");
    },
    ["--login-outlives-cancel"],
  );
});

test("a sign-in of a kind nobody here can run is not offered", async () => {
  // A credential box (`env_var`) and a kind no version has defined, beside
  // the one this client can run: only the last is a button that does
  // something, so it is the only one offered.
  await withAgent(
    "agent.ts",
    async (agent, events) => {
      await run(agent.boot);
      const advertised = events.all.find(
        (event) => event._tag === "advertised",
      );
      expect(
        advertised?._tag === "advertised"
          ? advertised.methods.map((one) => one.id)
          : null,
      ).toEqual(["subscription"]);
    },
    ["--odd-sign-ins"],
  );
});

/** The leg's reading of the fixture's refusal data: the pinned Claude
 *  adapter's categorical kind for an account at its usage limit. */
const LIMITED: Leg = {
  ...SAYS_NOTHING,
  accountRefusal: (data) =>
    typeof data === "object" &&
    data !== null &&
    "errorKind" in data &&
    data.errorKind === "rate_limit",
};

test("a turn refused for the ACCOUNT says so, off the agent's data", async () => {
  // The fixture refuses the way the pinned Claude adapter refuses a turn at a
  // usage limit: `-32603`, with the SDK's categorical kind in `data`. Which
  // data means "this account cannot run it" is the leg's to say.
  await withAgent(
    "agent.ts",
    async (agent) => {
      await run(agent.boot);
      const refused = await run(Effect.flip(agent.prompt("limit")));
      expect(refused).toMatchObject({
        _tag: "AgentGone",
        gone: "refused",
        account: true,
        auth: false,
      });
    },
    [],
    LIMITED,
  );
});

test("a turn refused with no such data is a plain refusal", async () => {
  await withAgent(
    "agent.ts",
    async (agent) => {
      await run(agent.boot);
      const refused = await run(Effect.flip(agent.prompt("fail")));
      expect(refused).toMatchObject({ gone: "refused", account: false });
    },
    [],
    LIMITED,
  );
});
