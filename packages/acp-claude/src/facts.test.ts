import { describe, expect, test } from "vitest";
import {
  clearOpenedAtOf,
  pairSupersessions,
  sayTimestampLossOnce,
  sdkMessageText,
  sessionListFactsOf,
} from "../adapter/session-list-info/facts.js";

describe("the opening of a conversation", () => {
  test("a /clear opener is found and dated", () => {
    expect(
      clearOpenedAtOf([
        {
          type: "user",
          timestamp: "2026-08-20T13:14:00.000Z",
          message: { content: "<command-name>/clear</command-name>" },
        },
      ]),
    ).toEqual({ sawClear: true, at: Date.parse("2026-08-20T13:14:00.000Z") });
  });

  test("onboarding commands before the /clear do not close the stretch", () => {
    expect(
      clearOpenedAtOf([
        {
          type: "user",
          timestamp: "2026-08-20T13:13:00.000Z",
          message: { content: "<command-name>/settings</command-name>" },
        },
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "" }] },
        },
        {
          type: "user",
          timestamp: "2026-08-20T13:14:00.000Z",
          message: { content: "<command-name>\n  /clear\n</command-name>" },
        },
      ]),
    ).toEqual({ sawClear: true, at: Date.parse("2026-08-20T13:14:00.000Z") });
  });

  test("the first SPEAKING entry that is no command ends the opening", () => {
    expect(
      clearOpenedAtOf([
        {
          type: "user",
          timestamp: "2026-08-20T13:13:00.000Z",
          message: { content: "say hi" },
        },
        {
          type: "user",
          timestamp: "2026-08-20T13:14:00.000Z",
          message: { content: "<command-name>/clear</command-name>" },
        },
      ]),
    ).toEqual({ sawClear: false, at: undefined });
  });

  test("a clear past the opening stretch is a REOPEN, not an opening", () => {
    const stretch = Array.from({ length: 12 }, () => ({
      type: "user",
      timestamp: "2026-08-20T13:13:00.000Z",
      message: { content: `<command-name>/settings</command-name>` },
    }));
    stretch.push({
      type: "user",
      timestamp: "2026-08-20T13:14:00.000Z",
      message: { content: "<command-name>/clear</command-name>" },
    });
    expect(clearOpenedAtOf(stretch)).toEqual({
      sawClear: false,
      at: undefined,
    });
  });

  test("an UNDATED clear opener says it was SEEN — the SDK timestamp's way of going quiet", () => {
    expect(
      clearOpenedAtOf([
        {
          type: "user",
          message: { content: "<command-name>/clear</command-name>" },
        },
      ]),
    ).toEqual({ sawClear: true, at: undefined });
  });

  test("a real person's words are what sdkMessageText reads", () => {
    expect(sdkMessageText({ message: { content: "plain" } })).toBe("plain");
    expect(
      sdkMessageText({
        message: {
          content: [
            { type: "text", text: "first" },
            { type: "tool_use", input: "excluded" },
            { type: "text", text: "second" },
          ],
        },
      }),
    ).toBe("first\nsecond");
    expect(sdkMessageText({ type: "user" })).toBe("");
  });
});

const depsOf = (given: {
  cache?: Map<string, unknown>;
  messages?: (id: string, at: { dir?: string }) => Promise<unknown[]>;
  info?: (id: string, at: { dir?: string }) => Promise<unknown>;
}) => {
  const said: string[] = [];
  return {
    cache: given.cache ?? new Map<string, unknown>(),
    messages: given.messages ?? (async () => []),
    info:
      given.info ??
      (async () => ({ sessionId: "s", summary: null, lastModified: 0 })),
    say: (line: string) => said.push(line),
    said,
  };
};

const row = (sessionId: string, extras: Record<string, unknown> = {}) => ({
  sessionId,
  fileSize: 1000,
  lastModified: 100,
  dir: "/d",
  ...extras,
});

