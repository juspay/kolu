/** Structural transforms over the typed `Transcript`.
 *
 *  No JSON round-trip, no stringified-haystack regex: every path field
 *  is reached by walking the typed IR. The only place we still use a
 *  regex is inside free-text fields (user / assistant / reasoning text,
 *  bash commands, patch text), where paths appear inline and there's no
 *  field to address them by — but the regex operates on a string we
 *  control, not on JSON syntax. */

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
  const base = cwd.replace(/\/+$/, "");
  if (!base) return null;
  // Match `${base}/<continuation>` where the continuation is captured
  // up to the next whitespace, quote, or closing paren/bracket. The
  // boundary chars match how absolute paths appear in human-readable
  // text (in messages, in command stdout) and JSON-quoted strings.
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

/** Apply `fn` to the path-bearing fields of a typed tool input. Fields
 *  not naturally typed as paths (`bash.command`, `patch.text`) get the
 *  same transform — paths can appear inline in those — but they're free
 *  text, so the transform is doing string-content matching, not field
 *  identification.
 *
 *  Opaque inputs are unchanged: by construction, those are vendor
 *  shapes we haven't modelled, so the renderer dumps them as JSON. */
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
      return input; // url stays absolute
    case "opaque":
      return input;
  }
}

/** Walk every string node in an unknown structure and apply `fn`.
 *  Used for `tool_result.output` only — we don't model output shapes
 *  (vendors emit file contents, stdout, stderr, structured payloads,
 *  error objects), so the targeted-field approach doesn't apply there. */
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
