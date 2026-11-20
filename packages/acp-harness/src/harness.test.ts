import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  allowingOurs,
  type Leg,
  mcpCallBy,
  namedExactly,
  type Reported,
} from "@kolu/acp/engine";
import { afterEach, describe, expect, test } from "vitest";
import {
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  HarnessRefused,
  type HarnessState,
  type PersonSaid,
  startHarness,
} from "./harness.ts";
import {
  decodedAsServer,
  type FixtureFile,
  type FixtureRow,
} from "./rows.testlib.ts";
import type { RowContent } from "./transcript.ts";
import { fixtureAgent } from "@kolu/acp-client/testlib";

const CONFIG_DIR = "/tmp/kolu-test-home/.claude";

const TEACHING = "# [fixture] you are the fixture's conversation";

const spelling = (server: string): string => `mcp__${server}__`;

const meta = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const RAW = {
  openMeta: { test: { forward: true } },
  method: "_test/raw",
  modelIn: (params: unknown): string | null => {
    const model = meta(params)?.model;
    return typeof model === "string" ? model : null;
  },
  serversIn: (params: unknown): ReadonlyArray<Reported> | null => {
    const servers = meta(params)?.servers;
    if (!Array.isArray(servers)) return null;
    return servers.flatMap((entry): ReadonlyArray<Reported> => {
      const row = meta(entry);
      return typeof row?.name === "string" && typeof row.status === "string"
        ? [
            {
              name: row.name,
              attached: row.status === "connected",
              said: row.status,
            },
          ]
        : [];
    });
  },
};

const leg: Leg = {
  spelling,
  mcpCall: mcpCallBy(spelling),
  replyIn: () => undefined,
  accountRefusal: (data) => flag(data, "errorKind") === "rate_limit",
  toolNameIn: (value) => {
    const name = meta(value)?.name;
    return typeof name === "string" ? name : null;
  },
  toolNameOf: () => null,
  asksThroughForm: (name) => name === "AskUserQuestion",
  allowedWithoutAsking: allowingOurs(spelling),
  parentToolUse: (value) => {
    const parent = meta(value)?.parent;
    return typeof parent === "string" ? parent : null;
  },
  spawned: () => null,
  backgroundTask: (value) => {
    const armed = meta(meta(value)?.background);
    if (armed === null || typeof armed.task !== "string") return null;
    return {
      task: armed.task,
      ...(typeof armed.description === "string"
        ? { description: armed.description }
        : {}),
      ...(typeof armed.ended === "string" ? { ended: armed.ended } : {}),
    };
  },
  taskNotification: () => null,
  listedIn: () => null,
  prologueIn: () => null,
  bypassMode: "bypassPermissions",
  bypassModeRequired: false,
  steering: null,
  queues: () => false,
  rawMessages: RAW,
  models: {
    config: "model",
    nameIn: namedExactly,
    windowIn: (labels, id) => (labels.has(id) ? 200_000 : null),
  },
};

const silent = { info: () => {}, warn: () => {}, error: () => {} };

interface Running {
  readonly harness: Harness<FixtureRow>;
  readonly rows: () => ReadonlyArray<FixtureRow>;
  readonly states: ReadonlyArray<HarnessState>;
}

const typed = (
  text: string,
  files: ReadonlyArray<FixtureFile>,
): PersonSaid<FixtureRow> => ({
  text,
  body: text,
  extra: { attachments: files },
  files,
});

const readCall: HarnessOptions<FixtureRow>["readCall"] = (frame, held) => {
  const input = meta(frame.input);
  const answer = meta(frame.answer);
  const call = {
    about: text(input?.host) ?? text(answer?.id) ?? held?.call?.about ?? null,
    did: text(input?.worktree) ?? text(answer?.ran) ?? held?.call?.did ?? null,
  };
  const named = frame.mcp[0];
  if (
    named === undefined &&
    frame.asksThroughForm === undefined &&
    call.about === null &&
    call.did === null
  ) {
    return undefined;
  }
  return {
    extra: {
      server: named?.server,
      tool: named?.tool,
      asksThroughForm: frame.asksThroughForm,
      ...(call.about === null && call.did === null ? {} : { call }),
    },
  };
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const started: Array<Harness<FixtureRow>> = [];

afterEach(async () => {
  const live = started.splice(0, started.length);
  await Promise.all(live.map((harness) => harness.stop("stopped by app")));
});

const open = async (
  fixture: string,
  extra: {
    resume?: string | null;
    resumedSeq?: number;
    resumedEndsWithDivider?: boolean;
    taught?: boolean;
    model?: string | null;
    leg?: Leg;
    mcpServers?: HarnessOptions<FixtureRow>["mcpServers"];
    whenNewSession?: "divide" | "clear";
    whenLoadRefused?: "fresh" | "report";
    whenReplayed?: "drop" | "keep";
    args?: ReadonlyArray<string>;
  } = {},
): Promise<Running> => {
  const rows = new Map<string, FixtureRow>();
  const states: Array<HarnessState> = [];
  const fold = (change: HarnessChange<FixtureRow>): void => {
    if (change.kind === "state") {
      states.push(change.state);
      return;
    }
    if (change.kind !== "rows") return;
    for (const row of change.upserts) {
      const read = decodedAsServer(row);
      rows.set(read.id, read);
    }
    for (const id of change.removes) rows.delete(id);
    for (const append of change.appends) {
      const row = rows.get(append.of);
      if (row === undefined || !("text" in row)) continue;
      rows.set(append.of, {
        ...row,
        text: `${row.text.slice(0, append.at)}${append.text}`,
      });
    }
  };
  const harness = await startHarness<FixtureRow>({
    agent: "fixture-agent",
    leg: extra.leg ?? leg,
    adapter: {
      command: process.execPath,
      args: [fixtureAgent(fixture), ...(extra.args ?? [])],
    },
    cwd: process.cwd(),
    configDir: CONFIG_DIR,
    mcpServers: extra.mcpServers ?? [
      { kind: "stdio", name: "kolu", command: "/bin/true", args: [], env: {} },
    ],
    teaching: TEACHING,
    taught: extra.taught ?? false,
    log: silent,
    opens:
      extra.resume === undefined || extra.resume === null
        ? { kind: "fresh" }
        : { kind: "resume", id: extra.resume },
    ...(extra.resumedSeq === undefined ? {} : { resumedSeq: extra.resumedSeq }),
    ...(extra.resumedEndsWithDivider === undefined
      ? {}
      : { resumedEndsWithDivider: extra.resumedEndsWithDivider }),
    ...(extra.model === undefined ? {} : { model: extra.model }),
    readCall,
    whenNewSession: extra.whenNewSession ?? "divide",
    numbering: "continues",
    whenLoadRefused: extra.whenLoadRefused ?? "fresh",
    whenReplayed: extra.whenReplayed ?? "drop",
    onChange: fold,
  });
  started.push(harness);
  return {
    harness,
    rows: () => [...rows.values()].sort((a, b) => a.seq - b.seq),
    states,
  };
};

const agentWhy = (state: {
  readonly signIn: HarnessState["signIn"];
}): string => {
  const cause = state.signIn?.cause;
  if (cause?.kind !== "agent")
    throw new Error(`no sign-in the agent offered: ${JSON.stringify(cause)}`);
  return cause.why;
};

const settled = async (running: Running, why: string): Promise<void> => {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const state = running.harness.state();
    if (state.phase === "idle" || state.phase === "asking") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${why}: still ${running.harness.state().phase}`);
};

const oauthUrlIn = (output: string | null | undefined): URL | null => {
  const found = (output ?? "").match(/https:\/\/\S+/);
  if (found === null) return null;
  try {
    return new URL(found[0]);
  } catch {
    return null;
  }
};

const waitFor = async (
  running: Running,
  holds: (state: HarnessState) => boolean,
  why: string,
): Promise<void> => {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if (holds(running.harness.state())) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${why}: ${JSON.stringify(running.harness.state().signIn)}`);
};

