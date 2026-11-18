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
import {
  allowingOurs,
  type Leg,
  mcpCallBy,
  namedExactly,
} from "@kolu/acp/engine";
import { fixtureAgent } from "@kolu/acp-client/testlib";
import { Schema } from "effect";
import { afterEach, describe, expect, test } from "vitest";
import {
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  type PersonSaid,
  startHarness,
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
    called: Schema.optionalKey(Schema.String),
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

/** A leg that reads the fixture's wire — the same one `harness.test.ts` uses,
 *  cut down to what these three cases touch. */
const leg: Leg = {
  spelling,
  mcpCall: mcpCallBy(spelling),
  replyIn: () => undefined,
  accountRefusal: () => false,
  toolNameIn: (value) => {
    const name = meta(value)?.name;
    return typeof name === "string" ? name : null;
  },
  toolNameOf: () => null,
  asksThroughForm: () => false,
  allowedWithoutAsking: allowingOurs(spelling),
  parentToolUse: () => null,
  spawned: () => null,
  backgroundTask: () => null,
  taskNotification: () => null,
  listedIn: () => null,
  prologueIn: () => null,
  bypassMode: null,
  steering: null,
  queues: () => false,
  rawMessages: null,
  models: { config: "model", nameIn: namedExactly },
};

const silent = { info: () => {}, warn: () => {}, error: () => {} };

const TEACHING = "# [fixture] you are the fixture's conversation";

const started: Array<Harness<OlaiRow>> = [];

afterEach(async () => {
  const live = started.splice(0, started.length);
  await Promise.all(live.map((harness) => harness.stop()));
});

/** What olai hands over for a person's message: the words, and nothing above
 *  them on the wire. */
const typed = (text: string): PersonSaid<OlaiRow> => ({
  text,
  body: text,
  extra: {},
  files: [],
});

/** olai reads a call for the name its own cards draw and nothing else. */
const readCall: HarnessOptions<OlaiRow>["readCall"] = (frame) =>
  frame.mcp === undefined ? undefined : { called: frame.mcp.tool };

interface Running {
  readonly harness: Harness<OlaiRow>;
  readonly rows: () => ReadonlyArray<OlaiRow>;
}

const open = async (
  extra: { resume?: string | null } = {},
): Promise<Running> => {
  const rows = new Map<string, OlaiRow>();
  const fold = (change: HarnessChange<OlaiRow>): void => {
    if (change.kind === "state") return;
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
      args: [fixtureAgent("agent.ts")],
    },
    cwd: process.cwd(),
    configDir: "/tmp/olai-test-home/.claude",
    mcpServers: [],
    teaching: TEACHING,
    taught: false,
    log: silent,
    resume: extra.resume ?? null,
    readCall,
    // OLAI'S THREE, and the whole point of this file.
    whenNewSession: "clear",
    whenLoadRefused: "report",
    whenReplayed: "keep",
    onChange: fold,
  });
  started.push(harness);
  return {
    harness,
    rows: () => [...rows.values()].sort((a, b) => a.seq - b.seq),
  };
};

const settled = async (running: Running, why: string): Promise<void> => {
  const until = Date.now() + 10_000;
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
      open({ resume: "gone-ba0d0775-2692-4460-ad85-61bec0aeb318" }),
    ).rejects.toMatchObject({
      name: "HarnessRefused",
      why: expect.stringContaining("Resource not found"),
    });
  });
});

describe("a replay that is KEPT", () => {
  test("puts the conversation the agent remembers back on screen", async () => {
    const running = await open({ resume: "sess-1" });
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
