/**
 * THE STORED ROWS DECODE UNCHANGED — the fence around a schema whose fields
 * moved home.
 *
 * Every JSON string below was produced by `ConductorRowSchema` AS IT STOOD
 * before the row-level vocabulary moved into `@kolu/acp/wire` (the tool status,
 * the delivery mark, a streamed piece, an armed task, a spawned subagent, a plan
 * step, an ask, what is being watched). kolu-server writes those rows to a file
 * (`packages/server/src/conductor/transcriptFile.ts`), so a conversation
 * recorded before the move has to open after it.
 *
 * THE CLAIM IS DECODE EQUALITY, not byte equality. The rows are now built by
 * SPREADING the shared field objects and adding kolu's own after them, so a
 * `user` or `tool` row's keys come out in a different order — which changes the
 * bytes and changes nothing a reader sees. What must not change is the VALUE a
 * stored row decodes to, and re-encoding it must decode to that same value again
 * (a key that moved into a differently-typed field, or one that started being
 * emitted, would show up here and nowhere else).
 *
 * `String.raw` because these strings ARE escapes — a tool call's `detail` is
 * folded JSON with its quotes escaped, and a plain template literal would eat
 * the backslashes and test a string no schema ever wrote.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ConductorRowSchema } from "./conductorSchema.ts";

/** One row, as an older schema wrote it. */
const decode = (stored: string): unknown =>
  Schema.decodeUnknownSync(ConductorRowSchema)(JSON.parse(stored));

/** ... and the value read back off this build's own encoding of it. */
const roundTrip = (stored: string): unknown =>
  Schema.decodeUnknownSync(ConductorRowSchema)(
    JSON.parse(
      JSON.stringify(
        Schema.encodeSync(ConductorRowSchema)(decode(stored) as never),
      ),
    ),
  );

const TOOL = String.raw`{"id":"tool-1","seq":4,"since":"2026-01-01T00:00:00.000Z","kind":"tool","text":"Bash","status":"failed","server":"kolu","tool":"lifecycle_create","asksThroughForm":true,"detail":"{\"cmd\":\"ls\"}","progress":"a","diffs":[],"locations":["/a"],"armed":{"task":"watch","description":null,"ended":"completed","report":"ok"},"spawned":{"kind":"claude","said":"do it"},"parent":"agent-1","stranded":true,"startedAt":"2026-01-01T00:00:00.000Z"}`;
const ASK_ANSWERED = `{"id":"ask-1","seq":5,"since":"2026-01-01T00:00:00.000Z","kind":"ask","text":"Allow?","ask":{"fields":[],"link":null,"outcome":{"how":"answered","answers":[{"key":"q","values":["yes"]}]}},"parent":"agent-1"}`;
const ASK_WAITING = `{"id":"ask-2","seq":6,"since":"2026-01-01T00:00:00.000Z","kind":"ask","text":"Where?","ask":{"fields":[],"link":{"url":"https://x/y","host":"x"},"outcome":null}}`;
const PLAN = `{"id":"plan-1","seq":7,"since":"2026-01-01T00:00:00.000Z","kind":"plan","steps":[{"content":"read","status":"in_progress","priority":"high"},{"content":"write","status":"pending","priority":null}]}`;
const USER_REFUSED = `{"id":"user-1","seq":8,"since":"2026-01-01T00:00:00.000Z","kind":"user","text":"hello","mentions":[],"delivery":"refused","attachments":[]}`;
const AGENT = `{"id":"agent-1","seq":3,"since":"2026-01-01T00:00:00.000Z","kind":"agent","text":"I will read the file","streaming":true}`;
const NOTICE = `{"id":"notice:9","seq":9,"since":"2026-01-01T00:00:00.000Z","kind":"notice","text":"the turn was cancelled"}`;
const DIVIDER = `{"id":"divider:10","seq":10,"since":"2026-01-01T00:00:00.000Z","kind":"divider","text":"new session"}`;
const WAKE = `{"id":"wake:11","seq":11,"since":"2026-01-01T00:00:00.000Z","kind":"wake","from":"kolu","events":[{"ref":"local/11111111-1111-4111-8111-111111111111","host":"local","terminalId":"11111111-1111-4111-8111-111111111111","hostName":"naiveintent","name":"fix-parser","agent":"claude-code","level":"stopped","at":"2026-01-01T00:00:00.000Z"}],"text":"fix-parser stopped","queued":true,"delivery":"unanswered"}`;
const WORK_ASK = `{"id":"work-ask:12","seq":12,"since":"2026-01-01T00:00:00.000Z","kind":"work-ask","text":"Which harness?","ask":{"fields":[],"standing":{"kind":"part","answers":[{"key":"harness","values":["claude"]}]}},"work":"local/repo@main","parent":"tool:1"}`;