const textOfKind = (
  running: Running,
  kind: FixtureRow["kind"],
): ReadonlyArray<string> =>
  running
    .rows()
    .filter((row) => row.kind === kind)
    .map((row) => ("text" in row ? row.text : ""));

const asked = async (running: Running, about: string): Promise<unknown> => {
  await running.harness.prompt(typed(about, []), false);
  await settled(running, `the \`${about}\` turn never ended`);
  const said = textOfKind(running, "agent");
  return JSON.parse(said[said.length - 1] ?? "null");
};

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const ATTACHMENTS = await mkdtemp(path.join(tmpdir(), "acp-harness-"));

const written = async (
  fields: Omit<FixtureFile, "path">,
  contents: Buffer,
): Promise<FixtureFile> => {
  const where = path.join(ATTACHMENTS, fields.id);
  await writeFile(where, contents);
  return { ...fields, path: where };
};

const picture = (
  over: Partial<Omit<FixtureFile, "path">> = {},
): Promise<FixtureFile> =>
  written(
    {
      id: "att-1",
      name: "shot.png",
      mimeType: "image/png",
      bytes: 68,
      ...over,
    },
    Buffer.from(PNG, "base64"),
  );

const dead = async (running: Running): Promise<void> => {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if (!running.harness.alive()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the agent never died");
};

const dividers = (running: Running): ReadonlyArray<FixtureRow> =>
  running.rows().filter((one) => one.kind === "divider");

describe("one conversation with a real agent", () => {
  test("a prompt goes out and the answer comes back as one growing row", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");

    const rows = running.rows();
    const mine = rows.find((row) => row.id === rowId);
    expect(mine?.kind).toBe("user");
    expect(mine && "text" in mine ? mine.text : "").toBe("hello");
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
    expect(running.harness.rows().map((row) => row.id)).toEqual(
      rows.map((row) => row.id),
    );
    expect(running.harness.state().sessionId).toBe("sess-1");
  });

  test("the standing prompt rides the FIRST message and no later one", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the second turn never ended");
    expect(textOfKind(running, "user")).toEqual(["hello", "hello"]);

    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies[0]).toBe(`${TEACHING}\n\nhello`);
    expect(bodies[1]).toBe("hello");
  });

  test("a frame for a session we left is dropped", async () => {
    const running = await open("agent.ts");
    await running.harness.newSession();
    expect(running.harness.state().sessionId).toBe("sess-2");
    await running.harness.prompt(typed("stale", []), false);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["live"]);
  });

  test("a new session keeps the history, with a divider between them", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.newSession();
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the second turn never ended");

    const kinds = running.rows().map((row) => row.kind);
    expect(kinds.filter((kind) => kind === "divider")).toHaveLength(1);
    expect(textOfKind(running, "user")).toEqual(["hello", "hello"]);
    expect(textOfKind(running, "agent")).toEqual(["hello back", "hello back"]);
    const seqs = running.rows().map((row) => row.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  test("a request about the session just left is turned away while the next one opens", async () => {
    const running = await open("agent.ts", {
      args: ["--ask-about-the-left-session"],
    });
    await running.harness.newSession();
    expect(running.harness.state().sessionId).toBe("sess-2");
    expect(running.rows().filter((row) => row.kind === "ask")).toEqual([]);
    expect(running.harness.state().openAsks).toEqual([]);
    expect(await asked(running, "leftAnswers")).toEqual([
      { outcome: { outcome: "cancelled" } },
    ]);
  });

  test("a cancel settles the question the turn was holding, withdrawn", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("ask", []), false);
    const until = Date.now() + 10_000;
    while (
      running.harness.state().openAsks.length === 0 &&
      Date.now() < until
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const [askId] = running.harness.state().openAsks;
    expect(askId).toBeDefined();

    await running.harness.cancel();
    await settled(running, "the cancelled turn never ended");

    const ask = running.rows().find((row) => row.id === askId);
    expect(ask?.kind).toBe("ask");
    expect(ask?.kind === "ask" ? ask.ask.outcome : null).toEqual({
      how: "withdrawn",
      answers: [],
    });
    expect(running.harness.state().openAsks).toEqual([]);
    expect(textOfKind(running, "notice")).toContain("the turn was cancelled");
  });

  test("a page the agent says is done settles the question row it was drawn as", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("visit", []), false);
    await waitFor(
      running,
      (state) => state.phase === "idle",
      "the turn waiting on the page never ended",
    );
    const ask = running.rows().find((row) => row.kind === "ask");
    expect(ask?.kind === "ask" ? ask.ask.outcome : null).toEqual({
      how: "answered",
      answers: [],
    });
    expect(running.harness.state().openAsks).toEqual([]);
  });

  test("a prompt sent while the agent is busy is marked queued, and unmarked when taken", async () => {
    const running = await open("agent.ts");
    const first = await running.harness.prompt(typed("slow", []), false);
    const second = await running.harness.prompt(typed("hello", []), false);
    const queued = running.rows().find((row) => row.id === second.rowId);
    expect(queued?.kind === "user" ? queued.queued : undefined).toBe(true);
    expect(first.rowId).not.toBe(second.rowId);

    await settled(running, "the queued turn never ended");
    const taken = running.rows().find((row) => row.id === second.rowId);
    expect(taken?.kind === "user" ? taken.queued : undefined).toBeUndefined();
  });

  test("a background task outlives its turn and its death lands as a notice", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("background", []), false);
    await settled(running, "the arming turn never ended");

    const armedRow = running
      .rows()
      .find((row) => row.kind === "tool" && row.armed !== undefined);
    expect(
      armedRow?.kind === "tool" ? armedRow.stranded : true,
    ).toBeUndefined();
    expect(running.harness.state().watching.map((one) => one.name)).toEqual([
      "watch the build",
    ]);

    await running.harness.prompt(typed("reap", []), false);
    await settled(running, "the reaping turn never ended");
    expect(textOfKind(running, "notice").join("\n")).toContain(
      "ended (completed)",
    );
    expect(running.harness.state().watching).toEqual([]);
  });

  test("a recognised call reaches the product's reader and lands on the row", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("kolu", []), false);
    await settled(running, "the turn never ended");

    const call = running.rows().find((row) => row.kind === "tool");
    expect(call?.kind === "tool" ? call.server : null).toBe("kolu");
    expect(call?.kind === "tool" ? call.tool : null).toBe("lifecycle_create");
    expect(call?.kind === "tool" ? call.call : null).toEqual({
      about: "remote:prod",
      did: "fix-parser",
    });
  });

  test("a turn the agent refuses marks the row refused and leaves the conversation alive", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt(typed("fail", []), false);
    await settled(running, "the failed turn never ended");
    const row = running.rows().find((one) => one.id === rowId);
    expect(row?.kind === "user" ? row.delivery : null).toBe("refused");
    expect(running.harness.state().phase).toBe("idle");
  });

  test("a load passes the SAME mcpServers — and the same `_meta` — a new session got", async () => {
    const fresh = await open("agent.ts");
    await fresh.harness.newSession();
    expect(await asked(fresh, "servers")).toEqual([["kolu"], ["kolu"]]);
    expect(await asked(fresh, "meta")).toEqual([RAW.openMeta, RAW.openMeta]);
    await fresh.harness.stop("stopped by app");

    const resumed = await open("agent.ts", { resume: "sess-1" });
    expect(await asked(resumed, "servers")).toEqual([["kolu"]]);
    expect(await asked(resumed, "meta")).toEqual([RAW.openMeta]);
    expect(resumed.harness.state().sessionId).toBe("sess-1");
  });

  test("both MCP arms reach the wire in the shapes the adapter reads", async () => {
    // THE ONE KEY THE ADAPTER BRANCHES ON. `claude-agent-acp` 0.81.2
    // (`dist/acp-agent.js:6536-6558`) makes an entry with `type: "http"` an
    // HTTP server, an entry with NO `type` key a stdio server, and SILENTLY
    // DROPS one carrying `type: "stdio"`. So this asserts the ABSENCE of the
    // key on the stdio arm as hard as its presence on the http arm: a harness
    // that "completed" the union would hand the conductor a session with no
    // hands and no error anywhere.
    const running = await open("agent.ts", {
      mcpServers: [
        {
          kind: "stdio",
          name: "kolu",
          command: "/bin/true",
          args: ["mcp"],
          env: { PADI_SOCKET: "/tmp/padi.sock" },
        },
        {
          kind: "http",
          name: "kolu-fleet",
          url: "http://127.0.0.1:45121/mcp",
          headers: { Authorization: "Bearer deadbeef" },
        },
      ],
    });
    const shapes = await asked(running, "serverShapes");
    expect(shapes).toEqual([
      [
        {
          name: "kolu",
          command: "/bin/true",
          args: ["mcp"],
          env: [{ name: "PADI_SOCKET", value: "/tmp/padi.sock" }],
        },
        {
          type: "http",
          name: "kolu-fleet",
          url: "http://127.0.0.1:45121/mcp",
          headers: [{ name: "Authorization", value: "Bearer deadbeef" }],
        },
      ],
    ]);
    const [firstOpen = []] = shapes as Array<Array<Record<string, unknown>>>;
    expect(firstOpen.map((entry) => "type" in entry)).toEqual([false, true]);
    expect(firstOpen.map((entry) => "kind" in entry)).toEqual([false, false]);
  });
});

