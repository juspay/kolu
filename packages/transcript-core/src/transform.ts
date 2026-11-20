import path from "node:path";
import type {
  ToolInput,
  Transcript,
  TranscriptEvent,
  UnmodelledPayload,
} from "./schemas.ts";

/** A function that rewrites every path mentioned in a single string. */
export type StringTransform = (s: string) => string;

const PATH_TERMINATOR_CHARS = "\\s\"'`)\\]<>";

function inCwdPathPattern(base: string): RegExp {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(/[^${PATH_TERMINATOR_CHARS}]*)`, "g");
}

/** Build a transform that rewrites absolute paths strictly inside `cwd`
 *  to a `./relative` form. Out-of-cwd absolutes (siblings, ancestors,
 *  `/usr/bin/...`) and `cwd` itself stay verbatim. */
export function makeRelativizer(cwd: string | null): StringTransform | null {
  if (!cwd) return null;
  let baseEnd = cwd.length;
  while (baseEnd > 0 && cwd[baseEnd - 1] === "/") baseEnd--;
  const base = cwd.slice(0, baseEnd);
  if (!base) return null;
  const re = inCwdPathPattern(base);
  return (s) =>
    s.replace(re, (matched, suffix: string) => {
      const rel = path.posix.relative(base, base + suffix);
      return rel ? `./${rel}` : matched;
    });
}

function transformToolInput(
  input: ToolInput,
  rewritePathsIn: StringTransform,
): ToolInput {
  switch (input.kind) {
    case "edit":
      return {
        ...input,
        filePath: rewritePathsIn(input.filePath),
        edits: input.edits.map((e) => ({
          oldText: rewritePathsIn(e.oldText),
          newText: rewritePathsIn(e.newText),
        })),
      };
    case "write":
      return {
        ...input,
        filePath: rewritePathsIn(input.filePath),
        content: rewritePathsIn(input.content),
      };
    case "patch":
      return { ...input, text: rewritePathsIn(input.text) };
    case "read":
      return { ...input, filePath: rewritePathsIn(input.filePath) };
    case "bash":
      return { ...input, command: rewritePathsIn(input.command) };
    case "glob":
      return {
        ...input,
        pattern: input.pattern,
        path: input.path ? rewritePathsIn(input.path) : null,
      };
    case "grep":
      return {
        ...input,
        pattern: input.pattern,
        path: input.path ? rewritePathsIn(input.path) : null,
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
      return input.path
        ? { ...input, path: rewritePathsIn(input.path) }
        : input;
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

function walkStrings(
  value: UnmodelledPayload,
  rewritePathsIn: StringTransform,
): UnmodelledPayload {
  if (typeof value === "string") return rewritePathsIn(value);
  if (Array.isArray(value))
    return value.map((v) => walkStrings(v, rewritePathsIn));
  if (value && typeof value === "object") {
    const out: Record<string, UnmodelledPayload> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = walkStrings(v, rewritePathsIn);
    return out;
  }
  return value;
}

function transformEvent(
  event: TranscriptEvent,
  rewritePathsIn: StringTransform,
): TranscriptEvent {
  switch (event.kind) {
    case "user":
    case "assistant":
    case "reasoning":
      return { ...event, text: rewritePathsIn(event.text) };
    case "tool_call":
      return {
        ...event,
        inputs: transformToolInput(event.inputs, rewritePathsIn),
      };
    case "tool_result":
      return { ...event, output: walkStrings(event.output, rewritePathsIn) };
    case "subtask_start":
      return { ...event, description: rewritePathsIn(event.description) };
    case "subtask_end":
      return event;
  }
}

/** Apply a string transform to every path-bearing and free-text field of
 *  the transcript's events. The top-level `cwd` is left as-is. */
export function transformStrings(
  transcript: Transcript,
  rewritePathsIn: StringTransform,
): Transcript {
  return {
    ...transcript,
    events: transcript.events.map((e) => transformEvent(e, rewritePathsIn)),
  };
}

/** One-call entry: relativize all path-bearing strings against the
 *  transcript's own cwd. No-op when cwd is missing. */
export function relativizeTranscript(transcript: Transcript): Transcript {
  const rewritePathsIn = makeRelativizer(transcript.cwd);
  if (!rewritePathsIn) return transcript;
  return transformStrings(transcript, rewritePathsIn);
}
