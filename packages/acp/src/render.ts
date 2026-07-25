/**
 * The tile's transcript: ACP traffic rendered human-readably.
 *
 * Every line this module emits is derived from something that crossed the ACP
 * wire — a `session/update` frame, a method call, or the proxy's own process
 * lifecycle. Nothing here reads a session file, a transcript log, or any agent
 * private state, which is what makes the tile a faithful view of the protocol
 * rather than a second, drifting source of truth.
 *
 * Formatting is pure (`formatEvent`); the only state is the open
 * message-chunk line, because agents stream text a token at a time and a line
 * per token would be unreadable.
 */

import type { SessionNotification } from "@zed-industries/agent-client-protocol";

type SessionUpdate = SessionNotification["update"];

/** Everything the tile can show. Lifecycle entries are the harness duties the
 *  proxy owns; the rest is protocol traffic in one direction or the other. */
export type ProxyEvent =
  | { kind: "listening"; socketPath: string }
  | { kind: "adapterSpawned"; command: string; args: string[]; pid: number }
  | { kind: "adapterReady"; agentName: string; protocolVersion: number }
  | { kind: "adapterExited"; code: number | null; signal: string | null }
  | { kind: "adapterRespawning"; attempt: number; delayMs: number }
  | { kind: "sessionReady"; sessionId: string }
  | { kind: "clientConnected"; clients: number }
  | { kind: "clientDisconnected"; clients: number }
  | { kind: "prompt"; text: string }
  | { kind: "update"; update: SessionUpdate }
  | { kind: "permissionAutoAnswered"; title: string; optionName: string }
  | { kind: "permissionUnanswerable"; title: string }
  | { kind: "cancelRequested" }
  | { kind: "cancelGraceExpired"; graceMs: number }
  | { kind: "turnEnded"; stopReason: string }
  | { kind: "turnFailed"; message: string };

/** Marker column: who spoke. `▶` into the adapter, `◀` out of it, `●` a turn
 *  boundary, `⎯` the harness talking about itself. */
const IN = "▶";
const OUT = "◀";
const TURN = "●";
const HARNESS = "⎯";

/** One line of text, collapsed — a tool title or message can carry newlines,
 *  and a transcript stays scannable only if one event is one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The human-meaningful text of a content block, if it has any. */
function contentText(content: { type: string; text?: string }): string {
  return content.type === "text" && content.text !== undefined
    ? oneLine(content.text)
    : `<${content.type}>`;
}

/**
 * A streamed fragment, folded onto one line but *not* trimmed.
 *
 * Agents stream text a token at a time, and the spaces between words arrive
 * inside those fragments — `"It's a "`, `"port "`, `"collision."`. Trimming
 * each one welds the sentence into `It's aportcollision.`
 */
function chunkText(content: { type: string; text?: string }): string {
  return content.type === "text" && content.text !== undefined
    ? content.text.replace(/[\r\n\t]+/g, " ")
    : `<${content.type}>`;
}

/** A `session/update` frame as one line. Returns null for the frame kind that
 *  streams — message chunks are appended to an open line instead. */
export function formatUpdate(update: SessionUpdate): string | null {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return null;
    case "user_message_chunk":
      return `${IN} user_message_chunk · ${contentText(update.content)}`;
    case "agent_thought_chunk":
      return `${OUT} agent_thought_chunk · ${contentText(update.content)}`;
    case "tool_call":
      return `${OUT} tool_call · ${update.kind ?? "other"} — ${oneLine(update.title)}`;
    case "tool_call_update":
      return `${OUT} tool_call_update · ${update.status ?? "in_progress"}${
        update.title ? ` — ${oneLine(update.title)}` : ""
      }`;
    case "plan":
      return `${OUT} plan · ${update.entries.length} entries`;
    case "available_commands_update":
      return `${OUT} available_commands_update · ${update.availableCommands.length} commands`;
    case "current_mode_update":
      return `${OUT} current_mode_update · ${update.currentModeId}`;
  }
}

/** Everything that is not a streaming chunk, as one line. */
export function formatEvent(event: ProxyEvent): string | null {
  switch (event.kind) {
    case "listening":
      return `${HARNESS} listening · ${event.socketPath}`;
    case "adapterSpawned":
      return `${HARNESS} adapter spawned · ${[event.command, ...event.args].join(" ")} (pid ${event.pid})`;
    case "adapterReady":
      return `${HARNESS} adapter ready · ${event.agentName} · protocol v${event.protocolVersion}`;
    case "adapterExited":
      return `${HARNESS} adapter exited · ${event.signal ? `signal ${event.signal}` : `code ${event.code}`}`;
    case "adapterRespawning":
      return `${HARNESS} respawning adapter · attempt ${event.attempt} in ${event.delayMs}ms`;
    case "sessionReady":
      return `${HARNESS} session ready · ${event.sessionId}`;
    case "clientConnected":
      return `${HARNESS} client connected · ${event.clients} attached`;
    case "clientDisconnected":
      return `${HARNESS} client disconnected · ${event.clients} attached`;
    case "prompt":
      return `${IN} session/prompt · "${oneLine(event.text)}"`;
    case "update":
      return formatUpdate(event.update);
    case "permissionAutoAnswered":
      return `${OUT} session/request_permission · ${oneLine(event.title)} → auto-answered ${event.optionName}`;
    case "permissionUnanswerable":
      return `${OUT} session/request_permission · ${oneLine(event.title)} → NO allow_once option; refused`;
    case "cancelRequested":
      return `${IN} session/cancel`;
    case "cancelGraceExpired":
      return `${HARNESS} cancel grace expired after ${event.graceMs}ms · killing adapter`;
    case "turnEnded":
      return `${TURN} turn end · stopReason: ${event.stopReason}`;
    case "turnFailed":
      return `${TURN} turn failed · ${oneLine(event.message)}`;
  }
}

/**
 * Streams events to a sink, coalescing `agent_message_chunk` frames into one
 * growing line so the tile reads like a conversation instead of a token dump.
 */
export class TranscriptRenderer {
  #out: (text: string) => void;
  #chunkLineOpen = false;

  constructor(out: (text: string) => void) {
    this.#out = out;
  }

  event(event: ProxyEvent): void {
    if (
      event.kind === "update" &&
      event.update.sessionUpdate === "agent_message_chunk"
    ) {
      const text = chunkText(event.update.content);
      if (!this.#chunkLineOpen) {
        this.#out(`${OUT} agent_message_chunk · `);
        this.#chunkLineOpen = true;
      }
      this.#out(text);
      return;
    }
    const line = formatEvent(event);
    if (line === null) return;
    this.#closeChunkLine();
    this.#out(`${line}\n`);
  }

  #closeChunkLine(): void {
    if (!this.#chunkLineOpen) return;
    this.#out("\n");
    this.#chunkLineOpen = false;
  }
}
