/**
 * THE STORED ROWS DECODE UNCHANGED — the fence around a schema that moved home.
 *
 * Every JSON string below was produced by `ConductorRowSchema` AS IT STOOD
 * before the row-level vocabulary moved into `@kolu/acp/wire` (the tool status,
 * the delivery mark, a streamed piece, an armed task, a spawned subagent, a plan
 * step, an ask, what is being watched). kolu-server writes those bytes to disk
 * (`packages/conductor/src/persisted.ts`), so a conversation recorded before the
 * move has to open after it: the strings are FIXTURES, captured from the old
 * code, and they never move.
 *
 * The assertion is on the DECODED value AND on the re-encoded bytes, which is
 * the pair that catches both halves of the risk. Decode-equality alone would
 * miss a key that moved or started being emitted as `null`; byte-equality alone
 * would miss a value that decodes to the same shape by luck.
 *
 * `String.raw` because these strings ARE escapes — a tool call's `detail` is
 * folded JSON with its quotes escaped, and a plain template literal would eat
 * the backslashes and test a string no schema ever wrote.
 */

import { Saying, Watching } from "@kolu/acp/wire";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ConductorRowSchema } from "./conductorSchema.ts";

/** One row, as the pre-move schema wrote it. */
const decode = (stored: string): unknown =>
  Schema.decodeUnknownSync(ConductorRowSchema)(JSON.parse(stored));

/** ...and the same value back to bytes, so a reordering is caught too. */
const reencode = (stored: string): string =>
  JSON.stringify(
    Schema.encodeSync(ConductorRowSchema)(decode(stored) as never),
  );

const TOOL = String.raw`{"id":"tool-1","seq":4,"since":"2026-01-01T00:00:00.000Z","kind":"tool","text":"Bash","status":"failed","server":"kolu","tool":"lifecycle_create","asksThroughForm":true,"detail":"{\"cmd\":\"ls\"}","progress":"a","diffs":[],"locations":["/a"],"armed":{"task":"watch","description":null,"ended":"completed","report":"ok"},"spawned":{"kind":"claude","said":"do it"},"parent":"agent-1","stranded":true,"startedAt":"2026-01-01T00:00:00.000Z"}`;
const ASK_ANSWERED = String.raw`{"id":"ask-1","seq":5,"since":"2026-01-01T00:00:00.000Z","kind":"ask","text":"Allow?","ask":{"fields":[],"link":null,"outcome":{"how":"answered","answers":[{"key":"q","values":["yes"]}]}},"parent":"agent-1"}`;
const ASK_WAITING = String.raw`{"id":"ask-2","seq":6,"since":"2026-01-01T00:00:00.000Z","kind":"ask","text":"Where?","ask":{"fields":[],"link":{"url":"https://x/y","host":"x"},"outcome":null}}`;
const PLAN = String.raw`{"id":"plan-1","seq":7,"since":"2026-01-01T00:00:00.000Z","kind":"plan","steps":[{"content":"read","status":"in_progress","priority":"high"},{"content":"write","status":"pending","priority":null}]}`;
const USER_REFUSED = String.raw`{"id":"user-1","seq":8,"since":"2026-01-01T00:00:00.000Z","kind":"user","text":"hello","mentions":[],"delivery":"refused","attachments":[]}`;

describe("a row written before the vocabulary moved", () => {
  it("decodes a tool row, armed and spawned included", () => {
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

  it("writes every one of them back to the same bytes", () => {
    // Field ORDER is part of the stored format: a reordered struct would decode
    // to the same value and rewrite every record on the next save.
    for (const stored of [
      TOOL,
      ASK_ANSWERED,
      ASK_WAITING,
      PLAN,
      USER_REFUSED,
    ]) {
      expect(reencode(stored)).toBe(stored);
    }
  });

  it("decodes the watching list and a streamed piece the same way", () => {
    // The two shapes that ride the STATE and the FRAME rather than a row, so a
    // row fixture would not reach them.
    const watching = [
      {
        row: "tool-1",
        kind: "task" as const,
        name: "watch",
        since: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(
      JSON.stringify(Schema.encodeSync(Schema.Array(Watching))(watching)),
    ).toBe(
      String.raw`[{"row":"tool-1","kind":"task","name":"watch","since":"2026-01-01T00:00:00.000Z"}]`,
    );
    const piece = { of: "agent-1", at: 0, text: "hi" };
    expect(JSON.stringify(Schema.encodeSync(Saying)(piece))).toBe(
      String.raw`{"of":"agent-1","at":0,"text":"hi"}`,
    );
  });
});
