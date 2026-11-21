import type { Stream } from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";
import { ACTIVITY_METHOD } from "@kolu/acp";
import { answering, answeringIn, KEY, type Turn } from "./answering.ts";

type Message = Record<string, unknown>;

/** One side of a connection: what the wrapped stream wrote to the agent, and
 *  a way to hand it what the agent says. */
const wire = () => {
  const sent: Message[] = [];
  let say!: (message: Message) => void;
  const readable = new ReadableStream<Message>({
    start(controller) {
      say = (message) => controller.enqueue(message);
    },
  });
  const writable = new WritableStream<Message>({
    write(message) {
      sent.push(message);
    },
  });
  const stream = answering({ readable, writable } as unknown as Stream);
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  return {
    sent,
    write: (message: Message) => writer.write(message as never),
    /** What the agent says, as the SDK reads it. */
    hear: async (message: Message): Promise<Message> => {
      say(message);
      const { value } = await reader.read();
      return value as unknown as Message;
    },
  };
};

const prompt = (id: number, turn: string): Message => ({
  jsonrpc: "2.0",
  id,
  method: "session/prompt",
  params: { sessionId: "s", prompt: [], _meta: { [KEY]: turn } },
});

const chunk = (text: string): Message => ({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "s",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  },
});

const turnOf = (message: Message): Turn =>
  answeringIn((message.params as Message)._meta);

describe("which prompt a frame belongs to", () => {
  test("the agent never sees the name a prompt was given", async () => {
    const one = wire();
    await one.write(prompt(1, "user:1"));
    expect(one.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "session/prompt",
        params: { sessionId: "s", prompt: [] },
      },
    ]);
  });

  test("a frame read after a prompt's answer belongs to the next prompt", async () => {
    const one = wire();
    await one.write(prompt(1, "user:1"));
    await one.write(prompt(2, "user:3"));
    expect(turnOf(await one.hear(chunk("A")))).toBe("user:1");
    await one.hear({
      jsonrpc: "2.0",
      id: 1,
      result: { stopReason: "end_turn" },
    });
    expect(turnOf(await one.hear(chunk("B")))).toBe("user:3");
    await one.hear({
      jsonrpc: "2.0",
      id: 2,
      result: { stopReason: "end_turn" },
    });
    // Nothing unanswered: a frame that belongs to no prompt SAYS so, with
    // `null`, whatever the agent wrote under the same key itself.
    const late = chunk("late");
    (late.params as Message)._meta = { [KEY]: "forged", other: 1 };
    expect((await one.hear(late)).params).toEqual({
      ...(chunk("late").params as Message),
      _meta: { other: 1, [KEY]: null },
    });
  });

  test("a frame of the agent's own task channel is stamped like any other", async () => {
    const one = wire();
    await one.write(prompt(1, "user:1"));
    const heard = await one.hear({
      jsonrpc: "2.0",
      method: ACTIVITY_METHOD,
      params: { session: "s", update: { kind: "task", id: "t", name: "n" } },
    });
    expect(turnOf(heard)).toBe("user:1");
  });

  test("a prompt sent without a name leaves its frames saying nothing, not none", async () => {
    const one = wire();
    const { _meta: _unnamed, ...bare } = prompt(1, "user:1").params as Message;
    await one.write({ ...prompt(1, "user:1"), params: bare });
    expect(turnOf(await one.hear(chunk("A")))).toBeUndefined();
  });
});