describe("the permission mode a conversation is opened in", () => {
  test("is asked for after a new session AND after a load", async () => {
    const fresh = await open("agent.ts");
    expect(await asked(fresh, "modes")).toEqual([
      ["sess-1", "bypassPermissions"],
    ]);
    const mode = fresh.harness.state().options.find((one) => one.id === "mode");
    expect(mode?.value).toBe("bypassPermissions");
    await fresh.harness.stop("stopped by app");

    const resumed = await open("agent.ts", { resume: "sess-1" });
    expect(await asked(resumed, "modes")).toEqual([
      ["sess-1", "bypassPermissions"],
    ]);
  });

  test("a refusal is a row, and the conversation goes on without it", async () => {
    const running = await open("agent.ts", {
      leg: { ...leg, bypassMode: "yolo" },
    });
    expect(running.harness.state().phase).toBe("idle");
    expect(textOfKind(running, "notice").join("\n")).toContain(
      "the permission mode `yolo` was not selected",
    );
    const mode = running.harness
      .state()
      .options.find((one) => one.id === "mode");
    expect(mode?.value).toBe("default");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
  });

  test("a leg that REQUIRES the mode gets a bring-up that fails loudly", async () => {
    const states: Array<HarnessState> = [];
    const starting = startHarness<FixtureRow>({
      agent: "fixture-agent",
      leg: { ...leg, bypassMode: "yolo", bypassModeRequired: true },
      adapter: {
        command: process.execPath,
        args: [fixtureAgent("agent.ts")],
      },
      cwd: process.cwd(),
      configDir: CONFIG_DIR,
      mcpServers: [],
      teaching: TEACHING,
      taught: false,
      opens: { kind: "fresh" },
      log: silent,
      numbering: "continues",
      readCall,
      whenNewSession: "divide",
      whenLoadRefused: "fresh",
      whenReplayed: "drop",
      onChange: (change) => {
        if (change.kind === "state") states.push(change.state);
      },
    });
    await expect(starting).rejects.toMatchObject({ name: "HarnessRefused" });
    const last = states[states.length - 1];
    expect(last?.phase).toBe("offline");
    expect(last?.refusal).toContain("`yolo` was not selected");
  });
});

