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
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { type Leg, mcpCallBy, namedExactly } from "@kolu/acp/engine";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";

import { type Agent, type Handed, make } from "./agent.ts";
import type { AgentEvent } from "./events.ts";
import type { Memory, Models } from "./memory.ts";
import { SAYS_NOTHING } from "./testlib/legs.ts";

const REMEMBERS_NOTHING: Memory = {
  recall: Effect.succeed(null),
  remember: () => Effect.void,
};

/** The MCP servers to hand every session; no fixture here dials either of
 *  them. Two, and of both transports, because the ORDER a caller hands them
 *  in is one of the things under test. */
const TOOLS: ReadonlyArray<Handed> = [
  {
    kind: "stdio",
    name: "kolu",
    command: "/bin/true",
    args: ["mcp"],
    env: { KOLU_SOCKET: "/tmp/kolu.sock" },
  },
  {
    kind: "http",
    name: "kolu-fleet",
    url: "http://127.0.0.1:7714/mcp",
    headers: { Authorization: "Bearer t" },
  },
];

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
  /** What this caller remembers the conversation is ON, if it remembers
   *  anything — kolu's is a PIN rather than a per-conversation note, which is
   *  the shape the client has to serve. */
  models?: Models,
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
      ...(models === undefined ? {} : { models }),
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

/** A turn of nothing but words, which is what most of these cases send. */
const words = (text: string): ReadonlyArray<ContentBlock> => [
  { type: "text", text },
];

test("the conversation being left is closed at the agent before the next one opens", async () => {
  // The fixture is the pinned Claude adapter in miniature: every session owns
  // a real child process, and only `session/close` ends it. A client that
  // opens a second conversation without closing the first leaves the first
  // process running for the life of the agent.
  await withAgent("subprocess-agent.ts", async (agent, events) => {
    await run(agent.boot);
    await run(agent.newSession);
    const from = events.all.length;
    await run(agent.prompt(words("children")));
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
      const refused = await run(Effect.flip(agent.prompt(words("limit"))));
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
      const refused = await run(Effect.flip(agent.prompt(words("fail"))));
      expect(refused).toMatchObject({ gone: "refused", account: false });
    },
    [],
    LIMITED,
  );
});

/** A real 1×1 PNG, base64 as a browser hands one over. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a prompt carries every block it was handed, not only its words", async () => {
  // A message is not only words: a picture somebody pasted is a block of the
  // same prompt, and a door that took a string would make it unsendable —
  // which is what kolu's own runner had and this client did not.
  await withAgent("agent.ts", async (agent, events) => {
    await run(agent.boot);
    await run(
      agent.prompt([
        { type: "text", text: "look at this" },
        { type: "image", data: PNG, mimeType: "image/png" },
      ]),
    );
    const from = events.all.length;
    // Every block of every prompt this process was handed, as the only
    // process that knows reports them — minus this question itself.
    await run(agent.prompt(words("blocks")));
    const [sent] = JSON.parse(saidSince(events.all, from)) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(sent?.[0]).toMatchObject({ type: "text", text: "look at this" });
    expect(sent?.[1]).toEqual({
      type: "image",
      data: PNG,
      mimeType: "image/png",
    });
  });
});

test("the handshake says what a message to this agent may carry", async () => {
  // ACP makes an image block and an embedded resource opt-in at the AGENT's
  // end, so a caller that lets somebody attach a file is told here or sends
  // one into a turn that fails inside the agent, with a sentence nobody wrote
  // for a person.
  await withAgent("agent.ts", async (agent, events) => {
    await run(agent.boot);
    const advertised = events.all.find((event) => event._tag === "advertised");
    expect(advertised).toMatchObject({ image: true, embeddedContext: true });
  });
});

test("... and what the agent calls itself, for an agent that says", async () => {
  // An agent that will not work and offers no way in leaves a caller with
  // nothing to say but the whole account of what was asked and what came
  // back, and which agent it was asking is half of that account. `null` for
  // the agents that give no `agentInfo` at all, which is most of them.
  await withAgent("signed-out-open-agent.ts", async (agent, events) => {
    await run(agent.boot);
    const advertised = events.all.find((event) => event._tag === "advertised");
    expect(advertised).toMatchObject({ agent: "fixture-agent 0.0.1" });
  });
});

test("an agent that advertises no prompt capabilities carries neither", async () => {
  await withAgent("text-only-agent.ts", async (agent, events) => {
    await run(agent.boot);
    const advertised = events.all.find((event) => event._tag === "advertised");
    expect(advertised).toMatchObject({ image: false, embeddedContext: false });
  });
});

/** How this fixture spells an MCP server's tools — the pinned Claude
 *  adapter's own spelling, which is what makes positive recognition worth
 *  testing against it. */
