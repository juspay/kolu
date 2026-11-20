import path from "node:path";
import type { ToolInput, Transcript, TranscriptEvent } from "./schemas.ts";

/** A function that rewrites a single string. */
export type StringTransform = (s: string) => string;

/** Build a transform that rewrites absolute paths strictly inside `cwd`
 *  to a `./relative` form, using `path.relative()` for the arithmetic.
 *
 *  Out-of-cwd absolutes (siblings, ancestors, `/usr/bin/...`) stay
 *  verbatim — that's the one anchor that keeps the regex unambiguous
 *  and avoids the prefix-collision class of bugs (`/proj` accidentally
 *  matching `/proj-other`). The bare `cwd` itself is unmatched (the
 *  regex requires `/<continuation>`); the renderer keeps it absolute as
 *  a header label. */
export function makeRelativizer(cwd: string | null): StringTransform | null {
  if (!cwd) return null;
  let baseEnd = cwd.length;
  while (baseEnd > 0 && cwd[baseEnd - 1] === "/") baseEnd--;
  const base = cwd.slice(0, baseEnd);
  if (!base) return null;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}(/[^\\s"'\`)\\]<>]*)`, "g");
  return (s) =>
    s.replace(re, (_full, suffix: string) => {
      const abs = base + suffix;
      const rel = path.posix.relative(base, abs);
      // path.relative returns "" only when abs === base, but we required
      // a non-empty suffix; rel always has at least one component here.
      return `./${rel}`;
    });
}

function transformToolInput(input: ToolInput, fn: StringTransform): ToolInput {
  switch (input.kind) {
    case "edit":
      return {
        ...input,
        filePath: fn(input.filePath),
        edits: input.edits.map((e) => ({
          oldText: fn(e.oldText),
          newText: fn(e.newText),
        })),
      };
    case "write":
      return {
        ...input,
        filePath: fn(input.filePath),
        content: fn(input.content),
      };
    case "patch":
      return { ...input, text: fn(input.text) };
    case "read":
      return { ...input, filePath: fn(input.filePath) };
    case "bash":
      return { ...input, command: fn(input.command) };
    case "glob":
      return {
        ...input,
        pattern: input.pattern,
        path: input.path ? fn(input.path) : null,
      };
    case "grep":
      return {
        ...input,
        pattern: input.pattern,
        path: input.path ? fn(input.path) : null,
      };
    case "fetch":
      return input;
    case "web_search":
      return input;
    case "skill":
      return input;
    case "task":
      return input;
    case "ask":
      return input;
    case "plan_mode":
      return input;
    case "worktree":
      return input.path ? { ...input, path: fn(input.path) } : input;
    case "cron":
      return input;
    case "monitor":
      return input;
    case "lsp":
      return input;
    case "mcp_resource":
      return input;
    case "send_message":
      return input;
    case "team":
      return input;
    case "tool_search":
      return input;
    case "unknown":
      return input;
  }
}

function walkStrings(value: unknown, fn: StringTransform): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => walkStrings(v, fn));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walkStrings(v, fn);
    return out;
  }
  return value;
}

function transformEvent(
  event: TranscriptEvent,
  fn: StringTransform,
): TranscriptEvent {
  switch (event.kind) {
    case "user":
    case "assistant":
    case "reasoning":
      return { ...event, text: fn(event.text) };
    case "tool_call":
      return { ...event, inputs: transformToolInput(event.inputs, fn) };
    case "tool_result":
      return { ...event, output: walkStrings(event.output, fn) };
    case "subtask_start":
      return { ...event, description: fn(event.description) };
    case "subtask_end":
      return event;
  }
}

/** Apply a string transform structurally to every relevant field of
 *  the transcript. The top-level `cwd` stays absolute (it's a header
 *  label) — every other path-or-string field is rewritten. */
export function transformStrings(
  transcript: Transcript,
  fn: StringTransform,
): Transcript {
  return {
    ...transcript,
    events: transcript.events.map((e) => transformEvent(e, fn)),
  };
}

/** One-call entry: relativize all path-bearing strings against the
 *  transcript's own cwd. No-op when cwd is missing. */
export function relativizeTranscript(transcript: Transcript): Transcript {
  const fn = makeRelativizer(transcript.cwd);
  if (!fn) return transcript;
  return transformStrings(transcript, fn);
}