describe("the model a person chose", () => {
  test("is put back after the open, in the picker's own vocabulary", async () => {
    const running = await open("agent.ts", { model: "sonnet" });
    expect(running.harness.state().model).toEqual({
      id: "sonnet",
      name: "Sonnet",
      window: 200_000,
    });
    await running.harness.setOption("model", "haiku");
    await running.harness.newSession();
    expect(running.harness.state().model?.id).toBe("haiku");
  });

  test("a refused model leaves the conversation on the agent's own, and says so", async () => {
    const running = await open("agent.ts", { model: "fable" });
    expect(running.harness.state().phase).toBe("idle");
    expect(running.harness.state().model?.id).toBe("default");
    expect(textOfKind(running, "notice").join("\n")).toContain(
      "could not be put back",
    );
  });

  test("the live model the agent reports wins over the picker's own value", async () => {
    const running = await open("agent.ts");
    expect(running.harness.state().model?.id).toBe("default");
    await running.harness.prompt(typed("roster", []), false);
    await settled(running, "the turn never ended");
    expect(running.harness.state().model).toEqual({
      id: "sonnet",
      name: "Sonnet",
      window: 200_000,
    });
  });
});

describe("the MCP servers this conversation was handed", () => {
  test("start as handed with the path we handed, and move only on the agent's word", async () => {
    const running = await open("agent.ts");
    expect(running.harness.state().servers).toEqual([
      { name: "kolu", standing: "handed", said: null, where: "/bin/true" },
    ]);

    await running.harness.prompt(typed("roster", []), false);
    await settled(running, "the turn never ended");
    expect(running.harness.state().servers).toEqual([
      {
        name: "kolu",
        standing: "connected",
        said: "connected",
        where: "/bin/true",
      },
    ]);
  });
});

describe("a conversation padi already holds the rows of", () => {
  test("drops the replay and mints past what is persisted", async () => {
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
    });
    expect(running.rows()).toEqual([]);

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const rows = running.rows();
    expect(rows.map((row) => ("text" in row ? row.text : ""))).toEqual([
      "hello",
      "hello back",
    ]);
    for (const row of rows) expect(row.seq).toBeGreaterThan(12);
    expect(rows.map((row) => row.id)).toEqual(["user:13", "agent:14"]);
  });

  test("keeps the session's own news while dropping its history", async () => {
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
    });

    expect(running.rows()).toEqual([]);
    const state = running.harness.state();
    expect(state.commands).toEqual([
      { name: "compact", description: "summarise the conversation" },
      { name: "cost", description: "what this has cost" },
    ]);
    expect(state.usage).toEqual({ used: 22102, size: 200000 });
  });

  test("is not taught again when the caller says it already was", async () => {
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
      taught: true,
    });
    expect(running.harness.state().taught).toBe(true);

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies.filter((body) => body.includes(TEACHING))).toEqual([]);
  });

  test("... and a session it opens itself after that one IS taught", async () => {
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
      taught: true,
    });
    await running.harness.newSession();
    expect(running.harness.state().taught).toBe(false);

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies[0]).toBe(`${TEACHING}\n\nhello`);
  });
});

describe("a conversation the agent does not have", () => {
  test("opens a fresh one, once, with a break and a line saying why", async () => {
    const running = await open("agent.ts", {
      resume: "gone-ba0d0775-2692-4460-ad85-61bec0aeb318",
      resumedSeq: 12,
    });

    const state = running.harness.state();
    expect(state.phase).toBe("idle");
    expect(state.sessionId).toBe("sess-1");
    expect(state.refusal).toBeNull();
    expect(running.harness.alive()).toBe(true);

    expect(dividers(running).map((one) => one.kind)).toEqual(["divider"]);
    const notices = textOfKind(running, "notice");
    expect(notices).toEqual([
      expect.stringContaining("could not be resumed") as unknown as string,
    ]);
    expect(notices[0]).toContain(
      "Resource not found: gone-ba0d0775-2692-4460-ad85-61bec0aeb318",
    );
    expect(notices.join("\n")).not.toContain("the agent exited");

    expect(await asked(running, "servers")).toEqual([["kolu"]]);
    for (const row of running.rows()) expect(row.seq).toBeGreaterThan(12);
  });

  test("an AUTH refusal on the load is the other thing, and still offers the sign-in", async () => {
    const running = await open("agent.ts", {
      resume: "locked-sess-1",
      resumedSeq: 12,
    });

    const state = running.harness.state();
    expect(state.phase).toBe("offline");
    expect(state.sessionId).toBeNull();
    expect(running.harness.alive()).toBe(true);
    expect(agentWhy(state)).toContain("Authentication required");
    expect(state.signIn?.methods.map((one) => one.id)).toEqual([
      "subscription",
    ]);
    expect(dividers(running)).toEqual([]);
    expect(textOfKind(running, "notice")).toEqual([]);
  });

  test("a break minted for a fresh session that will not open comes back out", async () => {
    const running = await open("signed-out-agent.ts", { resume: "sess-1" });

    expect(dividers(running)).toEqual([]);
    expect(textOfKind(running, "notice")).toEqual([
      expect.stringContaining("could not be resumed") as unknown as string,
    ]);
    const state = running.harness.state();
    expect(state.phase).toBe("offline");
    expect(running.harness.alive()).toBe(true);
    expect(agentWhy(state)).toContain("Authentication required");

    expect(await running.harness.signIn("subscription")).toBe("signed-in");
    expect(running.harness.state().sessionId).toBeNull();
    expect(running.harness.state().phase).toBe("offline");
    expect(running.harness.state().signIn).toBeNull();
    expect(dividers(running)).toEqual([]);
  });
});

