/**
 * THE THREE ARMS KOLU DOES NOT TAKE, run against a real agent.
 *
 * Every product fact this package used to know is now a policy with two arms
 * ({@link ./conversation.ts}'s `whenNewSession`, `whenLoadRefused`,
 * `whenReplayed`), and kolu's Conductor takes one of each — so `harness.test.
 * ts` exercises three of the six and would leave the other three to be
 * discovered by the next product to pick them up. olai's chat panel is that
 * product, and these are its three: a new session CLEARS the panel, a
 * conversation the agent cannot come back to is REPORTED rather than quietly
 * replaced, and a replay is KEPT because the panel has no other record of it.
 *
 * The rows below are olai's, declared here from the shared field objects in
 * `@kolu/acp/wire` plus olai's own fields — the same exercise
 * `transcript.olai.test.ts` does for the class underneath, and for the same
 * reason: the code under test must be able to name neither product.
 */

import {
  agentRowFields,
  askRowFields,
  noticeRowFields,
  rowHead,
  toolRowFields,
  userRowFields,
} from "@kolu/acp/wire";
import { allowingOurs, type Leg, namedExactly } from "@kolu/acp/engine";
import { fixtureAgent } from "@kolu/acp-client/testlib";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import {
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  type Opening,
  type PersonSaid,
  type Probe,
  startHarness,
  type TurnEnded,
} from "./harness.ts";

/** OLAI'S ROWS — the shared fields, plus the ones only olai sets. Decoded
 *  under `onExcessProperty: "error"` on every read, which is what catches the
 *  conversation writing a field olai's row does not declare. */
const OlaiRowSchema = Schema.Union([
  Schema.Struct({
    ...userRowFields,
    /** Nobody is signed in, so the words were not taken. */
    signIn: Schema.optionalKey(Schema.Literals(["signed-out", "account"])),
    attachments: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({ ...agentRowFields }),
  Schema.Struct({
    ...toolRowFields,
    /** What the agent called it, and the engine's own raw spelling of the same
     *  call — which is taken only UNTIL the row is named, because the friendly
     *  title arrives a frame later and must not drag the spelling with it. */
    called: Schema.optionalKey(Schema.String),
    spelled: Schema.optionalKey(Schema.String),
    /** Whose row it is, for the plugin face that draws it. */
    owner: Schema.optionalKey(Schema.String),
    /** ... and the panes it is running in. */
    terminals: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          output: Schema.String,
          truncated: Schema.Boolean,
          exitCode: Schema.NullOr(Schema.Number),
          signal: Schema.NullOr(Schema.String),
          running: Schema.Boolean,
        }),
      ),
    ),
  }),
  Schema.Struct({ ...askRowFields }),
  Schema.Struct({ ...noticeRowFields }),
  /** olai's own row kind, and the one it adds: a write the panel refused. */
  Schema.Struct({
    ...rowHead,
    kind: Schema.Literal("refusal"),
    text: Schema.String,
  }),
]);
type OlaiRow = typeof OlaiRowSchema.Type;

const published = (row: unknown): OlaiRow =>
  Schema.decodeUnknownSync(OlaiRowSchema, { onExcessProperty: "error" })(row);

const spelling = (server: string): string => `mcp__${server}__`;

const meta = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

/** A leg that reads the fixture's wire the way olai's engines do: EVERY MCP
 *  call a frame named (an engine that dispatches them through one builtin
 *  names several), and the agent's own claim about holding a message sent
 *  mid-turn. */
