/**
 * The kolu reading of each tool, against the shapes those tools really take
 * and answer — and the property a production transcript lost: whatever the
 * agent wrote, the reading encodes under the row schema it is served and
 * persisted through.
 *
 * Pure — it spawns nothing — but it rides this package's one lane,
 * `test:daemon`, beside the suites that spawn real agents.
 */

import { ConductorToolRowSchema } from "kolu-common/conductor";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";
import { koluCallOf, refineKoluCall } from "./kolu.ts";
import type { ConductorKoluCall } from "./rows.ts";

const T = "7f3e0a91-0000-4000-8000-000000000000";
const PARENT = "11111111-2222-4333-8444-555555555555";
/** A terminal on a remote host, as a production ref spelled one. */
const WATCHED = "39738f3c-5472-44a4-9bc1-2d084fdf526b";

const NO_SUBJECT = { terminalId: null, host: null };

interface Case {
  readonly why: string;
  readonly tool: string;
  readonly input: unknown;
  readonly answer: unknown;
  readonly reads: ConductorKoluCall;
}

const CASES: ReadonlyArray<Case> = [
  {
    why: "a create is about the terminal its answer names, not the parent it was placed under",
    tool: "lifecycle_create",
    input: {
      host: "local",
      placement: { kind: "child-of", parentId: `local/${PARENT}` },
      cwd: "/home/u/kolu",
      intent: "fix the parser",
      run: "claude",
    },
    answer: { id: `local/${T}`, pid: 7, ran: "claude" },
    reads: {
      kind: "create",
      terminalId: T,
      host: "local",
      name: "fix the parser",
      cwd: "/home/u/kolu",
      agent: "claude",
    },
  },
  {
    why: "a create still in flight names no host without the terminal to go with it",
    tool: "lifecycle_create",
    input: {
      host: "remote:prod",
      placement: { kind: "toplevel" },
      repo: "/home/u/kolu",
      worktree: "fix-parser",
    },
    answer: undefined,
    reads: {
      kind: "create",
      ...NO_SUBJECT,
      name: "fix-parser",
      cwd: null,
      agent: null,
    },
  },
  {
    why: "a remote host key keeps its own slashes",
    tool: "lifecycle_sendInput",
    input: { id: `remote:ssh://box/3/${T}`, text: "make test" },
    answer: { sent: { textBytes: 9 } },
    reads: {
      kind: "sendInput",
      terminalId: T,
      host: "remote:ssh://box/3",
      name: null,
      text: "make test",
      key: null,
    },
  },
  {
    why: "a kill read off its settling frame alone still knows its terminal",
    tool: "lifecycle_kill",
    input: undefined,
    answer: { id: `local/${T}`, pid: 7 },
    reads: { kind: "kill", terminalId: T, host: "local", name: null },
  },
  {
    why: "a screen read carries the screen it answered",
    tool: "screen_text",
    input: { id: `local/${T}`, tail: 2 },
    answer: "$ make test\nok",
    reads: {
      kind: "screen",
      terminalId: T,
      host: "local",
      name: null,
      snapshot: "$ make test\nok",
    },
  },
  {
    why: "a quiet wait shows what fired, how long, and the tail it read",
    tool: "wait_outputSettled",
    input: { id: `local/${T}`, idleMs: 800, screenTail: 1 },
    answer: {
      id: `local/${T}`,
      result: "met",
      met: { fired: "idle", elapsedMs: 812, screen: "$ " },
    },
    reads: {
      kind: "settle",
      terminalId: T,
      host: "local",
      name: null,
      state: "idle",
      elapsedMs: 812,
      screenTail: "$ ",
    },
  },
  {
    why: "a say carries the words put to the agent in that terminal",
    tool: "agent_say",
    input: { id: `local/${T}`, text: "skip the review on this one" },
    answer: { id: `local/${T}`, delivered: "typed" },
    reads: {
      kind: "say",
      terminalId: T,
      host: "local",
      name: null,
      text: "skip the review on this one",
    },
  },
  {
    why: "a watch says that terminal is on the list now",
    tool: "watch_terminal",
    input: { id: `local/${T}` },
    answer: { watching: [`local/${T}`] },
    reads: {
      kind: "watch",
      terminalId: T,
      host: "local",
      name: null,
      watching: true,
    },
  },
  {
    why: "an unwatch says it is off it, host and all",
    tool: "unwatch_terminal",
    input: { id: `remote:naiveintent/${WATCHED}` },
    answer: { watching: [], removed: true },
    reads: {
      kind: "watch",
      terminalId: WATCHED,
      host: "remote:naiveintent",
      name: null,
      watching: false,
    },
  },
];

