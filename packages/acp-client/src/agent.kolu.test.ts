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

const TOOLS: readonly [
  Extract<Handed, { kind: "stdio" }>,
  Extract<Handed, { kind: "http" }>,
] = [
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

interface Events {
  readonly all: Array<AgentEvent>;
  readonly first: (holds: (event: AgentEvent) => boolean) => Promise<void>;
}

const withAgent = async (
  fixture: string,
  body: (agent: Agent, events: Events) => Promise<void>,
  options: {
    readonly args?: ReadonlyArray<string>;
    readonly leg?: Leg;
    readonly models?: Models;
  } = {},
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
      leg: options.leg ?? SAYS_NOTHING,
      command: process.execPath,
      args: [
        join(import.meta.dirname, "fixtures", fixture),
        ...(options.args ?? []),
      ],
      cwd,
      tools: () => TOOLS,
      memory: REMEMBERS_NOTHING,
      ...(options.models === undefined ? {} : { models: options.models }),
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

const saidSince = (events: ReadonlyArray<AgentEvent>, from: number): string =>
  events
    .slice(from)
    .flatMap((event) => (event._tag === "said" ? [event.text] : []))
    .join("");

const words = (text: string): ReadonlyArray<ContentBlock> => [
  { type: "text", text },
];

test("the conversation being left is closed at the agent before the next one opens", async () => {
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

const exists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

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
    { args: [pidFile, method, String(code)] },
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
  const { gone, aliveAfter } = await refusedBoot("session/new", -32000);
  expect(gone).toMatchObject({ _tag: "AgentGone", auth: true });
  expect(aliveAfter).toBe(true);
});

test("a cancel that lost the race to a login that landed answers `signed-in`", async () => {
  await withAgent(
    "signed-out-open-agent.ts",
    async (agent, events) => {
      await run(agent.boot);
      const signing = run(agent.signIn("console-login"));
      await events.first(
        (event) =>
          event._tag === "signIn" &&
          event.signIn?.kind === "terminal" &&
          event.signIn.output.includes("https://"),
      );
      expect(await run(agent.signInCancel)).toBe(true);
      expect(await signing).toBe("signed-in");
    },
    { args: ["--login-outlives-cancel"] },
  );
});

test("a sign-in of a kind nobody here can run is not offered", async () => {
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
    { args: ["--odd-sign-ins"] },
  );
});

const LIMITED: Leg = {
  ...SAYS_NOTHING,
  accountRefusal: (data) =>
    typeof data === "object" &&
    data !== null &&
    "errorKind" in data &&
    data.errorKind === "rate_limit",
};

test("a turn refused for the ACCOUNT says so, off the agent's data", async () => {
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
    { leg: LIMITED },
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
    { leg: LIMITED },
  );
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("a prompt carries every block it was handed, not only its words", async () => {
  await withAgent("agent.ts", async (agent, events) => {
    await run(agent.boot);
    await run(
      agent.prompt([
        { type: "text", text: "look at this" },
        { type: "image", data: PNG, mimeType: "image/png" },
      ]),
    );
    const from = events.all.length;
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
  await withAgent("agent.ts", async (agent, events) => {
    await run(agent.boot);
    const advertised = events.all.find((event) => event._tag === "advertised");
    expect(advertised).toMatchObject({ image: true, embeddedContext: true });
  });
});

test("... and what the agent calls itself, for an agent that says", async () => {
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

const spelling = (server: string): string => `mcp__${server}__`;

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
    { leg: RECOGNISES },
  );
});

const PICKS: Leg = {
  ...SAYS_NOTHING,
  models: { config: "model", nameIn: namedExactly },
};

test("the model a session runs is named by its id as well as its label", async () => {
  await withAgent(
    "agent.ts",
    async (agent, events) => {
      await run(agent.boot);
      const model = events.all.findLast((event) => event._tag === "model");
      expect(model).toMatchObject({ id: "default", name: "Default" });
    },
    { leg: PICKS },
  );
});

test("a fresh conversation opens on the model its caller remembers", async () => {
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
    { leg: PICKS, models: pinned },
  );
});

test("the servers a session is handed keep the order and the shape they were given in", async () => {
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
    expect(opened?.map((entry) => "kind" in entry)).toEqual([false, false]);
  });
});

test("a cancel hands back the question the turn was holding", async () => {
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
    { args: ["--slow-handshake"] },
  );
});