describe("what one listed session says", () => {
  test("a read problem is NO STAMPS, never a zero", async () => {
    const deps = depsOf({
      messages: async () => [],
      info: async () => undefined,
    });
    expect(await sessionListFactsOf(row("s1"), deps)).toBeUndefined();
    expect(deps.said.length).toBe(1);
    expect(deps.cache.size).toBe(0);
  });

  test("a GENUINELY EMPTY conversation keeps its zero", async () => {
    const deps = depsOf({
      messages: async () => [],
      info: async () => ({ sessionId: "s", summary: null, lastModified: 0 }),
    });
    expect(await sessionListFactsOf(row("s1"), deps)).toEqual({
      messageCount: 0,
      timestampLoss: false,
    });
  });

  test("a throw mid-read is unstamped AND unremembered — a transient may mend", async () => {
    let calls = 0;
    const deps = depsOf({
      messages: async () => {
        calls++;
        if (calls === 1) throw new Error("EACCES");
        return [
          {
            type: "user",
            timestamp: "2026-08-20T13:14:00.000Z",
            message: { content: "hi" },
          },
        ];
      },
    });
    expect(await sessionListFactsOf(row("s1"), deps)).toBeUndefined();
    expect(await sessionListFactsOf(row("s1"), deps)).toEqual({
      messageCount: 1,
      timestampLoss: false,
    });
    expect(calls).toBe(2);
  });

  test("the cache keys on the row's OWN size and mtime, and rereads when either moves", async () => {
    let reads = 0;
    const deps = depsOf({
      messages: async () => {
        reads++;
        return [
          {
            type: "user",
            timestamp: "2026-08-20T13:13:00.000Z",
            message: { content: "m" },
          },
        ];
      },
    });
    expect(await sessionListFactsOf(row("s1"), deps)).not.toBeUndefined();
    expect(await sessionListFactsOf(row("s1"), deps)).not.toBeUndefined();
    expect(reads).toBe(1);
    expect(
      await sessionListFactsOf(row("s1", { fileSize: 2000 }), deps),
    ).not.toBeUndefined();
    expect(
      await sessionListFactsOf(row("s1", { lastModified: 200 }), deps),
    ).not.toBeUndefined();
    expect(reads).toBe(3);
  });

  test("an undefined fileSize keys on mtime alone, which the notes carry openly", async () => {
    let reads = 0;
    const deps = depsOf({
      messages: async () => {
        reads++;
        return [];
      },
    });
    const bare = {
      sessionId: "s1",
      lastModified: 100,
      dir: "/d",
      fileSize: undefined,
    };
    await sessionListFactsOf(bare, deps);
    await sessionListFactsOf(bare, deps);
    expect(reads).toBe(1);
  });

  test("an undated-clear is stamped with the LOSS — the row can say it, beside not pairing", async () => {
    const deps = depsOf({
      messages: async () => [
        {
          type: "user",
          message: { content: "<command-name>/clear</command-name>" },
        },
      ],
    });
    expect(await sessionListFactsOf(row("s1"), deps)).toEqual({
      messageCount: 1,
      timestampLoss: true,
    });
    expect(deps.cache.size).toBe(1);
  });
});

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-08-20T13:14:00.000Z");

const saidArr = () => {
  const said: string[] = [];
  return { said, say: (line: string) => said.push(line) };
};

