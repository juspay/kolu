/** codex-acp's native child sessions and AIR v1 async tasks. Wire spelling,
 * negotiation, and the temporary closed-SDK-union workaround belong together.
 * Consumers receive validated values, independent of those spellings. */
import type { ClientApp, Stream } from "@agentclientprotocol/sdk";

export type ActivityUpdate =
  | {
      readonly kind: "child";
      readonly id: string;
      readonly name: string;
      readonly task: string;
    }
  | {
      readonly kind: "childEnded";
      readonly id: string;
      readonly state: "completed" | "failed" | "cancelled" | "disconnected";
    }
  | {
      readonly kind: "task";
      readonly id: string;
      readonly name: string;
      readonly description?: string;
      readonly tool?: string;
    }
  | {
      readonly kind: "taskProgress";
      readonly id: string;
      readonly description?: string;
      readonly summary?: string;
    }
  | {
      readonly kind: "taskEnded";
      readonly id: string;
      readonly state: "completed" | "failed" | "stopped";
      readonly summary?: string;
    };
export interface ActivityNotification {
  readonly session: string;
  readonly update: ActivityUpdate;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const readers: Readonly<
  Record<string, (value: unknown) => ActivityUpdate | null>
> = {
  subagent_spawned: (v) => {
    const id = text(field(v, "subagentSessionId")),
      name = text(field(v, "name")),
      task = text(field(v, "task"));
    return id && name !== undefined && task !== undefined
      ? { kind: "child", id, name, task }
      : null;
  },
  subagent_state_update: (v) => {
    const id = text(field(v, "subagentSessionId"));
    const state = (
      ["completed", "failed", "cancelled", "disconnected"] as const
    ).find((s) => s === field(v, "state"));
    return id && state ? { kind: "childEnded", id, state } : null;
  },
  async_task_spawned: (v) => {
    const id = text(field(v, "asyncTaskId")),
      name = text(field(v, "name"));
    return id && name !== undefined
      ? {
          kind: "task",
          id,
          name,
          description: text(field(v, "description")),
          tool: text(field(v, "toolCallId")),
        }
      : null;
  },
  async_task_progress: (v) => {
    const id = text(field(v, "asyncTaskId"));
    return id
      ? {
          kind: "taskProgress",
          id,
          description: text(field(v, "description")),
          summary: text(field(v, "summary")),
        }
      : null;
  },
  async_task_state_update: (v) => {
    const id = text(field(v, "asyncTaskId"));
    const state = (["completed", "failed", "stopped"] as const).find(
      (s) => s === field(v, "state"),
    );
    return id && state
      ? { kind: "taskEnded", id, state, summary: text(field(v, "summary")) }
      : null;
  },
};
const reader = (update: unknown) => {
  const kind = field(update, "sessionUpdate");
  return typeof kind === "string" && Object.hasOwn(readers, kind)
    ? readers[kind]
    : undefined;
};
const notification = (value: unknown): ActivityNotification | null => {
  const session = text(field(value, "sessionId")),
    raw = field(value, "update");
  const update = reader(raw)?.(raw);
  return session && update ? { session, update } : null;
};
const METHOD = "_kolu/session_activity";

/** Install the complete extension channel before connecting. Only the five
 * known notifications bypass the SDK's old union; requests and other updates
 * retain the SDK's validation and behavior. */
export const nativeActivity = (
  app: ClientApp,
  stream: Stream,
  receive: (value: ActivityNotification) => void,
) => {
  app.onNotification(METHOD, notification, ({ params }) => {
    if (params !== null) receive(params);
  });
  return {
    clientMeta: {
      jetbrains: {
        air: {
          version: 1,
          capabilities: ["nativeSubagentSessions", "asyncTasks"],
        },
      },
    },
    stream: {
      writable: stream.writable,
      readable: stream.readable.pipeThrough(
        new TransformStream({
          transform(message, controller) {
            controller.enqueue(
              field(message, "method") === "session/update" &&
                !("id" in message) &&
                reader(field(field(message, "params"), "update"))
                ? { ...message, method: METHOD }
                : message,
            );
          },
        }),
      ),
    } satisfies Stream,
  };
};