describe("an agent nobody is signed in to", () => {
  test("keeps the child, says why, and takes the signature without opening anything", async () => {
    const running = await open("signed-out-agent.ts");
    const offline = running.harness.state();
    expect(offline.phase).toBe("offline");
    expect(offline.sessionId).toBeNull();
    expect(running.harness.alive()).toBe(true);
    expect(agentWhy(offline)).toContain("Authentication required");
    expect(offline.signIn?.attempt).toBeNull();
    expect(offline.signIn?.methods.map((one) => one.id)).toEqual([
      "subscription",
    ]);
    expect(offline.refusal).toContain("Authentication required");

    expect(await running.harness.signIn("subscription")).toBe("signed-in");

    const after = running.harness.state();
    expect(after.phase).toBe("offline");
    expect(after.sessionId).toBeNull();
    expect(after.signIn).toBeNull();
  });

  test("a sign-in nobody offers is refused, and the harness stays up", async () => {
    const running = await open("signed-out-agent.ts");
    await expect(running.harness.signIn("api-key")).rejects.toBeInstanceOf(
      HarnessRefused,
    );
    expect(running.harness.alive()).toBe(true);
  });

  test("offers the sign-in on the agent's own word, conversation and all", async () => {
    const running = await open("signed-out-open-agent.ts");
    await waitFor(running, (one) => one.signIn !== null, "nothing was offered");
    const state = running.harness.state();
    expect(state.sessionId).toBe("sess-1");
    expect(state.identity?.kind).toBe("none");
    expect(state.signIn?.methods.map((one) => one.id)).toEqual([
      "console-login",
    ]);
    expect(agentWhy(state)).toContain("Not logged in");
    expect(agentWhy(state)).toContain(CONFIG_DIR);
  });

  test("runs the method, takes the code back, and leaves the conversation alone", async () => {
    const running = await open("signed-out-open-agent.ts");
    await waitFor(running, (one) => one.signIn !== null, "nothing was offered");
    const signing = running.harness.signIn("console-login");
    await waitFor(
      running,
      (one) => oauthUrlIn(one.signIn?.attempt?.output ?? "") !== null,
      "the sign-in printed no URL",
    );
    const printed = oauthUrlIn(running.harness.state().signIn?.attempt?.output);
    expect(printed?.origin).toBe("https://example.invalid");
    expect(printed?.pathname).toBe("/oauth");
    await running.harness.signInInput("ABCD-1234");
    expect(await signing).toBe("signed-in");
    const after = running.harness.state();
    expect(after.sessionId).toBe("sess-1");
    expect(after.signIn).toBeNull();
  });

  test("signs in over a conversation the agent no longer has, and opens nothing", async () => {
    const running = await open("signed-out-open-agent.ts", {
      resume: "ba0d0775-2692-4460-ad85-61bec0aeb318",
    });
    expect(running.harness.state().sessionId).toBe("sess-1");
    expect(dividers(running).length).toBe(1);
    expect(textOfKind(running, "notice")).toEqual([
      expect.stringContaining("Resource not found") as unknown as string,
    ]);

    await waitFor(running, (one) => one.signIn !== null, "nothing was offered");
    const signing = running.harness.signIn("console-login");
    await waitFor(
      running,
      (one) => oauthUrlIn(one.signIn?.attempt?.output ?? "") !== null,
      "the sign-in printed no URL",
    );
    await running.harness.signInInput("ABCD-1234");
    expect(await signing).toBe("signed-in");

    const after = running.harness.state();
    expect(after.phase).toBe("idle");
    expect(after.sessionId).toBe("sess-1");
    expect(after.signIn).toBeNull();
    expect(after.refusal).toBeNull();
    expect(dividers(running).length).toBe(1);
    expect(textOfKind(running, "notice").length).toBe(1);
  });

  test("offers it on a refused TURN, for an agent that never said who it is", async () => {
    const running = await open("signed-out-open-agent.ts", {
      args: ["--no-status"],
    });
    expect(running.harness.state().signIn).toBeNull();
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const state = running.harness.state();
    expect(agentWhy(state)).toContain("Authentication required");
    expect(state.signIn?.methods.map((one) => one.id)).toEqual([
      "console-login",
    ]);
  });

  test("says what was asked and what came back when nothing is offered", async () => {
    const running = await open("signed-out-open-agent.ts", {
      args: ["--no-methods"],
    });
    await waitFor(
      running,
      (one) => one.signIn !== null,
      "the dead end said nothing",
    );
    const state = running.harness.state();
    expect(state.signIn?.methods).toEqual([]);
    expect(agentWhy(state)).toContain("fixture-agent 0.0.1");
    expect(agentWhy(state)).toContain("offered no way to sign in");
    expect(agentWhy(state)).toContain('_meta["terminal-auth"]');
    expect(agentWhy(state)).toContain(CONFIG_DIR);
  });
});

describe("a person asking to sign in", () => {
  test("opens the row while signed in, with the advertised methods, and closes again untouched", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    const before = running.harness.state();
    expect(before.signIn).toBeNull();

    running.harness.askSignIn();
    const asked = running.harness.state().signIn;
    expect(asked?.cause).toEqual({
      kind: "person",
      said: expect.stringContaining(CONFIG_DIR) as unknown as string,
    });
    expect(asked?.methods.map((one) => one.id)).toEqual(["subscription"]);
    expect(asked?.attempt).toBeNull();

    expect(await running.harness.signInCancel()).toBe(true);
    const after = running.harness.state();
    expect(after.signIn).toBeNull();
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.phase).toBe("idle");
  });

  test("a row a person asked for comes down when the conversation is entered again", async () => {
    const running = await open("agent.ts");
    running.harness.askSignIn();
    expect(running.harness.state().signIn).not.toBeNull();
    await running.harness.newSession();
    expect(running.harness.state().signIn).toBeNull();
  });

  test("entering a conversation while a sign-in runs keeps the attempt's row drawn", async () => {
    const running = await open("agent.ts", { args: ["--patient-login"] });
    running.harness.askSignIn();
    const signing = running.harness.signIn("subscription");
    await waitFor(
      running,
      (state) =>
        state.signIn?.attempt?.output.includes("type the code") ?? false,
      "the sign-in never asked for its code",
    );
    await running.harness.newSession();
    expect(running.harness.state().signIn?.attempt?.state).toBe("running");
    await running.harness.signInInput("1234");
    expect(await signing).toBe("signed-in");
    expect(running.harness.state().signIn).toBeNull();
  });

  test("runs a method a person asked for, and the conversation is the same one after", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    running.harness.askSignIn();
    expect(await running.harness.signIn("subscription")).toBe("signed-in");
    const state = running.harness.state();
    expect(state.signIn).toBeNull();
    expect(state.phase).toBe("idle");
    expect(state.sessionId).not.toBeNull();
  });

  test("leaves the person in the conversation they are in, not the one they booted in", async () => {
    const running = await open("agent.ts", { resume: "sess-booted" });
    expect(running.harness.state().sessionId).toBe("sess-booted");
    await running.harness.newSession();
    const moved = running.harness.state().sessionId;
    expect(moved).not.toBe("sess-booted");

    running.harness.askSignIn();
    expect(await running.harness.signIn("subscription")).toBe("signed-in");
    expect(running.harness.state().sessionId).toBe(moved);
  });

  test("a Cancel that lost the race to a login that landed answers `signed-in`", async () => {
    const running = await open("signed-out-open-agent.ts", {
      args: ["--login-outlives-cancel"],
    });
    await waitFor(running, (one) => one.signIn !== null, "nothing was offered");
    const signing = running.harness.signIn("console-login");
    await waitFor(
      running,
      (one) => oauthUrlIn(one.signIn?.attempt?.output ?? "") !== null,
      "the sign-in printed no URL",
    );

    expect(await running.harness.signInCancel()).toBe(true);
    expect(await signing).toBe("signed-in");
    expect(running.harness.state().signIn).toBeNull();
  });

  test("an agent that advertised nothing says so, rather than drawing a button", async () => {
    const running = await open("text-only-agent.ts");
    running.harness.askSignIn();
    const asked = running.harness.state().signIn;
    expect(asked?.methods).toEqual([]);
    expect(asked?.cause).toEqual({
      kind: "person",
      said: expect.stringContaining(
        "offered no way to sign in",
      ) as unknown as string,
    });
  });

  test("a turn refused for the ACCOUNT marks the row so, off the agent's data", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt(typed("limit", []), false);
    await settled(running, "the refused turn never ended");
    const row = running.rows().find((one) => one.id === rowId);
    expect(row?.kind === "user" ? row.delivery : null).toBe("refused");
    expect(row?.kind === "user" ? row.signIn : null).toBe("account");
    expect(running.harness.state().signIn).toBeNull();
  });
});