describe("each kolu tool is read off the fields it really carries", () => {
  test.each(CASES)("$tool: $why", ({ tool, input, answer, reads }) => {
    expect(koluCallOf(tool, input, answer)).toEqual(reads);
  });
});

// ── Whatever the agent writes, the reading encodes ──────────────────────────

const TOOLS = [
  "lifecycle_create",
  "lifecycle_sendInput",
  "lifecycle_kill",
  "screen_text",
  "wait_outputSettled",
  "agent_say",
  "watch_terminal",
  "unwatch_terminal",
] as const;

/** What an agent (or a half-written frame) might put in any slot. The valid
 *  refs are here too, so a subject is minted as well as refused. */
const WRITTEN: ReadonlyArray<unknown> = [
  "track-alien-ray",
  "",
  "/",
  "local/",
  `/${T}`,
  "local/not-a-uuid",
  "local/7f3e",
  T,
  `local/${T}/x`,
  `local/${T}`,
  `remote:ssh://box/3/${T}`,
  `local/${T.toUpperCase()}`,
  "local/00000000-0000-0000-0000-000000000000",
  "\u0000",
  "x".repeat(10_000),
  0,
  -0.5,
  1e300,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  true,
  null,
  undefined,
  {},
  [],
];

/** Every key any reader looks at, nested where the tools nest it, holding
 *  the one value. */
const everywhere = (value: unknown): Record<string, unknown> => ({
  id: value,
  name: value,
  host: value,
  text: value,
  key: value,
  cwd: value,
  intent: value,
  worktree: { path: value },
  run: value,
  ran: value,
  result: value,
  elapsedMs: value,
  met: {
    fired: value,
    agent: { state: value },
    elapsedMs: value,
    screen: value,
    events: [
      { id: value, state: value, kind: value },
      { id: value, state: value, kind: value },
    ],
  },
});

const encodeRow = Schema.encodeUnknownSync(ConductorToolRowSchema);

/** The reading as the row it rides — the shape that failed to encode. */
const asRow = (tool: string, kolu: ConductorKoluCall) => ({
  id: "call-1",
  seq: 1,
  since: "2026-11-12T00:00:00.000Z",
  kind: "tool",
  text: tool,
  status: "completed",
  server: "kolu",
  tool,
  kolu,
});

describe("a reading encodes under the row schema whatever the agent wrote", () => {
  test.each(TOOLS)("%s", (tool) => {
    const shapes = WRITTEN.flatMap((value) => [value, everywhere(value)]);
    const readings: ConductorKoluCall[] = [];
    for (const input of shapes) {
      for (const answer of shapes) {
        const call = koluCallOf(tool, input, answer);
        if (call === null) throw new Error(`${tool} is not read`);
        // Which terminal: both halves, or neither.
        expect(call.terminalId === null).toBe(call.host === null);
        expect(() => encodeRow(asRow(tool, call))).not.toThrow();
        readings.push(call);
      }
    }
    // ... and a frame refining an earlier one keeps that true.
    for (let i = 1; i < readings.length; i += 1) {
      const folded = refineKoluCall(
        readings[i - 1] ?? null,
        readings[i] ?? null,
      );
      if (folded === null) throw new Error("two readings folded to none");
      expect(folded.terminalId === null).toBe(folded.host === null);
      expect(() => encodeRow(asRow(tool, folded))).not.toThrow();
    }
  });
});