const leg: Leg = {
  spelling,
  mcpCall: (frame, servers) =>
    (frame.name ?? frame.title ?? "").split(" + ").flatMap((word) => {
      for (const server of servers) {
        const prefix = spelling(server);
        if (word.startsWith(prefix) && word.length > prefix.length) {
          return [{ server, tool: word.slice(prefix.length) }];
        }
      }
      return [];
    }),
  replyIn: () => undefined,
  accountRefusal: () => false,
  toolNameIn: (value) => {
    const name = meta(value)?.name;
    return typeof name === "string" ? name : null;
  },
  toolNameOf: () => null,
  asksThroughForm: () => false,
  allowedWithoutAsking: allowingOurs(spelling),
  parentToolUse: (value) => {
    const parent = meta(value)?.parent;
    return typeof parent === "string" ? parent : null;
  },
  spawned: () => null,
  backgroundTask: () => null,
  taskNotification: () => null,
  listedIn: () => null,
  prologueIn: () => null,
  bypassMode: null,
  steering: null,
  // WHAT THIS AGENT SAID ABOUT HOLDING A BUSY MESSAGE, out of its own corner
  // of the handshake — the fact `state.queues` publishes.
  queues: (initialized) =>
    meta(meta(meta(initialized)?.agentCapabilities)?._meta)?.claudeCode !==
    undefined,
  terminalOutput: true,
  rawMessages: null,
  models: { config: "model", nameIn: namedExactly },
};

const silent = { info: () => {}, warn: () => {}, error: () => {} };

const TEACHING = "# [fixture] you are the fixture's conversation";

const started: Array<Harness<OlaiRow>> = [];

afterEach(async () => {
  const live = started.splice(0, started.length);
  await Promise.all(live.map((harness) => harness.stop("stopped by app")));
});

/** What olai hands over for a person's message: the words, and nothing above
 *  them on the wire. */
const typed = (text: string): PersonSaid<OlaiRow> => ({
  text,
  body: text,
  extra: {},
  files: [],
});

/**
 * WHAT OLAI READS A CALL AS — the name its cards draw, the row that owns it,
 * the reply that row's own face renders, and the panes it is running in.
 *
 * EVERY recognised call of the frame, because an engine that dispatches its
 * MCP tools through one builtin names several in one frame and a card is
 * composed from all of them. A frame that says nothing olai draws answers
 * `undefined`, which leaves the row exactly as it was.
 */
const readCall: HarnessOptions<OlaiRow>["readCall"] = (frame) => {
  const called =
    frame.mcp.length === 0
      ? frame.called
      : frame.mcp.map((one) => one.tool).join(" + ");
  const extra = {
    ...(called === undefined ? {} : { called }),
    ...(frame.row === undefined ? {} : { owner: frame.row }),
    ...(frame.terminals === undefined ? {} : { terminals: frame.terminals }),
  };
  // ... AND THE ENGINE'S OWN SPELLING, which is worth drawing until the row
  // has a name and must not come back with the friendly title that replaces
  // it.
  const untilNamed = called === undefined ? {} : { spelled: `raw:${called}` };
  if (Object.keys(extra).length === 0 && Object.keys(untilNamed).length === 0) {
    return undefined;
  }
  return { extra, untilNamed };
};

interface Running {
  readonly harness: Harness<OlaiRow>;
  readonly rows: () => ReadonlyArray<OlaiRow>;
  /** Every turn ending this conversation reported, in order — the typed
   *  reading olai draws its own notices from. */
  readonly turns: ReadonlyArray<TurnEnded>;
}

