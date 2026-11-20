import type { Leg, Meta, NativeActivity } from "@kolu/acp/engine";

/**
 * AN AGENT THAT SAYS NOTHING — every reader `null`, every capability absent.
 * A leg that recognises nothing matches nothing, and what happens then is
 * that a person is asked.
 */
export const SAYS_NOTHING: Leg = {
  spelling: null,
  mcpCall: () => [],
  replyIn: () => undefined,
  toolNameIn: () => null,
  toolNameOf: () => null,
  allowedWithoutAsking: () => null,
  parentToolUse: () => null,
  spawned: () => null,
  backgroundTask: () => null,
  taskNotification: () => null,
  listedIn: () => null,
  prologueIn: () => null,
  bypassMode: null,
  steering: null,
  queues: () => false,
  rawMessages: null,
  models: null,
};

const cornerOf = (meta: Meta): Record<string, unknown> | null => {
  const corner = (meta as { readonly corner?: unknown } | null | undefined)
    ?.corner;
  return typeof corner === "object" && corner !== null
    ? (corner as Record<string, unknown>)
    : null;
};

const stringIn = (meta: Meta, field: string): string | null => {
  const value = cornerOf(meta)?.[field];
  return typeof value === "string" && value !== "" ? value : null;
};

/**
 * ...ONE THAT NAMES ITS TOOLS IN A `_meta` CORNER, and attributes them.
 *
 * Every `tool_call` carries the programmatic name and, for a subagent's call,
 * the id of the call that spawned it — and the call id itself is opaque and
 * says nothing. A frame may carry either half alone.
 */
export const NAMES_IN_META: Leg = {
  ...SAYS_NOTHING,
  toolNameIn: (meta) => stringIn(meta, "toolName"),
  parentToolUse: (meta) => stringIn(meta, "parentToolUseId"),
};

/**
 * ...and ONE THAT NAMES THEM AT THE HEAD OF THE CALL ID.
 *
 * No `_meta` at all, and `<tool>:<n>` as the id. The FIRST separator, and an
 * id with none is a name this cannot read rather than a guess.
 */
export const NAMES_IN_ID: Leg = {
  ...SAYS_NOTHING,
  toolNameOf: (toolCallId) => {
    const at = toolCallId.indexOf(":");
    return at <= 0 ? null : toolCallId.slice(0, at);
  },
};

/**
 * ...and ONE THAT NAMES THEM ON THE FRAME ITSELF.
 *
 * A `name` field beside the display title, on the announcement and on the
 * permission request alike, with an opaque id and nothing in any corner.
 * Believed only when it is a non-empty string.
 */
export const NAMES_ON_FRAME: Leg = {
  ...SAYS_NOTHING,
  toolNameIn: (_meta, frame) => {
    const named =
      frame !== null && typeof frame === "object"
        ? (frame as { name?: unknown }).name
        : undefined;
    return typeof named === "string" && named !== "" ? named : null;
  },
};

/**
 * ...and ONE THAT HOLDS A PROMPT SENT WHILE IT IS BUSY: an agent that takes a
 * mid-turn message and answers it in order, with no interrupting gesture.
 */
export const QUEUES: Leg = { ...SAYS_NOTHING, queues: () => true };

/**
 * ...and ONE THAT RUNS ITS OWN CHILD SESSIONS.
 *
 * THE SHAPE AND NOTHING MORE: a dialect that claims nothing off the wire.
 */
export const OWN_SESSIONS: NativeActivity = {
  clientMeta: {},
  readIn: () => null,
};

/**
 * ...and ONE THAT FORWARDS ITS AGENT'S OWN MESSAGES: what the agent says about
 * its own connections to the MCP servers this conversation was handed, and
 * which model a turn is running on, on a channel of its own.
 */
export const FORWARDS: Leg = {
  ...SAYS_NOTHING,
  rawMessages: {
    openMeta: { forward: true },
    method: "_x/agentMessage",
    modelIn: (params) => {
      const model = openedIn(params)?.["model"];
      return typeof model === "string" && model !== "" ? model : null;
    },
    serversIn: (params) => {
      const servers = openedIn(params)?.["servers"];
      if (!Array.isArray(servers)) return null;
      return servers.flatMap((entry) => {
        const shape = entry as {
          readonly name?: unknown;
          readonly live?: unknown;
        } | null;
        return typeof shape?.name === "string" && shape.name !== ""
          ? [
              {
                name: shape.name,
                attached: shape.live === true,
                said: String(shape.live),
              },
            ]
          : [];
      });
    },
  },
};

const openedIn = (params: unknown): Record<string, unknown> | null => {
  const opened = (params as { readonly opened?: unknown } | null | undefined)
    ?.opened;
  return typeof opened === "object" && opened !== null
    ? (opened as Record<string, unknown>)
    : null;
};
