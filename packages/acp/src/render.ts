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

import { stripVTControlCharacters } from "node:util";
import type { ProxyEvent, SessionUpdate } from "./events.ts";

/** Marker column: who spoke. `▶` into the adapter, `◀` out of it, `●` a turn
 *  boundary, `⎯` the harness talking about itself. */
const IN = "▶";
const OUT = "◀";
const TURN = "●";
const HARNESS = "⎯";

/**
 * Everything rendered here is written by the *agent* — tool titles, message
 * text, an error's reason — and it lands on a terminal. An escape sequence in a
 * frame would let a careless or hostile agent repaint the transcript that is
 * supposed to be reporting on it, so control characters are stripped before
 * anything else: `\s` is whitespace only and does not cover `\x1b`, C0 or C1.
 *
 * The same call the repo already made for the same shape — see `plainDiagnostic`
 * in `@kolu/port-forward`, whose strings are likewise rendered verbatim by a TUI.
 */
function plain(text: string): string {
  return stripVTControlCharacters(text).replace(CONTROL_CHARACTERS, " ");
}

// Everything C0/C1 except tab, newline and carriage return, which the line
// folding below handles as ordinary whitespace.
const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** One line of text, collapsed — a tool title or message can carry newlines,
 *  and a transcript stays scannable only if one event is one line. */
function oneLine(text: string): string {
  return plain(text).replace(/\s+/g, " ").trim();
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
    ? plain(content.text).replace(/[\r\n\t]+/g, " ")
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
    case "adapterSilent":
      return `${HARNESS} adapter silent for ${event.afterMs}ms · ${oneLine(event.command)} has not answered initialize — if it is not an ACP adapter (try \`claude-agent-acp\`, not \`claude\`) this will time out`;
    case "adapterReady":
      return `${HARNESS} adapter ready · ${event.agentName} · protocol v${event.protocolVersion}`;
    case "adapterExited":
      return `${HARNESS} adapter exited · ${event.signal ? `signal ${event.signal}` : `code ${event.code}`}`;
    case "adapterFailedToStart":
      return `${HARNESS} adapter failed to start · ${oneLine(event.message)}`;
    case "adapterLost":
      return `${HARNESS} adapter lost · ${oneLine(event.message)}`;
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
    case "harnessError":
      return `${HARNESS} harness error · ${oneLine(event.message)}`;
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
