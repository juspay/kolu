/**
 * WHICH PROMPT A FRAME BELONGS TO, read where the frames are read.
 *
 * An agent runs its prompts one at a time, in the order they arrived, and
 * answers each when its turn is over. So the prompt a frame is about is the
 * OLDEST prompt sent and not yet answered at the point in the stream where the
 * frame was read — a fact about the ORDER of the wire and nothing else.
 *
 * It is worked out HERE, on the stream the SDK reads, because nowhere later
 * has the order any more. A turn's end reaches a caller as the return of the
 * call that sent it, which settles a promise; a frame reaches it as a handler
 * call. An agent that answers one prompt and speaks for the next in the same
 * breath puts both on the wire in that order, and the caller hears the second
 * turn's first words before it hears that the first turn is over — so a
 * caller that read "which turn is running" off its own awaited calls filed
 * those words under the turn that had already ended.
 *
 * HOW THE FACT TRAVELS. The caller names its prompt ({@link Agent.prompt}'s
 * `turn`); the name rides the outgoing request under {@link KEY} in `_meta`
 * and is taken off again here, before the request reaches the wire, so the
 * agent never sees it. Every frame that becomes a row — a `session/update`, a
 * permission request, an elicitation, and a frame of the agent's own task and
 * child channel ({@link ACTIVITY_METHOD}) — is stamped under the same key: the
 * name of the oldest prompt unanswered at the moment it was read, `null` when
 * NO prompt is unanswered, and nothing at all when the oldest one was sent
 * without a name — the one case where this end cannot say. The SDK keeps
 * `_meta` through its validation, so the handler reads the stamp off the
 * params it is handed ({@link answeringIn}).
 */

import { methods, type Stream } from "@agentclientprotocol/sdk";
import { ACTIVITY_METHOD } from "@kolu/acp";

/** Where the name rides, outgoing and incoming. Never sent to an agent. */
export const KEY = "acp-client/turn";

/** The methods whose frames become rows: what a caller files under a turn.
 *  Spelled through the SDK's own table, as the rest of this package is, so a
 *  protocol rename cannot leave frames unstamped without a word. */
const STAMPED: Record<string, true> = {
  [methods.client.session.update]: true,
  [methods.client.session.requestPermission]: true,
  [methods.client.elicitation.create]: true,
  [ACTIVITY_METHOD]: true,
};

type Message = Record<string, unknown>;

const isObject = (value: unknown): value is Message =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What a frame was stamped with: a prompt's name, `null` for "no prompt was
 *  unanswered", or `undefined` for "this end cannot say". */
export type Turn = string | null | undefined;

/** `params` with `_meta[KEY]` set to `turn`, or taken off for `undefined`. A
 *  `_meta` left empty is dropped, so an unstamped frame is the frame the agent
 *  sent. */
const stamped = (params: Message, turn: Turn): Message => {
  const meta = isObject(params._meta) ? params._meta : {};
  const { [KEY]: _gone, ...rest } = meta;
  const next = turn === undefined ? rest : { ...rest, [KEY]: turn };
  const { _meta: _old, ...without } = params;
  return Object.keys(next).length === 0 ? without : { ...without, _meta: next };
};

/** What a frame was stamped with, off the `_meta` its params carry. */
export const answeringIn = (meta: unknown): Turn => {
  if (!isObject(meta) || !(KEY in meta)) return undefined;
  const turn = meta[KEY];
  return typeof turn === "string" ? turn : turn === null ? null : undefined;
};

/**
 * The stream the SDK reads and writes, with every prompt's name followed from
 * the request that sent it to the answer that ended it.
 *
 * ONE PER CONNECTION: the prompts unanswered belong to one agent process, and
 * a new process starts with none.
 */
export const answering = (stream: Stream): Stream => {
  /** The prompts sent and not yet answered, oldest first, by request id. */
  const unanswered: Array<{ readonly id: unknown; readonly turn?: string }> =
    [];

  const outgoing = (message: Message): Message => {
    if (
      message.method !== methods.agent.session.prompt ||
      message.id === undefined
    )
      return message;
    const params = isObject(message.params) ? message.params : {};
    const turn = answeringIn(params._meta) ?? undefined;
    unanswered.push(
      turn === undefined ? { id: message.id } : { id: message.id, turn },
    );
    return { ...message, params: stamped(params, undefined) };
  };

  const incoming = (message: Message): Message => {
    if (message.method === undefined) {
      // AN ANSWER: if it is a prompt's, that prompt is over from here on.
      const at = unanswered.findIndex((one) => one.id === message.id);
      if (at !== -1) unanswered.splice(at, 1);
      return message;
    }
    if (typeof message.method !== "string" || STAMPED[message.method] !== true)
      return message;
    const params = isObject(message.params) ? message.params : {};
    const oldest = unanswered[0];
    return {
      ...message,
      params: stamped(params, oldest === undefined ? null : oldest.turn),
    };
  };

  const each = (
    message: unknown,
    one: (message: Message) => Message,
  ): unknown =>
    Array.isArray(message)
      ? message.map((item) => (isObject(item) ? one(item) : item))
      : isObject(message)
        ? one(message)
        : message;

  // A SINK THAT HANDS ON, rather than a pipe: the SDK awaits each write, and a
  // write that resolves only when the wire took it is what it awaits today. A
  // `TransformStream` would resolve on queueing and lose a broken pipe's error.
  const writer = stream.writable.getWriter();
  return {
    writable: new WritableStream({
      write: (message) =>
        writer.write(each(message, outgoing) as typeof message),
      close: () => writer.close(),
      abort: (reason) => writer.abort(reason),
    }),
    readable: stream.readable.pipeThrough(
      new TransformStream({
        transform(message, controller) {
          controller.enqueue(each(message, incoming) as typeof message);
        },
      }),
    ),
  };
};
