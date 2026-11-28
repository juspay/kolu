/** One-shot transcript loader for the HTML export.
 *
 *  Reads the conversation's `transcript.jsonl` into the shared IR:
 *
 *   - `USER_INPUT` — the user's words: the text inside its `<USER_REQUEST>`
 *     block (the line also carries metadata blocks `agy` adds, left out).
 *   - `PLANNER_RESPONSE` — the model's answer: its `content` as text, or one
 *     tool call per `tool_calls` entry. Tool arguments are stored as JSON
 *     literals in strings (`"\"echo hi\""`, `"true"`) and are decoded here.
 *   - `GENERIC` — a tool's result; status `ERROR` marks it an error.
 *   - `SYSTEM_MESSAGE` — `agy`'s own notes to the model, left out.
 *
 *  `agy` stores no tool-call ids, so calls and results pair by order only. */

import fs from "node:fs";
import { UUID_RE } from "anyagent";
import {
  type Fetcher,
  parseIsoTimestamp,
  type ToolInput,
  type Transcript,
  type TranscriptEvent,
} from "kolu-transcript-core";
import { transcriptPathFor } from "./config.ts";
import { antigravityVocab } from "./schemas.ts";

const OPEN_TAG = "<USER_REQUEST>";
const CLOSE_TAG = "</USER_REQUEST>";

/** The user's own words in a `USER_INPUT` line, or null when it carries no
 *  `USER_REQUEST` block. The newline `agy` puts inside each tag is dropped.
 *  Plain index scans, linear in the line's length whatever it holds. */
export function userRequestText(content: string): string | null {
  const open = content.indexOf(OPEN_TAG);
  if (open === -1) return null;
  let from = open + OPEN_TAG.length;
  let to = content.indexOf(CLOSE_TAG, from);
  if (to === -1) return null;
  if (content[from] === "\n") from++;
  if (to > from && content[to - 1] === "\n") to--;
  return content.slice(from, to);
}

/** Each argument value decoded from the JSON literal `agy` stores it as. A
 *  value that is not one is kept as written. */
function decodeArgs(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args))
    return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    try {
      out[key] = JSON.parse(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/** Map an `agy` tool call onto the IR's typed inputs. Tools seen in use:
 *  `run_command`, `write_file`, `read_file`; everything else is `unknown`. */
export function normalizeAntigravityToolInput(
  toolName: string,
  rawArgs: unknown,
): ToolInput {
  const args = decodeArgs(rawArgs);
  const str = (key: string): string | null => {
    const value = args[key];
    return typeof value === "string" ? value : null;
  };
  switch (toolName) {
    case "run_command": {
      const command = str("CommandLine");
      if (command !== null) return { kind: "bash", command };
      break;
    }
    case "read_file": {
      const filePath = str("Path");
      if (filePath !== null) return { kind: "read", filePath };
      break;
    }
    case "write_file": {
      // An append is not a whole-file write; only `Append: false` is one.
      const filePath = str("Path");
      const content = str("Content");
      if (filePath !== null && content !== null && args.Append === false)
        return { kind: "write", filePath, content };
      break;
    }
  }
  return { kind: "unknown", toolName, raw: args };
}

/** Convert one transcript line into zero or more IR events. */
export function eventsFromAntigravityLine(line: unknown): TranscriptEvent[] {
  if (line === null || typeof line !== "object") return [];
  const entry: Record<string, unknown> = { ...line };
  const ts =
    typeof entry.created_at === "string"
      ? parseIsoTimestamp(entry.created_at)
      : null;
  const content = typeof entry.content === "string" ? entry.content : null;
  switch (entry.type) {
    case "USER_INPUT": {
      const text = content === null ? null : userRequestText(content);
      return text?.trim() ? [{ kind: "user", text, ts }] : [];
    }
    case "PLANNER_RESPONSE": {
      const model = typeof entry.model === "string" ? entry.model : null;
      const out: TranscriptEvent[] = [];
      if (content?.trim())
        out.push({ kind: "assistant", text: content, model, ts });
      if (Array.isArray(entry.tool_calls)) {
        for (const call of entry.tool_calls) {
          if (call === null || typeof call !== "object") continue;
          const name = "name" in call ? call.name : undefined;
          const args = "args" in call ? call.args : undefined;
          if (typeof name !== "string") continue;
          out.push({
            kind: "tool_call",
            id: null,
            toolName: name,
            inputs: normalizeAntigravityToolInput(name, args),
            ts,
          });
        }
      }
      return out;
    }
    case "GENERIC":
      return [
        {
          kind: "tool_result",
          id: null,
          output: content,
          isError: entry.status === "ERROR",
          ts,
        },
      ];
    default:
      return [];
  }
}

/** Parse a transcript body into IR events. */
export function parseAntigravityTranscript(text: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      continue; // never seen: lines are written whole
    }
    events.push(...eventsFromAntigravityLine(line));
  }
  return events;
}

/** Read a conversation's transcript by its id. Null when it is not written
 *  yet (no prompt since the conversation began) or the id is not a UUID. */
export const loadAntigravityTranscript: Fetcher = (input) => {
  if (!UUID_RE.test(input.sessionId)) return null;
  let text: string;
  try {
    text = fs.readFileSync(transcriptPathFor(input.sessionId), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const transcript: Transcript = {
    agentName: antigravityVocab.displayName,
    sessionId: input.sessionId,
    title: input.title,
    repoName: input.repoName,
    cwd: input.cwd,
    model: input.model,
    contextTokens: input.contextTokens,
    pr: input.pr,
    exportedAt: Date.now(),
    events: parseAntigravityTranscript(text),
  };
  return transcript;
};