describe("a bring-up nothing can be done about", () => {
  test("publishes the refusal before it throws, and takes the child with it", async () => {
    const states: Array<HarnessState> = [];
    const starting = startHarness<FixtureRow>({
      agent: "fixture-agent",
      leg,
      adapter: {
        command: fixtureAgent("no-such-adapter"),
        args: [],
      },
      cwd: process.cwd(),
      configDir: CONFIG_DIR,
      mcpServers: [],
      teaching: TEACHING,
      taught: false,
      opens: { kind: "fresh" },
      log: silent,
      numbering: "continues",
      readCall,
      whenNewSession: "divide",
      whenLoadRefused: "fresh",
      whenReplayed: "drop",
      onChange: (change) => {
        if (change.kind === "state") states.push(change.state);
      },
    });
    await expect(starting).rejects.toMatchObject({
      name: "HarnessUnavailable",
    });
    const last = states[states.length - 1];
    expect(last?.phase).toBe("offline");
    expect(last?.refusal).toContain("could not start the agent");
  });

  test("a handshake the agent refuses stops the process it started", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "acp-harness-initialize-"));
    const pidFile = path.join(dir, "pid");
    try {
      await expect(
        startHarness<FixtureRow>({
          agent: "fixture-agent",
          leg,
          adapter: {
            command: process.execPath,
            args: [fixtureAgent("refused-initialize-agent.ts"), pidFile],
          },
          cwd: process.cwd(),
          configDir: CONFIG_DIR,
          mcpServers: [],
          teaching: TEACHING,
          taught: false,
          opens: { kind: "fresh" },
          log: silent,
          numbering: "continues",
          readCall,
          whenNewSession: "divide",
          whenLoadRefused: "fresh",
          whenReplayed: "drop",
          onChange: () => {},
        }),
      ).rejects.toMatchObject({ name: "HarnessRefused" });
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the settings a conversation advertises", () => {
  test("offers every one of them, with the model FIRST and marked", async () => {
    const running = await open("agent.ts");
    const options = running.harness.state().options;
    expect(options.map((one) => [one.id, one.kind])).toEqual([
      ["model", "model"],
      ["mode", "choice"],
      ["effort", "choice"],
      ["fast", "boolean"],
    ]);
    expect(running.harness.state().model).toEqual({
      id: "default",
      name: "Default",
      window: 200_000,
    });
    expect(options[0]?.choices.map((one) => one.value)).toEqual([
      "default",
      "sonnet",
      "haiku",
    ]);
    expect(options.find((one) => one.id === "fast")).toMatchObject({
      value: "false",
      choices: [],
    });
    expect(options.find((one) => one.id === "effort")?.choices).toHaveLength(4);
  });

  test("a grouped picker offers its leaves and not its headings", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("groups", []), false);
    await settled(running, "the turn never ended");
    const model = running.harness
      .state()
      .options.find((one) => one.id === "model");
    expect(model?.kind).toBe("model");
    expect(model?.choices.map((one) => one.value)).toEqual([
      "sonnet",
      "haiku",
      "default",
    ]);
    expect(running.harness.state().model?.id).toBe("sonnet");
  });

  test("the picker the real adapter sent keeps every row, the new model included", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("recorded", []), false);
    await settled(running, "the turn never ended");
    const model = running.harness
      .state()
      .options.find((one) => one.id === "model");
    expect(model?.kind).toBe("model");
    expect(model?.choices).toHaveLength(14);
    expect(
      model?.choices.find((one) => one.value === "claude-fable-5-2"),
    ).toEqual({
      value: "claude-fable-5-2",
      label: "Fable 5.2",
      hint: "For your toughest challenges",
    });
    expect(running.harness.state().model).toEqual({
      id: "claude-fable-5-2",
      name: "Fable 5.2",
      window: 200_000,
    });
    expect(running.harness.state().options.map((one) => one.id)).toEqual([
      "model",
      "mode",
      "effort",
      "fast",
    ]);
  });

  test("a switch goes out as a boolean, not as the word for one", async () => {
    const running = await open("agent.ts");
    await running.harness.setOption("fast", "true");
    expect(
      running.harness.state().options.find((one) => one.id === "fast")?.value,
    ).toBe("true");
    await expect(
      running.harness.setOption("fast", "maybe"),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("takes `true` or `false`"),
    });
  });
});