const open = async (
  extra: {
    opens?: Opening;
    probes?: () => Effect.Effect<ReadonlyArray<Probe>>;
    args?: ReadonlyArray<string>;
    mcpServers?: HarnessOptions<OlaiRow>["mcpServers"];
    log?: HarnessOptions<OlaiRow>["log"];
    agent?: string;
    teaching?: string;
    models?: HarnessOptions<OlaiRow>["models"];
    abandonWhen?: HarnessOptions<OlaiRow>["abandonWhen"];
  } = {},
): Promise<Running> => {
  const rows = new Map<string, OlaiRow>();
  const turns: Array<TurnEnded> = [];
  const fold = (change: HarnessChange<OlaiRow>): void => {
    if (change.kind === "state") return;
    if (change.kind === "turn") {
      turns.push(change);
      return;
    }
    for (const row of change.upserts) {
      const read = published(row);
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
  const harness = await startHarness<OlaiRow>({
    leg,
    adapter: {
      command: process.execPath,
      args: [fixtureAgent(extra.agent ?? "agent.ts"), ...(extra.args ?? [])],
    },
    cwd: process.cwd(),
    configDir: "/tmp/olai-test-home/.claude",
    mcpServers: extra.mcpServers ?? [],
    ...(extra.probes === undefined ? {} : { probes: extra.probes }),
    teaching: extra.teaching ?? TEACHING,
    ...(extra.models === undefined ? {} : { models: extra.models }),
    ...(extra.abandonWhen === undefined
      ? {}
      : { abandonWhen: extra.abandonWhen }),
    taught: false,
    log: extra.log ?? silent,
    opens: extra.opens ?? { kind: "fresh" },
    readCall,
    // OLAI'S THREE, and the whole point of this file.
    whenNewSession: "clear",
    whenLoadRefused: "report",
    whenReplayed: "keep",
    // ... and olai's numbering: a wipe starts again, and the first row of a
    // conversation is zero, because its browser reads a `seq` as the count of
    // the rows older than it.
    numbering: "restarts",
    onChange: fold,
  });
  started.push(harness);
  return {
    harness,
    rows: () => [...rows.values()].sort((a, b) => a.seq - b.seq),
    turns,
  };
};

const settled = async (running: Running, why: string): Promise<void> => {
  const until = Date.now() + 4_000;
  while (Date.now() < until) {
    const phase = running.harness.state().phase;
    if (phase === "idle" || phase === "asking") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${why}: still ${running.harness.state().phase}`);
};

describe("a new session that CLEARS the panel", () => {
  test("takes the rows with it and mints no break", async () => {
    const running = await open();
    await running.harness.prompt(typed("hello"), false);
    await settled(running, "the turn never ended");
    expect(running.rows().length).toBeGreaterThan(0);

    await running.harness.newSession();
    // NOTHING IS LEFT, and nothing is drawn across the nothing: a panel that
    // holds its conversation in memory alone has no history for a break to
    // divide, and `divider` is a row kind olai never declared — writing one
    // would be a field the decode above refuses.
    expect(running.rows()).toEqual([]);

    // ... and the conversation is live: the next message lands in the new one.
    await running.harness.prompt(typed("hello"), false);
    await settled(running, "the second turn never ended");
    expect(running.rows().some((row) => row.kind === "agent")).toBe(true);
  });
});

describe("a conversation the agent cannot come back to, REPORTED", () => {
  test("refuses the bring-up instead of opening a different one", async () => {
    // The id is one this CLI has never heard of (`-32002`). kolu opens a fresh
    // conversation and says so; a panel whose only copy of the chat is on
    // screen must not be handed a different conversation under the same name.
    await expect(
      open({
        opens: {
          kind: "resume",
          id: "gone-ba0d0775-2692-4460-ad85-61bec0aeb318",
        },
      }),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("Resource not found"),
    });
  });
});

describe("a replay that is KEPT", () => {
  test("puts the conversation the agent remembers back on screen", async () => {
    const running = await open({ opens: { kind: "resume", id: "sess-1" } });
    // BOTH SIDES OF THE REPLAY, in the order the agent re-emitted them: the
    // panel has no record of its own, so the frames kolu drops are the only
    // copy of the conversation there is.
    expect(
      running.rows().map((row) => [row.kind, "text" in row ? row.text : ""]),
    ).toEqual([
      ["user", "what did I ask you before?"],
      ["agent", "the answer you already have"],
    ]);
    // ... and what the same stream said about the session AS IT STANDS is kept
    // either way.
    expect(running.harness.state().usage).toEqual({
      used: 22102,
      size: 200000,
    });
  });
});

describe("what the handshake said, and what the agent calls this chat", () => {
  test("publishes the sign-in methods and whether the agent queues", async () => {
    const running = await open();
    const state = running.harness.state();
    // THE STANDING FACTS a panel draws its `/login` button and its composer
    // from: the methods are published whether or not a sign-in is on screen,
    // and `queues` is the agent's own claim about holding a busy message.
    expect(state.signIn).toBeNull();
    expect(state.methods.map((one) => one.id)).toEqual(["subscription"]);
    expect(state.queues).toBe(true);
  });

  test("publishes the agent's own title, and drops it with the conversation", async () => {
    const running = await open();
    expect(running.harness.state().title).toBeNull();

    await running.harness.prompt(typed("title"), false);
    await settled(running, "the titling turn never ended");
    expect(running.harness.state().title).toBe("what we are working on");

    // ... and the next conversation is not the one that was named.
    await running.harness.newSession();
    expect(running.harness.state().title).toBeNull();
  });
});

describe("how a turn ended, as a reading rather than as prose", () => {
  test("an ordinary turn ends, and a silent one says so", async () => {
    const running = await open();
    const { rowId } = await running.harness.prompt(typed("hello"), false);
    await settled(running, "the turn never ended");
    expect(running.turns).toEqual([
      { kind: "turn", row: rowId, outcome: "ended", why: null, silent: false },
    ]);

    // A TURN THE AGENT ANSWERED WITH NOTHING AT ALL. A panel that wants to
    // say so has to be told: counting rows afterwards cannot tell this from a
    // turn whose words went to a row of its own.
    const quiet = await running.harness.prompt(typed("quiet"), false);
    await settled(running, "the quiet turn never ended");
    expect(running.turns[1]).toEqual({
      kind: "turn",
      row: quiet.rowId,
      outcome: "ended",
      why: null,
      silent: true,
    });
  });

  test("a refused turn carries the agent's own sentence", async () => {
    const running = await open();
    const { rowId } = await running.harness.prompt(typed("fail"), false);
    await settled(running, "the refused turn never ended");
    const ended = running.turns[0];
    expect(ended?.outcome).toBe("refused");
    expect(ended?.row).toBe(rowId);
    expect(ended?.why).not.toBeNull();
    expect(ended?.silent).toBe(true);
  });

  test("a turn somebody stopped is cancelled, not failed", async () => {
    const running = await open();
    const { rowId } = await running.harness.prompt(typed("slow"), false);
    await running.harness.cancel();
    await settled(running, "the cancelled turn never ended");
    expect(running.turns[0]).toMatchObject({
      row: rowId,
      outcome: "cancelled",
      why: null,
    });
  });
});
describe("a call made inside another", () => {
  test("names the row of the agent that made it", async () => {
    // The subagent's frames name the call that sent it out by that call's id,
    // and a product draws the subagent's work in that call's lane — which it
    // finds by the ROW the call is, not by the id the wire spelt.
    const running = await open();
    await running.harness.prompt(typed("subagent"), false);
    await settled(running, "the turn never ended");
    const child = running.rows().find((row) => row.id === "tool:call-child");
    expect(child?.kind === "tool" ? child.parent : null).toBe(
      "tool:call-agent",
    );
  });
});

describe("sending that message again", () => {
  test("re-sends the row that was refused rather than minting a second", async () => {
    const running = await open();
    const { rowId } = await running.harness.prompt(typed("fail"), false);
    await settled(running, "the refused turn never ended");
    const refused = running.rows().find((row) => row.id === rowId);
    expect(refused?.kind === "user" ? refused.delivery : null).toBe("refused");
    const before = running.rows().filter((row) => row.kind === "user").length;

    // THE SAME ROW, with the body the product composes afresh — and it goes,
    // so the mark that said it had not comes off.
    await running.harness.sendAgain(rowId, "hello", []);
    await settled(running, "the re-sent turn never ended");
    const sent = running.rows().find((row) => row.id === rowId);
    expect(sent?.kind === "user" ? sent.delivery : "n/a").toBeUndefined();
    expect(running.rows().filter((row) => row.kind === "user").length).toBe(
      before,
    );
    expect(running.turns.map((one) => one.outcome)).toEqual([
      "refused",
      "ended",
    ]);
  });

  test("takes the not-sent mark off as it goes, not when the turn ends", async () => {
    // The press is what a person sees answered: a row that still says *not
    // sent* while the agent is already working on it reads as a second press
    // being needed.
    const running = await open();
    const { rowId } = await running.harness.prompt(typed("fail"), false);
    await settled(running, "the refused turn never ended");
    await running.harness.sendAgain(rowId, "slow", []);
    const going = running.rows().find((row) => row.id === rowId);
    expect(going?.kind === "user" ? going.delivery : "n/a").toBeUndefined();
  });

  test("refuses a row that is not waiting to be sent", async () => {
    const running = await open();
    const { rowId } = await running.harness.prompt(typed("hello"), false);
    await settled(running, "the turn never ended");
    // It WENT: there is nothing to offer, and a second copy of a message the
    // agent already has is the one thing *send again* must not do.
    await expect(
      running.harness.sendAgain(rowId, "hello", []),
    ).rejects.toMatchObject({ name: "HarnessRefused" });
  });
});

describe("the conversations this engine has stored", () => {
  test("are listed through the agent already running", async () => {
    const running = await open({ args: ["--stored"] });
    expect(await running.harness.sessions()).toEqual([
      {
        id: "stored-1",
        title: "the conversation before this one",
        updatedAt: "2026-01-02T00:00:00.000Z",
        messageCount: null,
        supersededBy: null,
      },
    ]);
  });

  test("are what an ADOPTING open comes up in", async () => {
    // The boot olai has: the conversation this directory was last in, else the
    // agent's most recent stored one, else a fresh one. Nothing is remembered
    // here, so the newest stored one is the answer — and working it out needs
    // the live agent, which is why it is a policy and not a decision made
    // before the spawn.
    const running = await open({
      args: ["--stored"],
      opens: {
        kind: "adopt",
        memory: { recall: Effect.succeed(null), remember: () => Effect.void },
      },
    });
    expect(running.harness.state().sessionId).toBe("stored-1");
  });

  test("an opened conversation carries the title the agent stored it under", async () => {
    // A conversation picked from the agent's own list already has a name, and
    // the panel that opened it should say it at once rather than wait for the
    // agent to name it again.
    const running = await open({ args: ["--stored"] });
    await running.harness.loadSession("stored-1");
    expect(running.harness.state().title).toBe(
      "the conversation before this one",
    );
  });

  test("can be switched between without replacing the process", async () => {
    const running = await open({ args: ["--stored"] });
    await running.harness.prompt(typed("hello"), false);
    await settled(running, "the turn never ended");
    const first = running.harness.state().sessionId;

    await running.harness.loadSession("stored-1");
    expect(running.harness.state().sessionId).toBe("stored-1");
    expect(running.harness.state().sessionId).not.toBe(first);
    // olai CLEARS, so the conversation it left went with it — and the replay
    // of the one it loaded is kept, which is the whole of what is on screen.
    expect(
      running.rows().map((row) => [row.kind, "text" in row ? row.text : ""]),
    ).toEqual([
      ["user", "what did I ask you before?"],
      ["agent", "the answer you already have"],
    ]);
    // ... and the agent is the same process: it is still the one this harness
    // spawned, still alive, and still answering.
    expect(running.harness.alive()).toBe(true);
  });

  test("a load the agent refuses says so as the one refusal with another way out", async () => {
    const running = await open({ args: ["--stored"] });
    await expect(
      running.harness.loadSession("gone-ba0d0775-2692-4460-ad85-61bec0aeb318"),
    ).rejects.toMatchObject({ name: "HarnessRefused", missing: true });
  });
});

describe("what a product discovers for itself", () => {
  test("a probe that found nothing becomes a missing server row", async () => {
    const running = await open({
      probes: () =>
        Effect.succeed([
          {
            name: "notes",
            ask: Effect.succeed({
              server: null,
              missing: {
                name: "notes",
                where: null,
                why: "the notes tool is not installed on this host",
              },
            }),
          },
        ]),
    });
    expect(
      running.harness.state().servers.map((one) => [one.standing, one.said]),
    ).toEqual([["missing", "the notes tool is not installed on this host"]]);
  });
});

describe("one frame, several calls, and the panes they run in", () => {
  test("every recognised call of a frame reaches the reader", async () => {
    const running = await open({
      mcpServers: [
        {
          kind: "stdio",
          name: "kolu",
          command: "/bin/true",
          args: [],
          env: {},
        },
      ],
    });
    await running.harness.prompt(typed("twoTools"), false);
    await settled(running, "the two-call turn never ended");
    const call = running.rows().find((row) => row.kind === "tool");
    expect(call?.kind === "tool" ? call.called : null).toBe(
      "lifecycle_create + agent_say",
    );
    // ... and the engine's own spelling, taken while the row had no name of
    // its own and kept once it has one.
    expect(call?.kind === "tool" ? call.spelled : null).toBe(
      "raw:lifecycle_create + agent_say",
    );
  });

  test("the agent's own terminals reach the row they belong to", async () => {
    const running = await open();
    await running.harness.prompt(typed("panes"), false);
    await settled(running, "the terminal turn never ended");
    const call = running.rows().find((row) => row.kind === "tool");
    const panes = call?.kind === "tool" ? (call.terminals ?? []) : [];
    expect(panes.map((one) => one.id)).toEqual(["term-1"]);
    expect(panes[0]?.output).toContain("building");
  });
});

describe("a bring-up nobody waits for any more", () => {
  test("opens nothing, so nothing is probed, and the process goes", async () => {
    // A reader that subscribes and leaves a moment later started a bring-up
    // for nobody: the open it would have made probes the product's servers
    // and spends the agent's memory of the conversation.
    const controller = new AbortController();
    let probed = 0;
    const opening = open({
      args: ["--slow-handshake"],
      probes: () =>
        Effect.sync(() => {
          probed += 1;
          return [];
        }),
      abandonWhen: { signal: controller.signal, reason: "scope released" },
    });
    setTimeout(() => controller.abort(), 50);
    await expect(opening).rejects.toMatchObject({
      name: "HarnessUnavailable",
    });
    expect(probed).toBe(0);
  });
});

describe("how turns end beside each other", () => {
  const until = async (why: string, holds: () => boolean): Promise<void> => {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      if (holds()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timed out waiting for ${why}`);
  };

  test("a message refused while another turn runs stops saying it is waiting", async () => {
    // An agent with no queue refuses the second prompt at once, while the
    // first is still running: the refused row never becomes the head, and must
    // not go on claiming it is waiting its turn.
    const running = await open({ args: ["--no-queue"] });
    await running.harness.prompt(typed("slow"), false);
    const { rowId } = await running.harness.prompt(typed("hello"), false);
    await until("the second turn to end", () =>
      running.turns.some((one) => one.row === rowId),
    );
    const row = running.rows().find((one) => one.id === rowId);
    expect(row?.kind === "user" ? row.queued : "n/a").toBeUndefined();
    expect(row?.kind === "user" ? row.delivery : "n/a").toBe("refused");
  });

  test("a turn that spoke before its agent died is not marked unanswered", async () => {
    // Its words reached the person, so the message plainly arrived: offering
    // to send it again would be offering the duplicate the mark exists to
    // prevent.
    const running = await open();
    const { rowId } = await running.harness.prompt(
      typed("speakThenDie"),
      false,
    );
    await until("the turn to end", () =>
      running.turns.some((one) => one.row === rowId),
    );
    const row = running.rows().find((one) => one.id === rowId);
    expect(row?.kind === "user" ? row.delivery : "n/a").toBeUndefined();
  });

  test("one press of cancel says so once, however many turns it stopped", async () => {
    const running = await open({ args: ["--cancel-ends-all"] });
    await running.harness.prompt(typed("slow"), false);
    const { rowId } = await running.harness.prompt(typed("hello"), false);
    await running.harness.cancel();
    await until(
      "both turns to end",
      () =>
        running.turns.some((one) => one.row === rowId) &&
        running.turns.length >= 2,
    );
    const said = running
      .rows()
      .filter(
        (one) => one.kind === "notice" && one.text === "the turn was cancelled",
      );
    expect(said.length).toBe(1);
  });
});

