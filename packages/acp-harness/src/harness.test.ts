/**
 * The harness, against a REALLY SPAWNED agent.
 *
 * Every hazard this package exists to handle is a fact about two processes and
 * a pipe — a frame from a session we left, a question still open when a turn is
 * cancelled, a prompt that arrives while the agent is busy — so the fixture is
 * a process ({@link ./fixtures/agent.ts}) rather than a mock of a connection. A
 * mock able to express those races would be the harness written twice.
 */

import { allowingOurs, type Leg, mcpCallBy } from "@kolu/acp/engine";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  type Harness,
  type HarnessChange,
  HarnessRefused,
  startHarness,
} from "./harness.ts";
import type { OrchestratorRow, OrchestratorState } from "./rows.ts";
import { teachingLines } from "./teaching.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

/** How the fixture spells an MCP server's tools — the pinned Claude adapter's
 *  own spelling, which is what makes the auto-allow rule's positive
 *  recognition worth testing against it. */
const spelling = (server: string): string => `mcp__${server}__`;

const meta = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

/** A leg that reads the fixture's wire: its `_meta` names the tool, its parent
 *  and the background task a call armed. Everything else answers the honest
 *  nothing an agent that says nothing answers. */
const leg: Leg = {
  spelling,
  mcpCall: mcpCallBy(spelling),
  replyIn: () => undefined,
  toolNameIn: (value) => {
    const name = meta(value)?.name;
    return typeof name === "string" ? name : null;
  },
  toolNameOf: () => null,
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
  bypassMode: null,
  steering: null,
  queues: () => true,
  rawMessages: null,
  models: null,
};

const silent = { info: () => {}, warn: () => {}, error: () => {} };

interface Running {
  readonly harness: Harness;
  /** Every row the harness has published, folded the way padi folds them — so
   *  the assertions below are about what a READER sees rather than about the
   *  harness's own copy. */
  readonly rows: () => ReadonlyArray<OrchestratorRow>;
  readonly states: ReadonlyArray<OrchestratorState>;
}