describe("what a prompt can carry besides words", () => {
  test("an image arrives as an `image` block with its bytes intact", async () => {
    const running = await open("agent.ts");
    const shot = await picture();
    await running.harness.prompt(typed("look at this", [shot]), false);
    await settled(running, "the turn never ended");

    const [sent] = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(sent?.[0]).toMatchObject({ type: "text" });
    expect(sent?.[1]).toEqual({
      type: "image",
      data: PNG,
      mimeType: "image/png",
    });

    const row = running.rows().find((one) => one.kind === "user");
    expect(row?.kind === "user" ? row.attachments : null).toEqual([shot]);
  });

  test("a restored row's path is all the harness needs", async () => {
    const running = await open("agent.ts", { resume: "sess-1", resumedSeq: 9 });
    const restored = await written(
      {
        id: "att-old",
        name: "yesterday.png",
        mimeType: "image/png",
        bytes: 68,
      },
      Buffer.from(PNG, "base64"),
    );
    await running.harness.prompt(typed("again", [restored]), false);
    await settled(running, "the turn never ended");
    const [sent] = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(sent?.[1]).toMatchObject({ type: "image", data: PNG });
  });

  test("a file that is gone is a refusal naming it, not a crash", async () => {
    const running = await open("agent.ts");
    const shot = await picture();
    await rm(shot.path);
    await expect(
      running.harness.prompt(typed("look at this", [shot]), false),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("shot.png"),
    });
    expect(running.rows()).toEqual([]);
  });

  test("a text file arrives as a `resource` with its text embedded", async () => {
    const running = await open("agent.ts");
    const notes = await written(
      {
        id: "att-2",
        name: "notes.txt",
        mimeType: "text/plain;charset=utf-8",
        bytes: 11,
      },
      Buffer.from("hello there"),
    );
    await running.harness.prompt(typed("read this", [notes]), false);
    await settled(running, "the turn never ended");
    const [sent] = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(sent?.[1]).toEqual({
      type: "resource",
      resource: {
        uri: `file://${notes.path}`,
        mimeType: "text/plain",
        text: "hello there",
      },
    });
  });

  test("anything else arrives as a `resource_link` naming the path padi wrote", async () => {
    const running = await open("agent.ts");
    const report = await written(
      {
        id: "att-3",
        name: "report.pdf",
        mimeType: "application/pdf",
        bytes: 2048,
      },
      Buffer.alloc(2048),
    );
    await running.harness.prompt(typed("and this", [report]), false);
    await settled(running, "the turn never ended");
    const [sent] = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    expect(sent?.[1]).toEqual({
      type: "resource_link",
      uri: `file://${report.path}`,
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 2048,
    });
  });

  test("an image an agent never advertised for is refused with a sentence", async () => {
    // ACP makes the image block opt-in at the AGENT's end. Sending one anyway
    // is a turn that fails somewhere inside the agent with a sentence nobody
    // wrote for a person; the refusal names the capability instead.
    const running = await open("text-only-agent.ts");
    await expect(
      running.harness.prompt(typed("look at this", [await picture()]), false),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("`image`"),
    });
    expect(running.rows()).toEqual([]);
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["text is all I take"]);
  });

  test("too much is refused with a sentence naming the limit", async () => {
    const running = await open("agent.ts");
    await expect(
      running.harness.prompt(
        typed("huge", [await picture({ bytes: 11 * 1024 * 1024 })]),
        false,
      ),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("10 MiB"),
    });
    await expect(
      running.harness.prompt(
        typed("huge", [
          await picture({ id: "a", bytes: 9 * 1024 * 1024 }),
          await picture({ id: "b", bytes: 9 * 1024 * 1024 }),
          await picture({ id: "c", bytes: 9 * 1024 * 1024 }),
        ]),
        false,
      ),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("20 MiB"),
    });
    expect(running.rows()).toEqual([]);
  });
});

describe("the break that says the agent's memory was reset", () => {
  test("a death and the harness that replaces it mint none", async () => {
    const first = await open("agent.ts");
    await first.harness.prompt(typed("hello", []), false);
    await settled(first, "the first turn never ended");
    await first.harness.prompt(typed("die", []), false);
    await dead(first);
    expect(first.rows().filter((one) => one.kind === "divider")).toEqual([]);

    const second = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
    });
    await second.harness.prompt(typed("hello", []), false);
    await settled(second, "the turn never ended");
    expect(second.rows().filter((one) => one.kind === "divider")).toEqual([]);
  });

  test("`newSession` mints exactly one, however many times it is asked", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.newSession();
    await running.harness.newSession();
    await running.harness.newSession();
    await running.harness.newSession();
    expect(dividers(running)).toHaveLength(1);

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the second turn never ended");
    await running.harness.newSession();
    expect(dividers(running)).toHaveLength(2);
  });

  test("the conversation being left is closed at the agent, not just dropped", async () => {
    const running = await open("subprocess-agent.ts");

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the second turn never ended");
    expect(await asked(running, "children")).toEqual({ live: 1, closed: [] });

    await running.harness.newSession();
    expect(await asked(running, "children")).toEqual({
      live: 1,
      closed: ["sess-1"],
    });
  });

  test("a break for a conversation that would not open comes back out", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the first turn never ended");
    await running.harness.prompt(typed("die", []), false);
    await dead(running);
    await expect(running.harness.newSession()).rejects.toMatchObject({
      name: "HarnessUnavailable",
    });
    expect(dividers(running)).toEqual([]);
  });

  test("a respawned harness knows padi's last row was one", async () => {
    const running = await open("agent.ts", {
      resume: "sess-1",
      resumedSeq: 12,
      resumedEndsWithDivider: true,
    });
    await running.harness.newSession();
    expect(dividers(running)).toEqual([]);

    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    await running.harness.newSession();
    expect(dividers(running)).toHaveLength(1);
  });
});

describe("the wipe that deletes the conversation (`clearSession`)", () => {
  test("forgets the calls, so the next conversation's draw their cards", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("kolu", []), false);
    await settled(running, "the first turn never ended");
    expect(running.rows().filter((one) => one.kind === "tool")).toHaveLength(1);
    const left = running.harness.state().sessionId;

    await running.harness.clearSession(["user:restored"]);
    expect(running.rows()).toEqual([]);
    expect(running.harness.state().sessionId).not.toBe(left);

    await running.harness.prompt(typed("kolu", []), false);
    await settled(running, "the second turn never ended");
    expect(running.rows().filter((one) => one.kind === "tool")).toHaveLength(1);
  });

  test("leaves nothing for a break to divide", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    await running.harness.clearSession([]);
    expect(dividers(running)).toEqual([]);
    await running.harness.newSession();
    expect(dividers(running)).toEqual([]);
  });

  test("a conversation that would not open keeps the rows", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("hello", []), false);
    await settled(running, "the turn never ended");
    await running.harness.prompt(typed("die", []), false);
    await dead(running);
    await expect(running.harness.clearSession([])).rejects.toMatchObject({
      name: "HarnessUnavailable",
    });
    expect(running.rows().length).toBeGreaterThan(0);
  });
});

const flag = (value: unknown, ...keys: ReadonlyArray<string>): unknown =>
  keys.reduce<unknown>((held, key) => meta(held)?.[key], value);

const steersLeg: Leg = {
  ...leg,
  steering: {
    method: "_session/steering",
    meta: { steering: { idleBehavior: "promptRequired" } },
    timeout: "5 seconds",
    taken: (answered) => flag(answered, "outcome") === "injected",
    advertised: (initialized) =>
      flag(initialized, "_meta", "steering", "supported") === true,
  },
  queues: (initialized) =>
    flag(
      initialized,
      "agentCapabilities",
      "_meta",
      "claudeCode",
      "promptQueueing",
    ) === true,
};

const steeredInto = async (running: Running): Promise<ReadonlyArray<string>> =>
  (await asked(running, "steered")) as ReadonlyArray<string>;