describe("a product that keeps the model choice itself", () => {
  test("has a person's choice written to its own record", async () => {
    // A product that keeps "which model was this conversation on" on disk
    // hands that record over, and a choice made in the panel lands in it —
    // not in a copy that dies with the process.
    const written: Array<string> = [];
    const running = await open({
      models: {
        read: () => Effect.succeed(null),
        write: (_to, chosen) =>
          Effect.sync(() => {
            written.push(chosen);
          }),
      },
    });
    await running.harness.setOption("model", "sonnet");
    expect(written).toContain("sonnet");
  });
});

describe("a product with nothing to teach", () => {
  test("sends a new session's first message exactly as it was composed", async () => {
    // A product whose standing words ride inside the body it composes hands
    // over no teaching at all — and a conversation's first message must then
    // go out as written, not behind a blank line a scripted agent reads as
    // its first.
    const running = await open({ teaching: "", agent: "agent.ts" });
    await running.harness.prompt(typed("hello"), false);
    await settled(running, "the first turn never ended");
    await running.harness.newSession();
    await running.harness.prompt(typed("hello"), false);
    await settled(running, "the new session's first turn never ended");
    await running.harness.prompt(typed("prompts"), false);
    await settled(running, "the prompts turn never ended");
    const agent = running.rows().filter((row) => row.kind === "agent");
    const last = agent[agent.length - 1];
    const bodies = JSON.parse(
      last !== undefined && "text" in last ? last.text : "[]",
    ) as ReadonlyArray<string>;
    expect(bodies.filter((body) => body !== body.trimStart())).toEqual([]);
  });
});

