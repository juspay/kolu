import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { OmpSession } from "./breadcrumb.ts";
import {
  deriveOmpInfo,
  deriveOmpState,
  readTitleSlot,
  TITLE_SLOT_BYTES,
} from "./core.ts";

const line = (entry: object): string => JSON.stringify(entry);

const user = (t = "2026-09-14T17:07:20.000Z") =>
  line({
    type: "message",
    id: `u-${t}`,
    parentId: null,
    timestamp: t,
    message: { role: "user", content: [{ type: "text", text: "hi" }] },
  });

const assistant = (
  stopReason: string,
  opts: { model?: string; usage?: Record<string, number> } = {},
) =>
  line({
    type: "message",
    id: `a-${stopReason}-${opts.model ?? ""}`,
    parentId: null,
    timestamp: "2026-09-14T17:07:21.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "…" }],
      model: opts.model ?? "deepseek-v4.1-flash",
      stopReason,
      ...(opts.usage ? { usage: opts.usage } : {}),
    },
  });

const toolResult = () =>
  line({
    type: "message",
    id: "r1",
    parentId: null,
    timestamp: "2026-09-14T17:07:22.000Z",
    message: {
      role: "toolResult",
      toolCallId: "bash:1",
      content: [{ type: "text", text: "ok" }],
      isError: false,
    },
  });

const custom = (customType: string) =>
  line({ type: "custom", customType, id: `c-${customType}`, parentId: null });
const thinkingLevel = () =>
  line({ type: "thinking_level_change", thinkingLevel: "medium", id: "t1" });
const titleChange = () =>
  line({ type: "title_change", title: "Run echo hello", id: "tc1" });

describe("deriveOmpState", () => {
  it("folds every assistant stop reason the way omp records them", () => {
    expect(deriveOmpState([user(), assistant("toolUse")])?.state).toBe(
      "tool_use",
    );
    expect(deriveOmpState([user(), assistant("stop")])?.state).toBe("waiting");
    expect(deriveOmpState([user(), assistant("aborted")])?.state).toBe(
      "waiting",
    );
    expect(deriveOmpState([user(), assistant("length")])?.state).toBe(
      "waiting",
    );
    expect(deriveOmpState([user(), assistant("error")])?.state).toBe("waiting");
    expect(deriveOmpState([user(), assistant("max_tokens")])?.state).toBe(
      "waiting",
    );
  });

  it("reads a trailing prompt or tool result as work in flight", () => {
    expect(deriveOmpState([assistant("stop"), user()])?.state).toBe("thinking");
    expect(
      deriveOmpState([assistant("toolUse"), custom("tool_execution_start")])
        ?.state,
    ).toBe("tool_use");
    expect(deriveOmpState([assistant("toolUse"), toolResult()])?.state).toBe(
      "thinking",
    );
  });

  it("walks past non-message entries rather than reading them as turns", () => {
    expect(
      deriveOmpState([
        user(),
        assistant("stop"),
        titleChange(),
        thinkingLevel(),
        custom("session_exit"),
      ])?.state,
    ).toBe("waiting");
    expect(
      deriveOmpState([thinkingLevel(), custom("session_exit")]),
    ).toBeNull();
    expect(deriveOmpState([])).toBeNull();
  });

  it("prefers `model_change.model` newest-first over the turn's own model", () => {
    const change = line({
      type: "model_change",
      id: "m1",
      parentId: null,
      model: "litellm/kimi-k3",
      timestamp: "2026-09-14T17:07:23.000Z",
    });
    expect(deriveOmpState([user(), assistant("stop"), change])?.model).toBe(
      "litellm/kimi-k3",
    );
    expect(
      deriveOmpState([change, user(), assistant("stop", { model: "z-ai/glm" })])
        ?.model,
    ).toBe("z-ai/glm");
    expect(deriveOmpState([change, user()])?.model).toBe("litellm/kimi-k3");
    expect(deriveOmpState([user()])?.model).toBeNull();
  });

  it("sums the three disjoint context buckets from the newest usage", () => {
    const before = assistant("stop", {
      usage: { input: 100, output: 9, cacheRead: 20, cacheWrite: 3 },
    });
    expect(deriveOmpState([user(), before])?.contextTokens).toBe(123);
    expect(
      deriveOmpState([
        user(),
        before,
        assistant("stop", { model: "other" }),
        user(),
      ])?.contextTokens,
    ).toBe(123);
    expect(
      deriveOmpState([
        before,
        user(),
        assistant("stop", { usage: { input: 0, output: 5 } }),
      ])?.contextTokens,
    ).toBe(0);
    expect(deriveOmpState([user()])?.contextTokens).toBeNull();
  });

  it("survives a malformed or half-written line", () => {
    expect(
      deriveOmpState([user(), '{"type":"message"', assistant("stop")])?.state,
    ).toBe("waiting");
  });
});