const rowOf = (running: Running, id: string): FixtureRow => {
  const found = running.rows().find((row) => row.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
};

describe("putting a message INTO the turn that is running", () => {
  test("a steer while a turn runs reaches that turn, and starts none of its own", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    expect(running.harness.state().steers).toBe(true);
    await running.harness.prompt(typed("slow", []), false);
    const steer = await running.harness.prompt(
      typed("actually, the other branch", []),
      true,
    );

    const row = rowOf(running, steer.rowId);
    expect(row.kind).toBe("user");
    expect(row.kind === "user" ? row.queued : "n/a").toBeUndefined();
    expect(row.kind === "user" ? row.delivery : "n/a").toBeUndefined();
    expect(running.harness.state().steers).toBe(true);

    expect(await steeredInto(running)).toEqual(["actually, the other branch"]);
  });

  test("a steer that carries FILES goes as a plain prompt, files and all", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    const shot = await picture();
    await running.harness.prompt(typed("slow", []), false);
    const sent = await running.harness.prompt(
      typed("look at this", [shot]),
      true,
    );
    await settled(running, "the turn carrying the picture never ended");

    expect(await steeredInto(running)).toEqual([]);
    const blocks = (await asked(running, "blocks")) as ReadonlyArray<
      ReadonlyArray<Record<string, unknown>>
    >;
    const carried = blocks.find((one) =>
      one.some((block) => block.type === "image"),
    );
    expect(carried?.[0]).toMatchObject({ type: "text" });
    expect(carried?.[1]).toEqual({
      type: "image",
      data: PNG,
      mimeType: "image/png",
    });
    const row = rowOf(running, sent.rowId);
    expect(row.kind === "user" ? row.attachments : null).toEqual([shot]);
  });

  test("a steer with NOTHING RUNNING is an ordinary prompt", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    const sent = await running.harness.prompt(typed("hello", []), true);
    await settled(running, "the steered-while-idle turn never ended");

    const row = rowOf(running, sent.rowId);
    expect(row.kind === "user" ? row.queued : "n/a").toBeUndefined();
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
    expect(await steeredInto(running)).toEqual([]);
  });

  test("a steer into a turn SOMEBODY STOPPED keeps the words, and sends nothing", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    await running.harness.prompt(typed("slow", []), false);
    const stopping = running.harness.cancel();
    const steer = await running.harness.prompt(
      typed("while you are there, check the lock file", []),
      true,
    );
    await stopping;
    await settled(running, "the cancelled turn never ended");

    const row = rowOf(running, steer.rowId);
    expect(row.kind === "user" ? row.delivery : "n/a").toBe("refused");
    expect(textOfKind(running, "notice")).toContain(
      "the turn these words were steered into was cancelled, so they were not sent",
    );
    expect(await steeredInto(running)).toEqual([]);
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(
      bodies.filter((body) => body.includes("check the lock file")),
    ).toEqual([]);
  });

  test("one message sent while busy spends the steer for the rest of the session", async () => {
    const running = await open("agent.ts", { leg: steersLeg });
    await running.harness.prompt(typed("slow", []), false);
    await running.harness.prompt(typed("hello", []), false);
    expect(running.harness.state().steers).toBe(false);
    await settled(running, "the queued turn never ended");
    expect(running.harness.state().steers).toBe(false);

    await running.harness.prompt(typed("slow", []), false);
    const asking = await running.harness.prompt(
      typed("and another thing", []),
      true,
    );
    const queued = rowOf(running, asking.rowId);
    expect(queued.kind === "user" ? queued.queued : "n/a").toBe(true);
    await settled(running, "the second queued turn never ended");
    expect(await steeredInto(running)).toEqual([]);

    await running.harness.newSession();
    expect(running.harness.state().steers).toBe(true);
  });

  test("an agent that advertises nothing offers no steer at all", async () => {
    const running = await open("agent.ts");
    expect(running.harness.state().steers).toBe(false);
  });
});

describe("the clock a reader counts “working · 2m” from", () => {
  test("starts with the FIRST turn in flight and stops with the last", async () => {
    const running = await open("agent.ts");
    expect(running.harness.state().busySince).toBe(null);

    await running.harness.prompt(typed("slow", []), false);
    const started = running.harness.state().busySince;
    expect(started).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await running.harness.prompt(typed("hello", []), false);
    expect(running.harness.state().busySince).toBe(started);

    await settled(running, "the turns never ended");
    expect(running.harness.state().busySince).toBe(null);
  });
});

const rung = (
  text: string,
  rang: ReadonlyArray<string> = ["local/one"],
): RowContent<FixtureRow> => ({ kind: "rung", text, rang });

describe("a turn this end started — nobody typed it", () => {
  test("mints the caller's own row and sends the words under it", async () => {
    const running = await open("agent.ts");
    const rang = ["local/one", "local/two"];
    const { rowId } = await running.harness.hostTurn(
      rung("two terminals need you", rang),
      "two terminals need you",
    );
    await settled(running, "the host turn never ended");

    const row = rowOf(running, rowId);
    expect(row.kind).toBe("rung");
    if (row.kind !== "rung") throw new Error("the host row went missing");
    expect(row.text).toBe("two terminals need you");
    expect(row.rang).toEqual(rang);
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
    const bodies = (await asked(running, "prompts")) as ReadonlyArray<string>;
    expect(bodies[0]).toBe(`${TEACHING}\n\ntwo terminals need you`);
  });

  test("refused for want of a signature, it takes the mark and not the door", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.hostTurn(rung("locked"), "locked");
    await settled(running, "the refused host turn never ended");

    const row = rowOf(running, rowId);
    if (row.kind !== "rung") throw new Error("the host row went missing");
    expect(row.delivery).toBe("refused");
    expect(row).not.toHaveProperty("signIn");
  });

  test("waits behind a running turn with the mark a person's message takes", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt(typed("slow", []), false);
    const { rowId } = await running.harness.hostTurn(
      rung("a terminal stopped"),
      "a terminal stopped",
    );
    const waiting = rowOf(running, rowId);
    expect(waiting.kind === "rung" ? waiting.queued : "n/a").toBe(true);

    await settled(running, "the queued host turn never ended");
    const taken = rowOf(running, rowId);
    expect(taken.kind === "rung" ? taken.queued : "n/a").toBeUndefined();
  });

  test("ends under a cancel the way a person's turn does", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.hostTurn(rung("slow"), "slow");
    expect(running.harness.state().busySince).not.toBe(null);

    await running.harness.cancel();
    await settled(running, "the cancelled host turn never ended");
    expect(textOfKind(running, "notice")).toContain("the turn was cancelled");
    expect(running.harness.state().busySince).toBe(null);
    const row = rowOf(running, rowId);
    expect(row.kind === "rung" ? row.queued : "n/a").toBeUndefined();
  });
});