describe("a bring-up the agent refused", () => {
  test("opens its first conversation on the same process once asked again", async () => {
    // An agent that refused the first open for want of a signature is kept
    // alive, because the sign-in runs against it — and after the sign-in a
    // product that asks for a new conversation is asking for the first one,
    // on that very process.
    const running = await open({ agent: "signed-out-agent.ts" });
    expect(running.harness.state().sessionId).toBeNull();
    expect(running.harness.alive()).toBe(true);
    await running.harness.newSession();
    expect(running.harness.state().sessionId).not.toBeNull();
  });
});

describe("stopping a conversation", () => {
  test("says why on the line that records the agent's exit", async () => {
    // A scheduler that reaps an idle conversation, a plugin switched off and a
    // crash all end in the same exit; the reason on that one line is how a
    // person reading the log tells them apart.
    const said: Array<Record<string, unknown>> = [];
    const keep = (o: unknown, m?: string): void => {
      if (typeof o === "object" && o !== null)
        said.push({ ...o, message: m ?? null });
    };
    const { harness } = await open({
      log: { info: keep, warn: keep, error: keep },
    });
    started.splice(started.indexOf(harness), 1);
    await harness.stop("idle eviction");
    expect(said.filter((one) => one.reason !== undefined)).toEqual([
      expect.objectContaining({ reason: "idle eviction", expected: true }),
    ]);
  });
});
