import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { createEngine } from "./bin.ts";
import type { CoordinatorDriver } from "./coordinator.ts";
import { Inbox } from "./inbox.ts";
import type { XyneApi } from "./xyneApi.ts";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
async function drain(inbox: Inbox): Promise<void> {
  while (inbox.depth > 0) await tick();
  await tick();
}

interface Recorder {
  api: XyneApi;
  post: Array<{ conversationId: string; content: string; messageId: string }>;
  update: Array<{ messageId: string; content: string }>;
  progress: Array<{ conversationId: string; inProgress: boolean }>;
  store: Map<string, string>;
}

function fakeXyne(
  user: (id: string) => { name: string | null; email: string | null },
): Recorder {
  const post: Recorder["post"] = [];
  const update: Recorder["update"] = [];
  const progress: Recorder["progress"] = [];
  const store = new Map<string, string>();
  let seq = 0;
  const api: XyneApi = {
    async postMessage({ conversationId, content }) {
      const messageId = `m${++seq}`;
      store.set(messageId, content);
      post.push({ conversationId, content, messageId });
      return { messageId };
    },
    async updateMessage({ messageId, content }) {
      store.set(messageId, content);
      update.push({ messageId, content });
    },
    async agentProgress({ conversationId, inProgress }) {
      progress.push({ conversationId, inProgress });
    },
    async getUserInfo(id) {
      return user(id);
    },
  };
  return { api, post, update, progress, store };
}

const OPERATORS = ["srid@srid.ca"];
const log = pino({ level: "silent" });
const asOperator = () => ({ name: "Sridhar", email: "srid@srid.ca" });
const asStranger = () => ({ name: "Nobody", email: "nobody@example.com" });

function appMention(text: string, extra: Record<string, unknown> = {}) {
  return {
    eventType: "APP_MENTIONED",
    payload: {
      conversationId: "c1",
      userId: "u1",
      cleanContent: text,
      ...extra,
    },
  };
}

describe("engine — the decline-or-relay turn flow", () => {
  it("declines a non-operator visibly and never relays a turn", async () => {
    const rec = fakeXyne(asStranger);
    const inbox = new Inbox();
    const driver: CoordinatorDriver = {
      runTurn: vi.fn(async () => "unreachable"),
    };
    const engine = createEngine({
      log,
      xyne: rec.api,
      driver,
      inbox,
      operatorEmails: OPERATORS,
    });

    await engine.handleEvent(
      appMention("do something", { senderName: "Nobody" }),
    );
    await drain(inbox);

    expect(rec.post).toHaveLength(1);
    expect(rec.post[0]?.content).toMatch(/not on pesu's operator allowlist/);
    expect(driver.runTurn).not.toHaveBeenCalled();
    expect(rec.progress).toHaveLength(0); // no typing indicator for a decline
  });

  it("relays an operator turn: attributed prompt, typing on/off, post-once-then-update", async () => {
    const rec = fakeXyne(asOperator);
    const inbox = new Inbox();
    let seenPrompt = "";
    const driver: CoordinatorDriver = {
      async runTurn(prompt, onGrow) {
        seenPrompt = prompt;
        onGrow("hel");
        onGrow("hello");
        return "hello world";
      },
    };
    const engine = createEngine({
      log,
      xyne: rec.api,
      driver,
      inbox,
      operatorEmails: OPERATORS,
      minUpdateIntervalMs: 0,
    });

    await engine.handleEvent(
      appMention("make it a chat log", { senderName: "Sridhar" }),
    );
    await drain(inbox);

    expect(seenPrompt).toBe("from Sridhar: make it a chat log");
    expect(rec.progress).toEqual([
      { conversationId: "c1", inProgress: true },
      { conversationId: "c1", inProgress: false },
    ]);
    // Posted ONCE; the growing reply lands as in-place updates.
    expect(rec.post).toHaveLength(1);
    const id = rec.post[0]?.messageId ?? "";
    expect(rec.store.get(id)).toBe("hello world");
    expect(rec.update.length).toBeGreaterThanOrEqual(1);
  });

  it("splits a reply past the 40k cap across multiple messages", async () => {
    const rec = fakeXyne(asOperator);
    const inbox = new Inbox();
    const big = "z".repeat(45000);
    const driver: CoordinatorDriver = {
      async runTurn() {
        return big;
      },
    };
    const engine = createEngine({
      log,
      xyne: rec.api,
      driver,
      inbox,
      operatorEmails: OPERATORS,
      minUpdateIntervalMs: 0,
    });

    await engine.handleEvent(appMention("dump it", { senderName: "Sridhar" }));
    await drain(inbox);

    // The placeholder message becomes chunk 0; the overflow is a second message.
    expect(rec.post).toHaveLength(2);
    const joined = rec.post
      .map((p) => rec.store.get(p.messageId) ?? "")
      .join("");
    expect(joined).toBe(big);
  });

  it("surfaces a fault as a visible reply and still clears typing (never silence)", async () => {
    const rec = fakeXyne(asOperator);
    const inbox = new Inbox();
    const driver: CoordinatorDriver = {
      async runTurn() {
        throw new Error("coordinator not found");
      },
    };
    const engine = createEngine({
      log,
      xyne: rec.api,
      driver,
      inbox,
      operatorEmails: OPERATORS,
      minUpdateIntervalMs: 0,
    });

    await engine.handleEvent(appMention("go", { senderName: "Sridhar" }));
    await drain(inbox);

    const id = rec.post[0]?.messageId ?? "";
    expect(rec.store.get(id)).toMatch(/⚠️ coordinator not found/);
    expect(rec.progress.at(-1)).toEqual({
      conversationId: "c1",
      inProgress: false,
    });
  });

  it("ignores USER_MENTIONED and unknown event types", async () => {
    const rec = fakeXyne(asOperator);
    const inbox = new Inbox();
    const driver: CoordinatorDriver = { runTurn: vi.fn(async () => "x") };
    const engine = createEngine({
      log,
      xyne: rec.api,
      driver,
      inbox,
      operatorEmails: OPERATORS,
    });

    await engine.handleEvent({
      eventType: "USER_MENTIONED",
      payload: { conversationId: "c1", userId: "u1" },
    });
    await engine.handleEvent({
      eventType: "SOMETHING_ELSE",
      payload: { conversationId: "c1" },
    });
    await drain(inbox);

    expect(rec.post).toHaveLength(0);
    expect(driver.runTurn).not.toHaveBeenCalled();
  });

  it("handles two operator turns in FIFO order, one at a time", async () => {
    const rec = fakeXyne(asOperator);
    const inbox = new Inbox();
    const order: string[] = [];
    const driver: CoordinatorDriver = {
      async runTurn(prompt) {
        order.push(`start:${prompt}`);
        await tick();
        order.push(`end:${prompt}`);
        return "ok";
      },
    };
    const engine = createEngine({
      log,
      xyne: rec.api,
      driver,
      inbox,
      operatorEmails: OPERATORS,
      minUpdateIntervalMs: 0,
    });

    await engine.handleEvent(appMention("first", { senderName: "Sridhar" }));
    await engine.handleEvent(appMention("second", { senderName: "Sridhar" }));
    await drain(inbox);

    expect(order).toEqual([
      "start:from Sridhar: first",
      "end:from Sridhar: first",
      "start:from Sridhar: second",
      "end:from Sridhar: second",
    ]);
  });
});