describe("which conversation a /clear moved", () => {
  test("the ordinary pair: the clear-opener names the row last touched before it", () => {
    const { said, say } = saidArr();
    expect(
      pairSupersessions(
        [
          {
            id: "new",
            cwd: "/d",
            lastModified: T0 + 5 * 60 * 1000,
            clearedAt: T0,
          },
          { id: "old", cwd: "/d", lastModified: T0 - 60 * 1000 },
          { id: "elsewhere", cwd: "/other", lastModified: T0 - 1000 },
        ],
        { say },
      ),
    ).toEqual(new Map([["old", "new"]]));
    expect(said).toEqual([]);
  });

  test("a CHAIN: two clear-openers in a row", () => {
    expect(
      pairSupersessions([
        {
          id: "c",
          cwd: "/d",
          lastModified: T0 + 10 * 60 * 1000,
          clearedAt: T0 + 5 * 60 * 1000,
        },
        { id: "b", cwd: "/d", lastModified: T0 + 4 * 60 * 1000, clearedAt: T0 },
        { id: "a", cwd: "/d", lastModified: T0 - 10 * 60 * 1000 },
      ]),
    ).toEqual(
      new Map([
        ["a", "b"],
        ["b", "c"],
      ]),
    );
  });

  test("a TIE at the maximum is no answer for either", () => {
    const { said, say } = saidArr();
    expect(
      pairSupersessions(
        [
          { id: "new", cwd: "/d", lastModified: T0 + 1000, clearedAt: T0 },
          { id: "x", cwd: "/d", lastModified: T0 - 1000 },
          { id: "y", cwd: "/d", lastModified: T0 - 1000 },
        ],
        { say },
      ),
    ).toEqual(new Map());
    expect(said.length).toBe(1);
  });

  test("the same-timestamp boundary INCLUDES the predecessor — one candidate is the link", () => {
    expect(
      pairSupersessions([
        { id: "new", cwd: "/d", lastModified: T0 + 1000, clearedAt: T0 },
        { id: "same", cwd: "/d", lastModified: T0 },
        { id: "earlier", cwd: "/d", lastModified: T0 - 60 * 1000 },
      ]),
    ).toEqual(new Map([["same", "new"]]));
  });

  test("the same-timestamp boundary STILL ties when two are at it", () => {
    const { said, say } = saidArr();
    expect(
      pairSupersessions(
        [
          { id: "new", cwd: "/d", lastModified: T0 + 1000, clearedAt: T0 },
          { id: "one", cwd: "/d", lastModified: T0 },
          { id: "two", cwd: "/d", lastModified: T0 },
        ],
        { say },
      ),
    ).toEqual(new Map());
    expect(said.length).toBe(1);
  });

  test("the SECOND CLAIMANT means neither takes the link — no last-writer-wins", () => {
    const { said, say } = saidArr();
    expect(
      pairSupersessions(
        [
          {
            id: "clear1",
            cwd: "/d",
            lastModified: T0 + 15 * 60 * 1000,
            clearedAt: T0,
          },
          {
            id: "clear2",
            cwd: "/d",
            lastModified: T0 + 20 * 60 * 1000,
            clearedAt: T0 + 10 * 60 * 1000,
          },
          { id: "old", cwd: "/d", lastModified: T0 - 1000 },
        ],
        { say },
      ),
    ).toEqual(new Map());
    expect(said.some((line) => line.includes("old"))).toBe(true);
  });

  test("a clear-opener claims its own earlier-refused claimant's old respondent fine", () => {
    expect(
      pairSupersessions([
        {
          id: "clear1",
          cwd: "/d",
          lastModified: T0 + 15 * 60 * 1000,
          clearedAt: T0,
        },
        { id: "old", cwd: "/d", lastModified: T0 - 1000 },
      ]),
    ).toEqual(new Map([["old", "clear1"]]));
  });

  test("an UNDATED opener claims nothing", () => {
    const { said, say } = saidArr();
    expect(
      pairSupersessions(
        [
          { id: "new", cwd: "/d", lastModified: T0 + 1000 },
          { id: "old", cwd: "/d", lastModified: T0 - 1000 },
        ],
        { say },
      ),
    ).toEqual(new Map());
    expect(said).toEqual([]);
  });

  test("NO candidate in the window is a refusal, not the best of the heard", () => {
    const { said, say } = saidArr();
    expect(
      pairSupersessions(
        [
          { id: "new", cwd: "/d", lastModified: T0 + 1000, clearedAt: T0 },
          { id: "weeks_gone", cwd: "/d", lastModified: T0 - 8 * DAY },
        ],
        { say },
      ),
    ).toEqual(new Map());
    expect(said.length).toBe(1);
  });

  test("a candidate one day INSIDE the window is admitted", () => {
    expect(
      pairSupersessions([
        { id: "new", cwd: "/d", lastModified: T0 + 1000, clearedAt: T0 },
        { id: "old", cwd: "/d", lastModified: T0 - 6 * DAY },
      ]),
    ).toEqual(new Map([["old", "new"]]));
  });

  test("a session the listing would not name is no candidate — programmatic ones included", () => {
    const { say } = saidArr();
    expect(
      pairSupersessions(
        [
          { id: "new", cwd: "/d", lastModified: T0 + 1000, clearedAt: T0 },
          { id: "headless", cwd: "/d", lastModified: T0 - 1000 },
          { id: "other", cwd: "/d", lastModified: T0 - 2000 },
        ],
        {
          includeId: (id: string) => id !== "headless",
          say,
        },
      ),
    ).toEqual(new Map([["other", "new"]]));
  });

  test("order of arrival does not decide anything", () => {
    const forward = pairSupersessions([
      { id: "old", cwd: "/d", lastModified: T0 - 1000 },
      { id: "new", cwd: "/d", lastModified: T0 + 1000, clearedAt: T0 },
    ]);
    const backward = pairSupersessions([
      { id: "new", cwd: "/d", lastModified: T0 + 1000, clearedAt: T0 },
      { id: "old", cwd: "/d", lastModified: T0 - 1000 },
    ]);
    expect(forward).toEqual(backward);
  });
});

describe("the build going quiet about timestamps is announced, once", () => {
  test("first case in the process speaks; every call after answers nothing", () => {
    const state = { told: false };
    const said: string[] = [];
    const say = (line: string) => said.push(line);
    expect(
      sayTimestampLossOnce(
        [{ messageCount: 4, timestampLoss: true }],
        state,
        say,
      ),
    ).toBe(true);
    expect(said).toHaveLength(1);
    expect(
      sayTimestampLossOnce(
        [{ messageCount: 4, timestampLoss: true }],
        state,
        say,
      ),
    ).toBe(false);
    expect(sayTimestampLossOnce([], state, say)).toBe(false);
    expect(said).toHaveLength(1);
  });

  test("every untouched-reading list is total silence", () => {
    const state = { told: false };
    const said: string[] = [];
    const say = (line: string) => said.push(line);
    expect(
      sayTimestampLossOnce(
        [
          undefined,
          { messageCount: 47 },
          { messageCount: 0, timestampLoss: false },
        ],
        state,
        say,
      ),
    ).toBe(false);
    expect(said).toEqual([]);
    expect(state.told).toBe(false);
  });
});