const spelling = (server: string): string => `mcp__${server}__`;

/** A leg that recognises the fixture's `kolu` call and says that one tool
 *  asks its question as a form. */
const RECOGNISES: Leg = {
  ...SAYS_NOTHING,
  spelling,
  mcpCall: mcpCallBy(spelling),
  toolNameIn: (meta) => {
    const name = (meta as { readonly name?: unknown } | null | undefined)?.name;
    return typeof name === "string" ? name : null;
  },
  asksThroughForm: (name) => name === "mcp__kolu__lifecycle_create",
};

test("a tool frame carries what was recognised, the input, the answer and the form", async () => {
  // A consumer that reads one agent's MCP calls into rows of its own — which
  // terminal a call is about, which host — needs the VALUES across both
  // frames, not a rendering of them. kolu's own runner read them off the wire;
  // on this client they had nowhere to arrive.
  await withAgent(
    "agent.ts",
    async (agent, events) => {
      await run(agent.boot);
      await run(agent.prompt(words("kolu")));
      const frame = events.all.find((event) => event._tag === "tool");
      expect(frame).toMatchObject({
        mcp: [{ server: "kolu", tool: "lifecycle_create" }],
        asksThroughForm: true,
        rawInput: { host: "remote:prod", worktree: "fix-parser" },
        answer: {
          id: "remote:prod/7f3e0a91-0000-4000-8000-000000000000",
          pid: 42,
        },
      });
      // ... and what was ASKED, folded on its own: a failed call says why in
      // its content, and the answer repeated under it would say it twice.
      expect(frame?._tag === "tool" ? frame.asked : null).toBe(
        JSON.stringify(
          {
            host: "remote:prod",
            placement: { kind: "toplevel" },
            repo: "/home/u/kolu",
            worktree: "fix-parser",
            run: "claude",
          },
          null,
          2,
        ),
      );
    },
    [],
    RECOGNISES,
  );
});

/** A leg with the fixture's picker: the model is the `model` config option,
 *  and a row's label is the one the picker gives that exact id. */
const PICKS: Leg = {
  ...SAYS_NOTHING,
  models: { config: "model", nameIn: namedExactly },
};

test("the model a session runs is named by its id as well as its label", async () => {
  // A reading of a model that needs more than a name — how big its context is,
  // out of the picker's own rows — has only the id to ask with, and a name is
  // not one: two agents may label two models alike.
  await withAgent(
    "agent.ts",
    async (agent, events) => {
      await run(agent.boot);
      const model = events.all.findLast((event) => event._tag === "model");
      expect(model).toMatchObject({ id: "default", name: "Default" });
    },
    [],
    PICKS,
  );
});

test("a fresh conversation opens on the model its caller remembers", async () => {
  // kolu's memory is a PIN — the model a person chose for this panel, which
  // every conversation it opens is meant to be on — and the agent's own
  // default outranks it at the agent's end on a NEW session exactly as it does
  // on a resumed one. Only the resumed half was put back.
  const pinned: Models = {
    read: () => Effect.succeed("sonnet"),
    write: () => Effect.void,
  };
  await withAgent(
    "agent.ts",
    async (agent, events) => {
      await run(agent.boot);
      const model = events.all.findLast((event) => event._tag === "model");
      expect(model).toMatchObject({ id: "sonnet", name: "Sonnet" });
    },
    [],
    PICKS,
    pinned,
  );
});

