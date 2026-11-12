/**
 * THE CHANNEL AN AGENT RUNS ITS OWN CHILD SESSIONS AND BACKGROUND TASKS ON —
 * as one door, with the wire SPELLING supplied by whoever speaks it.
 *
 * Core ACP has no place for either fact. An agent that sends another agent out,
 * or arms a task that outlives the turn, says so in an extension of its own:
 * codex-acp's AIR v1 writes five `sessionUpdate` kinds into the ordinary
 * session stream, opencode 2 sends a notification of its own with the child's
 * frames nested inside it. Both are the same two lifecycles underneath, which
 * is why {@link ActivityUpdate} is one union and not one per agent.
 *
 * WHAT IS HERE is the half that is nobody's agent in particular: the union,
 * the extension method the rest of the reader listens on, and the stream
 * surgery that keeps an unknown update out of the pinned SDK's closed one.
 * WHAT IS NOT is any agent's words — those are a {@link NativeActivity},
 * declared by the integration that owns that agent, exactly as every other
 * reading of one agent's spelling is ({@link ./leg.ts}).
 *
 * That split is why this file names no agent. It used to name one: AIR's five
 * words were written here, so the second agent to grow child sessions could
 * only be served by a branch in a general package. Row policy — what a child
 * session IS to a transcript — stays the chat reader's either way.
 */
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

/**
 * What ONE message the agent sent turned out to be.
 *
 * `null` from a dialect is the ordinary answer and means *not mine* — the
 * message travels on untouched, which is what nearly every frame of every
 * conversation does.
 */
export type Heard =
  /** A lifecycle fact, already validated by the dialect that read it. The
   *  message itself is consumed: nothing downstream sees it. */
  | { readonly kind: "activity"; readonly value: ActivityNotification }
  /** The same message in this package's own spelling — an agent that nests a
   *  child's ordinary frames inside an envelope unwraps them here, and one
   *  that stamps a request with a session other than the one it belongs to
   *  corrects it. What is enqueued is this value rather than the original. */
  | { readonly kind: "message"; readonly value: unknown };

/**
 * ONE AGENT'S SPELLING of the channel — data and pure functions, like every
 * other per-agent reading.
 *
 * A dialect is DECLARED BY AN INTEGRATION and handed over on its
 * {@link ./leg.ts}'s `nativeActivity`. Nothing here starts anything or
 * remembers anything: {@link NativeActivity.readIn} is called once per
 * incoming message and answers what that message was.
 */
export interface NativeActivity {
  /**
   * What this client has to SAY ABOUT ITSELF at `initialize` before the agent
   * will open the channel, merged into `clientCapabilities._meta`.
   *
   * Asked for rather than assumed, because one of these agents sends nothing
   * until it is asked: opencode 2 reads
   * `clientCapabilities._meta["opencode/child-session-updates"]` and, without
   * it, flattens a subagent's frames into the parent's stream where no
   * lifecycle survives to draw a lane with.
   */
  readonly clientMeta: { readonly [key: string]: unknown };
  /** What one message the agent sent was — see {@link Heard}. */
  readonly readIn: (message: unknown) => Heard | null;
}

/** The method the rest of the reader listens on. A client-side spelling on
 *  purpose: what reaches it has already been read by a dialect, so no agent's
 *  words travel past this point. */
const METHOD = "_kolu/session_activity";

/**
 * Install the complete extension channel before connecting.
 *
 * The READABLE side is rewritten rather than merely watched, and that is the
 * pinned SDK's doing: its `session/update` union is closed, so an update kind
 * it has never heard of is a validation failure rather than a message. A
 * dialect's own notification method is not in the SDK's table at all, and an
 * unknown method is likewise not something a connected app may simply ignore.
 * So anything a dialect claims leaves the stream here, as this method, and
 * everything else travels on with the SDK's validation and behaviour intact.
 */
export const nativeActivity = (
  app: ClientApp,
  stream: Stream,
  receive: (value: ActivityNotification) => void,
  dialect: NativeActivity,
) => {
  app.onNotification(
    METHOD,
    // Already validated by the dialect that read it; this is the SDK's door
    // and the value went through it unchanged.
    (params: unknown) => params as ActivityNotification | null,
    ({ params }) => {
      if (params !== null) receive(params);
    },
  );
  return {
    clientMeta: dialect.clientMeta,
    stream: {
      writable: stream.writable,
      readable: stream.readable.pipeThrough(
        new TransformStream({
          transform(message, controller) {
            const heard = dialect.readIn(message);
            if (heard === null) return controller.enqueue(message);
            // The SDK's stream carries its own message union, and a dialect
            // hands back a plain object. Asserted rather than validated
            // because what a dialect may do is bounded by `Heard`: unwrap a
            // frame the agent already sent through this stream, or correct one
            // field of it. Either way it is a message this connection
            // produced, and the SDK validates its contents at the far end
            // exactly as it validates an untouched one.
            const rewritten = (
              heard.kind === "message"
                ? heard.value
                : { jsonrpc: "2.0", method: METHOD, params: heard.value }
            ) as typeof message;
            controller.enqueue(rewritten);
          },
        }),
      ),
    } satisfies Stream,
  };
};