describe("readTitleSlot", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-omp-title-"));
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function slot(fields: Record<string, string>): string {
    const base = {
      type: "title",
      v: 1,
      title: "",
      source: "auto",
      updatedAt: "2026-09-14T17:07:24.581Z",
      ...fields,
    };
    let pad = "";
    for (;;) {
      const rendered = JSON.stringify({ ...base, pad });
      const room = TITLE_SLOT_BYTES - 1 - Buffer.byteLength(rendered);
      if (room <= 0) return `${rendered}\n`;
      pad += " ".repeat(room);
    }
  }

  function write(name: string, content: string): string {
    const file = path.join(tmp, name);
    fs.writeFileSync(file, content);
    return file;
  }

  it("reads the title out of a full-width slot", () => {
    const content = slot({ title: "Run echo hello bash command" });
    expect(Buffer.byteLength(content)).toBe(TITLE_SLOT_BYTES);
    const file = write("titled.jsonl", content + `${user()}\n`);
    expect(readTitleSlot(file)).toBe("Run echo hello bash command");
  });

  it("reports null for an untitled slot, a short file, and a missing file", () => {
    expect(readTitleSlot(write("untitled.jsonl", slot({})))).toBeNull();
    expect(readTitleSlot(write("short.jsonl", '{"type":"title"'))).toBeNull();
    expect(readTitleSlot(path.join(tmp, "absent.jsonl"))).toBeNull();
  });
});

describe("deriveOmpInfo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-omp-info-"));
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const session = (file: string): OmpSession => ({
    id: "01a0a0e3-1843-701b-bfde-c9c816e3e92f",
    transcriptPath: file,
    startedAt: Date.now(),
  });

  it("folds the tail and adds the title slot", () => {
    const file = path.join(tmp, "live.jsonl");
    fs.writeFileSync(
      file,
      `${'{"type":"title","v":1,"title":"Fix the flake","pad":""}\n'}${[
        line({ type: "session", version: 3, id: "x", cwd: "/work" }),
        user(),
        assistant("toolUse", {
          usage: { input: 10, cacheRead: 5, cacheWrite: 1 },
        }),
      ].join("\n")}\n`,
    );
    expect(deriveOmpInfo(session(file))).toEqual({
      state: "tool_use",
      model: "deepseek-v4.1-flash",
      contextTokens: 16,
      summary: "Fix the flake",
      lastPromptId: "u-2026-09-14T17:07:20.000Z",
      lastPromptText: "hi",
    });
  });

  it("publishes nothing for a session file that is not on disk yet", () => {
    expect(deriveOmpInfo(session(path.join(tmp, "absent.jsonl")))).toBeNull();
  });
});

describe("deriveOmpState — the newest prompt, which a landed steer moves", () => {
  it("reads the newest user entry's id past a turn of tool calls, and moves when a steer lands", () => {
    const turn = [
      user("2026-11-15T22:37:00.000Z"),
      assistant("toolUse", {
        usage: { input: 1, cacheRead: 0, cacheWrite: 0 },
      }),
      toolResult(),
      assistant("toolUse"),
    ];
    expect(deriveOmpState(turn)?.lastPromptId).toBe(
      "u-2026-11-15T22:37:00.000Z",
    );
    expect(
      deriveOmpState([...turn, toolResult(), user("2026-11-15T22:37:07.023Z")])
        ?.lastPromptId,
    ).toBe("u-2026-11-15T22:37:07.023Z");
  });

  it("reads that entry's TEXT, which is what makes a landing THIS steer's", () => {
    expect(deriveOmpState([user()])?.lastPromptText).toBe("hi");
  });

  it("a prompt with no text part carries no text, rather than an empty one", () => {
    const imageOnly = line({
      type: "message",
      id: "u-image",
      parentId: null,
      timestamp: "2026-11-15T22:40:00.000Z",
      message: { role: "user", content: [{ type: "image", url: "x" }] },
    });
    expect(deriveOmpState([imageOnly])?.lastPromptText).toBeNull();
  });
});