const open = async (
  fixture: string,
  extra: { resume?: string | null } = {},
): Promise<Running> => {
  const rows = new Map<string, OrchestratorRow>();
  const states: Array<OrchestratorState> = [];
  const fold = (change: HarnessChange): void => {
    if (change.kind === "state") {
      states.push(change.state);
      return;
    }
    for (const row of change.upserts) rows.set(row.id, row);
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
  const harness = await startHarness({
    agentName: "Fixture",
    leg,
    adapter: {
      command: process.execPath,
      args: [path.join(FIXTURES, fixture)],
    },
    cwd: process.cwd(),
    mcpServers: [{ name: "kolu", command: "/bin/true", args: [], env: {} }],
    teaching: teachingLines("hostname"),
    log: silent,
    resume: extra.resume ?? null,
    onChange: fold,
  });
  return {
    harness,
    rows: () => [...rows.values()].sort((a, b) => a.seq - b.seq),
    states,
  };
};

/** Wait until the harness is idle again — the turn ran, and whatever it had to
 *  say has been said. A deadline rather than a sleep, so a hang fails with the
 *  state it hung in. */
const settled = async (running: Running, why: string): Promise<void> => {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const state = running.harness.state();
    if (state.phase === "idle" || state.phase === "asking") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${why}: still ${running.harness.state().phase}`);
};

const textOfKind = (
  running: Running,
  kind: OrchestratorRow["kind"],
): ReadonlyArray<string> =>
  running
    .rows()
    .filter((row) => row.kind === kind)
    .map((row) => ("text" in row ? row.text : ""));

describe("one conversation with a real agent", () => {
  test("a prompt goes out and the answer comes back as one growing row", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt("hello", []);
    await settled(running, "the turn never ended");

    const rows = running.rows();
    const mine = rows.find((row) => row.id === rowId);
    expect(mine?.kind).toBe("user");
    expect(mine && "text" in mine ? mine.text : "").toBe("hello");
    expect(textOfKind(running, "agent")).toEqual(["hello back"]);
    // The row the harness holds and the row a reader folded out of the deltas
    // are the same row — which is what makes `appends` safe to send at all.
    expect(running.harness.rows().map((row) => row.id)).toEqual(
      rows.map((row) => row.id),
    );
    expect(running.harness.state().sessionId).toBe("sess-1");
    await running.harness.stop();
  });

  test("the standing prompt rides the FIRST message and no later one", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("hello", []);
    await settled(running, "the first turn never ended");
    await running.harness.prompt("hello", []);
    await settled(running, "the second turn never ended");
    // What a PERSON typed is what the row says, both times: the teaching rides
    // the wire, not the transcript's record of what they said.
    expect(textOfKind(running, "user")).toEqual(["hello", "hello"]);
    expect(teachingLines("hostname")[0]).toContain("hostname");
    await running.harness.stop();
  });

  test("a frame for a session we left is dropped", async () => {
    const running = await open("agent.ts");
    // A new session CLOSES the one it replaces, which is what arms the fence —
    // and the fixture's `stale` turn sends a frame for exactly that id.
    await running.harness.newSession();
    await running.harness.prompt("stale", []);
    await settled(running, "the turn never ended");
    expect(textOfKind(running, "agent")).toEqual(["live"]);
    await running.harness.stop();
  });

  test("a cancel settles the question the turn was holding, withdrawn", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("ask", []);
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
    // WITHDRAWN, never fabricated: nobody answered, and nobody is going to.
    expect(ask?.kind === "ask" ? ask.ask.outcome : null).toEqual({
      how: "withdrawn",
      answers: [],
    });
    expect(running.harness.state().openAsks).toEqual([]);
    await running.harness.stop();
  });

  test("a prompt sent while the agent is busy is marked queued, and unmarked when taken", async () => {
    const running = await open("agent.ts");
    const first = await running.harness.prompt("slow", []);
    const second = await running.harness.prompt("hello", []);
    const queued = running.rows().find((row) => row.id === second.rowId);
    expect(queued?.kind === "user" ? queued.queued : undefined).toBe(true);
    expect(first.rowId).not.toBe(second.rowId);

    await settled(running, "the queued turn never ended");
    const taken = running.rows().find((row) => row.id === second.rowId);
    expect(taken?.kind === "user" ? taken.queued : undefined).toBeUndefined();
    await running.harness.stop();
  });

  test("a background task outlives its turn and its death lands as a notice", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("background", []);
    await settled(running, "the arming turn never ended");

    // The turn is over and the row is NOT stranded: outliving its turn is the
    // whole point of a background task, and the strip above the scroll says so.
    const armedRow = running
      .rows()
      .find((row) => row.kind === "tool" && row.armed !== undefined);
    expect(
      armedRow?.kind === "tool" ? armedRow.stranded : true,
    ).toBeUndefined();
    expect(running.harness.state().watching.map((one) => one.name)).toEqual([
      "watch the build",
    ]);

    await running.harness.prompt("reap", []);
    await settled(running, "the reaping turn never ended");
    expect(textOfKind(running, "notice").join("\n")).toContain(
      "ended (completed)",
    );
    expect(running.harness.state().watching).toEqual([]);
    await running.harness.stop();
  });

  test("a kolu call is read onto the row, and the terminal joins the fleet", async () => {
    const running = await open("agent.ts");
    await running.harness.prompt("kolu", []);
    await settled(running, "the turn never ended");

    const call = running.rows().find((row) => row.kind === "tool");
    expect(call?.kind === "tool" ? call.server : null).toBe("kolu");
    expect(call?.kind === "tool" ? call.kolu : null).toEqual({
      kind: "create",
      terminalId: "7f3e0a91-0000-4000-8000-000000000000",
      name: "fix-parser",
      cwd: null,
      agent: "claude",
    });
    expect(running.harness.state().fleet).toEqual([
      "7f3e0a91-0000-4000-8000-000000000000",
    ]);
    await running.harness.stop();
  });

  test("a turn the agent refuses marks the row refused and leaves the conversation alive", async () => {
    const running = await open("agent.ts");
    const { rowId } = await running.harness.prompt("fail", []);
    await settled(running, "the failed turn never ended");
    const row = running.rows().find((one) => one.id === rowId);
    expect(row?.kind === "user" ? row.delivery : null).toBe("refused");
    expect(running.harness.state().phase).toBe("idle");
    await running.harness.stop();
  });

  test("a load passes the SAME mcpServers — and the same `_meta` — a new session got", async () => {
    // One process, two opens: a fresh one and then the session replaced, so
    // both records are in the same fixture and comparable.
    const fresh = await open("agent.ts");
    await fresh.harness.newSession();
    await fresh.harness.prompt("servers", []);
    await settled(fresh, "the turn never ended");
    const [fromNew] = textOfKind(fresh, "agent");
    expect(JSON.parse(fromNew ?? "[]")).toEqual([["kolu"], ["kolu"]]);
    await fresh.harness.stop();

    // ... and the other door into an open: a RESUME, which is a
    // `session/load`. The adapter reads its subscription off whichever request
    // made the session, so a load handed a different list than a new one is
    // the bug this holds shut.
    const resumed = await open("agent.ts", { resume: "sess-1" });
    await resumed.harness.prompt("servers", []);
    await settled(resumed, "the resumed turn never ended");
    const [fromLoad] = textOfKind(resumed, "agent");
    expect(JSON.parse(fromLoad ?? "[]")).toEqual([["kolu"]]);
    expect(resumed.harness.state().sessionId).toBe("sess-1");
    await resumed.harness.stop();
  });
});

describe("an agent nobody is signed in to", () => {
  test("refuses the open with `auth`, and says so in its own words", async () => {
    await expect(open("signed-out-agent.ts")).rejects.toMatchObject({
      name: "HarnessRefused",
      auth: true,
    });
    await expect(open("signed-out-agent.ts")).rejects.toBeInstanceOf(
      HarnessRefused,
    );
  });
});