/** Every fixture, named the way a reader asks about one. */
const STORED: ReadonlyArray<readonly [string, string]> = [
  ["agent", AGENT],
  ["ask (answered)", ASK_ANSWERED],
  ["ask (waiting)", ASK_WAITING],
  ["divider", DIVIDER],
  ["notice", NOTICE],
  ["plan", PLAN],
  ["tool", TOOL],
  ["user (refused)", USER_REFUSED],
  ["wake", WAKE],
  ["work-ask", WORK_ASK],
];

describe("a row written before the vocabulary moved", () => {
  it("decodes a tool row, armed, spawned and stamped included", () => {
    expect(decode(TOOL)).toEqual({
      id: "tool-1",
      seq: 4,
      since: "2026-01-01T00:00:00.000Z",
      kind: "tool",
      text: "Bash",
      status: "failed",
      server: "kolu",
      tool: "lifecycle_create",
      asksThroughForm: true,
      detail: '{"cmd":"ls"}',
      progress: "a",
      diffs: [],
      locations: ["/a"],
      armed: {
        task: "watch",
        description: null,
        ended: "completed",
        report: "ok",
      },
      spawned: { kind: "claude", said: "do it" },
      parent: "agent-1",
      stranded: true,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("decodes an ask that was answered, and one that is still waiting", () => {
    expect(decode(ASK_ANSWERED)).toMatchObject({
      kind: "ask",
      ask: {
        link: null,
        outcome: { how: "answered", answers: [{ key: "q", values: ["yes"] }] },
      },
    });
    expect(decode(ASK_WAITING)).toMatchObject({
      kind: "ask",
      ask: { link: { url: "https://x/y", host: "x" }, outcome: null },
    });
  });

  it("decodes a plan, and a user row carrying a delivery mark", () => {
    expect(decode(PLAN)).toMatchObject({
      kind: "plan",
      steps: [
        { content: "read", status: "in_progress", priority: "high" },
        { content: "write", status: "pending", priority: null },
      ],
    });
    expect(decode(USER_REFUSED)).toMatchObject({
      kind: "user",
      delivery: "refused",
    });
  });

  it("decodes the kinds the class writes but this test used to miss", () => {
    // EVERY KIND a stored conversation can hold, because the fence is about the
    // file: a row this build could not read is a conversation that will not
    // open, and the kind left untested is the one that breaks.
    expect(decode(AGENT)).toMatchObject({ kind: "agent", streaming: true });
    expect(decode(NOTICE)).toMatchObject({ kind: "notice" });
    expect(decode(DIVIDER)).toMatchObject({ kind: "divider" });
    expect(decode(WAKE)).toMatchObject({
      kind: "wake",
      // ... the two delivery marks a wake carries like any other delivered row
      queued: true,
      delivery: "unanswered",
      events: [{ level: "stopped", name: "fix-parser" }],
    });
    expect(decode(WORK_ASK)).toMatchObject({
      kind: "work-ask",
      work: "local/repo@main",
      ask: { standing: { kind: "part" } },
    });
  });

  it("re-encodes every one of them to a value that decodes the same", () => {
    // NOT byte equality: the rows are built by spreading the shared field
    // objects, so kolu's own fields follow them and the KEY ORDER moved. What
    // must hold is that what this build writes is what this build reads — a key
    // that landed on a field of another type, or one now emitted where it was
    // absent, would decode differently here.
    for (const [name, stored] of STORED) {
      expect([name, roundTrip(stored)]).toEqual([name, decode(stored)]);
    }
  });
});
