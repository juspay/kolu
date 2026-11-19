/**
 * LEGS TO TEST AGAINST — the two shapes an agent's wire comes in, spelled here
 * rather than borrowed from an engine.
 *
 * ## Why they are fixtures now
 *
 * The benches in this package used to reach for the REAL legs. They are not
 * reachable from here any more: an engine's readings live in that engine's own
 * package (`@kolu/acp-claude` is kolu's one), and a general package neither
 * imports one nor spells one.
 *
 * That is a better arrangement for these tests rather than a cost, and the
 * reason is what each of them is actually about. `Calls` is about REMEMBERING
 * what a frame said, not about the Claude Code adapter's `_meta` corner; the
 * chat's lifecycle cases are about a queued message and a withdrawn gesture, not
 * about opencode. Every one of them wants A LEG OF A CERTAIN SHAPE, and reading
 * the shape off a real engine made the case quietly depend on facts that engine
 * is free to change on its own release clock — which is the whole reason those
 * facts moved into that engine's directory.
 *
 * Each engine's OWN readings are asserted in its own package
 * (`packages/acp-claude/src/leg.test.ts` here), against payloads captured off
 * that engine's real wire. That is where a bet about an adapter belongs, and it
 * is where a bump of that adapter's pin goes red.
 */

import type { Leg, Meta, NativeActivity } from "@kolu/acp/engine";

/**
 * AN AGENT THAT SAYS NOTHING — every reader `null`, every capability absent.
 *
 * The floor the other two are built on, and a shape a real engine genuinely has:
 * a leg that recognises nothing matches nothing, and what happens then is that a
 * person is asked. **Nothing is ever approved by failing to recognise it**, so
 * the emptiest leg is also the safest one, which is why it is the base rather
 * than a special case.
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

/** The corner one adapter writes its two facts into — the shape, not the
 *  vendor's name for it: what matters to the cases that use this is that BOTH
 *  facts arrive on the frame, in one object, and that a frame may carry either
 *  half alone. */
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
 * The Claude Code adapter's shape: every `tool_call` carries the programmatic
 * name and, for a subagent's call, the id of the call that spawned it — and the
 * call id itself is opaque and says nothing. A frame may carry either half
 * alone, which is the case `Calls` exists to hold together.
 */
export const NAMES_IN_META: Leg = {
  ...SAYS_NOTHING,
  toolNameIn: (meta) => stringIn(meta, "toolName"),
  parentToolUse: (meta) => stringIn(meta, "parentToolUseId"),
};

/**
 * ...and ONE THAT NAMES THEM AT THE HEAD OF THE CALL ID.
 *
 * The shape two of the engines have: no `_meta` at all, and `<tool>:<n>`
 * as the id. The FIRST separator, and an id with none is a name this cannot
 * read rather than a guess — under-reading a name costs a question, where
 * over-reading one could cost an approval.
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
 * The third place a wire can put it: a `name` field beside the display title,
 * on the announcement and on the permission request alike, with an opaque id
 * and nothing in any corner. Believed only when it is a non-empty string —
 * what an agent's version of the field may be is the leg's answer, never the
 * registry's.
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
 * ...and ONE THAT HOLDS A PROMPT SENT WHILE IT IS BUSY.
 *
 * What the chat's own lifecycle cases need of a leg and the whole of it: an
 * agent that takes a mid-turn message and answers it in order, with no
 * interrupting gesture. The cases that use it are about what the PANEL
 * promises rather than about which agent is speaking — which is just as well,
 * because what the engines olai ships do with a busy send is now four
 * different things.
 */
export const QUEUES: Leg = { ...SAYS_NOTHING, queues: () => true };

/**
 * ...and ONE THAT RUNS ITS OWN CHILD SESSIONS.
 *
 * THE SHAPE AND NOTHING MORE: a dialect that claims nothing off the wire, for
 * the cases whose subject is what HAVING one changes rather than what any
 * agent's words are. Having one is what makes a call's remembered facts belong
 * to a session rather than to a conversation ({@link ../calls.ts}), which is
 * the claim those cases make; the channel's own behaviour is
 * {@link ../activity-protocol.test.ts}'s.
 */
export const OWN_SESSIONS: NativeActivity = {
  clientMeta: {},
  readIn: () => null,
};

/**
 * ...and ONE THAT FORWARDS ITS AGENT'S OWN MESSAGES.
 *
 * The one thing on any of these wires the PROTOCOL has no place for: what the
 * agent says about its own connections to the MCP servers this conversation was
 * handed, and which model a turn is running on. `session/new` takes a list of
 * servers and answers with a session id; whether the agent reached any of them
 * is never on the wire, so an agent that volunteers it does so on a channel of
 * its own.
 *
 * The channel and the payload here are MADE UP, matching `../fixtures/
 * stale-session-agent.ts`, and that is the point: what the bench that uses this
 * is about is a WINDOW in `agent.ts` — a forwarded message arriving for a
 * conversation that has already closed — which every forwarding wire has. One
 * engine's actual spelling is its own package's bench.
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
        // POSITIVE RECOGNITION, as every real leg keeps it: `attached` is true
        // only where the agent said so, and `said` is the agent's own word for
        // it carried through untouched.
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

/** The corner the fixture's forwarded message puts both facts in. */
const openedIn = (params: unknown): Record<string, unknown> | null => {
  const opened = (params as { readonly opened?: unknown } | null | undefined)
    ?.opened;
  return typeof opened === "object" && opened !== null
    ? (opened as Record<string, unknown>)
    : null;
};
