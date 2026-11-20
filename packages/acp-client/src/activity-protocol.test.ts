/**
 * The pinned SDK's unions are CLOSED: a `sessionUpdate` kind it has never
 * heard of fails validation before any callback can see it, and a
 * notification method it does not know is likewise not something a connected
 * app may ignore. So the proof has to run a real connection.
 */
import { expect, test } from "vitest";
import { client, methods, type Stream } from "@agentclientprotocol/sdk";
import {
  nativeActivity,
  type ActivityNotification,
  type NativeActivity,
} from "@kolu/acp";

const DIALECT: NativeActivity = {
  clientMeta: { fixture: { version: 1 } },
  readIn: (message) => {
    const envelope = message as {
      method?: string;
      id?: number;
      params?: Record<string, unknown>;
    };
    if (envelope.id !== undefined) return null;
    if (envelope.method === "fixture/nested") {
      const update = envelope.params?.["update"];
      return update === undefined
        ? null
        : {
            kind: "message",
            value: {
              jsonrpc: "2.0",
              method: "session/update",
              params: { sessionId: "child", update },
            },
          };
    }
    if (envelope.method !== "session/update") return null;
    const update = envelope.params?.["update"] as
      | { sessionUpdate?: string; id?: unknown }
      | undefined;
    if (
      update?.sessionUpdate !== "fixture_spawned" ||
      typeof update.id !== "string"
    )
      return null;
    return {
      kind: "activity",
      value: {
        session: String(envelope.params?.["sessionId"]),
        update: {
          kind: "child",
          id: update.id,
          name: "Explorer",
          task: "inspect",
        },
      },
    };
  },
};

interface Sent {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly id?: number;
  readonly params: Record<string, unknown>;
}

const update = (sessionId: string, value: unknown): Sent => ({
  jsonrpc: "2.0",
  method: "session/update",
  params: { sessionId, update: value },
});

const deliver = async (messages: ReadonlyArray<Sent>) => {
  const events: ActivityNotification[] = [];
  const ordinary: unknown[] = [];
  const app = client({ name: "activity-test" }).onNotification(
    methods.client.session.update,
    ({ params }) => {
      ordinary.push(params);
    },
  );
  const stream: Stream = {
    writable: new WritableStream(),
    readable: new ReadableStream({
      start(c) {
        for (const message of messages) c.enqueue(message);
        c.close();
      },
    }),
  };
  const protocol = nativeActivity(
    app,
    stream,
    (event) => events.push(event),
    DIALECT,
  );
  await app.connect(protocol.stream).closed;
  return { events, ordinary, clientMeta: protocol.clientMeta };
};

test("a dialect's own words leave the stream and the ordinary ones do not", async () => {
  const { events, ordinary, clientMeta } = await deliver([
    update("root", { sessionUpdate: "fixture_spawned", id: "child" }),
    update("root", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "root answer" },
    }),
  ]);
  expect(clientMeta).toEqual({ fixture: { version: 1 } });
  expect(events).toEqual([
    {
      session: "root",
      update: { kind: "child", id: "child", name: "Explorer", task: "inspect" },
    },
  ]);
  expect(ordinary).toHaveLength(1);
});

test("a frame the agent nested is delivered as the ordinary update it is, on the session it belongs to", async () => {
  const { events, ordinary } = await deliver([
    {
      jsonrpc: "2.0",
      method: "fixture/nested",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "child answer" },
        },
      },
    },
  ]);
  expect(events).toEqual([]);
  expect(ordinary).toEqual([
    {
      sessionId: "child",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "child answer" },
      },
    },
  ]);
});

test("a payload the dialect cannot read creates no activity and does not stop the connection", async () => {
  const { events, ordinary } = await deliver([
    update("root", { sessionUpdate: "fixture_spawned", id: 7 }),
    update("root", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "still connected" },
    }),
  ]);
  expect(events).toEqual([]);
  expect(ordinary).toHaveLength(1);
});

test("unknown updates and requests remain unchanged for the SDK to handle", async () => {
  const notification = update("root", { sessionUpdate: "future" });
  const request = {
    ...notification,
    id: 1,
    params: {
      sessionId: "root",
      update: { sessionUpdate: "fixture_spawned", id: "child" },
    },
  };
  const stream: Stream = {
    writable: new WritableStream(),
    readable: new ReadableStream({
      start(c) {
        c.enqueue(notification);
        c.enqueue(request);
        c.close();
      },
    }),
  };
  const protocol = nativeActivity(
    client({ name: "test" }),
    stream,
    () => {},
    DIALECT,
  );
  const read = protocol.stream.readable.getReader();
  expect((await read.read()).value).toEqual(notification);
  expect((await read.read()).value).toEqual(request);
});