test("the servers a session is handed keep the order and the shape they were given in", async () => {
  // THE ONE KEY THE ADAPTER BRANCHES ON: an entry with `type: "http"` is an
  // endpoint, an entry with NO `type` is a program, and one carrying
  // `type: "stdio"` is silently dropped. The caller's order is the order a
  // person reads the roster in, so it is the order on the wire.
  await withAgent("agent.ts", async (agent, events) => {
    await run(agent.boot);
    const from = events.all.length;
    await run(agent.prompt(words("serverShapes")));
    const [opened] = JSON.parse(saidSince(events.all, from)) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(opened).toEqual([
      {
        name: "kolu",
        command: "/bin/true",
        args: ["mcp"],
        env: [{ name: "KOLU_SOCKET", value: "/tmp/kolu.sock" }],
      },
      {
        type: "http",
        name: "kolu-fleet",
        url: "http://127.0.0.1:7714/mcp",
        headers: [{ name: "Authorization", value: "Bearer t" }],
      },
    ]);
    // ... and the in-tree discriminant never crosses: `kind` on the wire would
    // be an unknown key on a server the adapter is about to spawn.
    expect(opened?.map((entry) => "kind" in entry)).toEqual([false, false]);
  });
});

test("a cancel hands back the question the turn was holding", async () => {
  // A question is a request the agent is holding open, and the turn a person
  // just stopped is the turn it belongs to: nobody is going to answer it, and
  // the row for it must not be left live on a turn that has ended.
  await withAgent("agent.ts", async (agent, events) => {
    await run(agent.boot);
    const turn = run(agent.prompt(words("ask")));
    await events.first((event) => event._tag === "asked");
    const asked = events.all.find((event) => event._tag === "asked");
    await run(agent.cancel);
    await events.first(
      (event) =>
        event._tag === "askSettled" &&
        event.id === (asked?._tag === "asked" ? asked.id : ""),
    );
    const settled = events.all.find((event) => event._tag === "askSettled");
    expect(settled?._tag === "askSettled" ? settled.outcome : null).toEqual({
      how: "withdrawn",
      answers: [],
    });
    await turn;
  });
});

test("a conversation this agent never advertised it keeps is still asked for", async () => {
  // The advertisement is a PREDICTION of what the request itself proves, and
  // the two answers it collapses are not alike: "there is no such
  // conversation" is a refusal a caller can act on — open a fresh one, and
  // say why — and "this build does not advertise `loadSession`" was a
  // sentence this client made up with no agent behind it. The fixture
  // advertises nothing and refuses the load in its own words.
  await withAgent("signed-out-open-agent.ts", async (agent) => {
    const refused = await run(Effect.flip(agent.loadSession("ba0d-0775")));
    expect(refused).toMatchObject({
      _tag: "AgentGone",
      gone: "refused",
      missing: true,
    });
    expect(refused.why).toContain("Resource not found: ba0d-0775");
  });
});

test("a stop that lands during the handshake opens nothing", async () => {
  // The process is not `live` until its handshake is answered, so a stop in
  // that window cannot reach it directly; the bring-up that answers it after
  // the stop must stop it instead of opening a conversation for nobody.
  await withAgent(
    "agent.ts",
    async (agent, events) => {
      const booting = run(Effect.result(agent.boot));
      await new Promise((done) => setTimeout(done, 50));
      await run(agent.stopWithReason("scope released"));
      const outcome = await booting;
      expect(outcome._tag).toBe("Failure");
      expect(events.all.some((event) => event._tag === "session")).toBe(false);
    },
    ["--slow-handshake"],
  );
});
