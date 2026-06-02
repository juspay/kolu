/** @jsxRuntime automatic */
/** @jsxImportSource preact */
/** Render a `Transcript` to a self-contained HTML document.
 *
 *  Thin orchestrator. Heavy lifting lives in:
 *  - `markdown.ts` — `marked` engine for prose
 *  - `pierre.ts` — `@pierre/diffs/ssr` for code surfaces
 *  - `components.tsx` — SolidJS components for the document tree
 *  - `styles.css` — page chrome + role/event styling
 *  - `script.js` — interactive chrome (nav, toggles, theme, collapse)
 *
 *  Async because both `marked` (Pierre-routed code blocks) and Pierre
 *  itself produce promises. Per-event work fans out via `Promise.all`
 *  before SSR so the SolidJS component tree renders synchronously and
 *  there's no Suspense boundary needed. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml } from "@kolu/html-escape";
import {
  relativizeTranscript,
  type ToolInput,
  type Transcript,
  type TranscriptEvent,
} from "kolu-transcript-core";
import { renderToString } from "preact-render-to-string";

import {
  computeDepths,
  countEvents,
  Document,
  deriveDisplayTitle,
  isEditClass,
  type RenderedEvent,
} from "./components.tsx";
import { renderMarkdown, renderUserMarkdown } from "./markdown.ts";
import {
  buildPierreBootstrap,
  renderEdit,
  renderPatch,
  renderWrite,
} from "./pierre.ts";

/** A long body — markdown or Pierre — wraps in a collapse shell when
 *  source-text line count exceeds this. Same threshold across kinds
 *  so the doc reads consistently: anything beyond ~20 lines gets a
 *  "Show all N lines" toggle. */
const COLLAPSE_THRESHOLD = 20;

/** Read a sibling source file at module-init time and cache the
 *  contents. Used to inline `styles.css` and `script.js` into the
 *  exported document — neither has a build step, so we ship the raw
 *  source from disk via ESM-style resolution. */
const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(join(SRC_DIR, "styles.css"), "utf8");
const SCRIPT = readFileSync(join(SRC_DIR, "script.js"), "utf8");

/** Wrap a pre-rendered HTML body in a collapsible shell when it
 *  exceeds the threshold. The same `.msg-collapsible` machinery
 *  drives prose AND code chunks so the toggle UI is consistent. The
 *  body lives inside an inner `<div class="collapse-body">` so the
 *  height clip applies even when the body has multiple top-level
 *  children (e.g. an Edit with several Pierre chunks). */
function maybeCollapse(html: string, lineCount: number): string {
  if (lineCount <= COLLAPSE_THRESHOLD) return html;
  return `<div class="msg-collapsible is-collapsed" data-line-count="${lineCount}"><div class="collapse-body">${html}</div><button type="button" class="collapse-toggle" aria-expanded="false"><span class="collapse-chevron" aria-hidden="true">▼</span><span data-toggle-label>Show all ${lineCount} lines</span></button></div>`;
}

/** Compute a representative line count for a code surface so the
 *  collapse threshold has something to compare against. Sums old +
 *  new for an Edit; raw content for Write/Patch. */
function codeLineCount(input: ToolInput): number {
  if (input.kind === "edit") {
    return input.edits.reduce(
      (n, e) => n + e.oldText.split("\n").length + e.newText.split("\n").length,
      0,
    );
  }
  if (input.kind === "write") return input.content.split("\n").length;
  if (input.kind === "patch") return input.text.split("\n").length;
  return 0;
}

/** Render the Pierre body for an edit-class tool call. Multi-edit
 *  inputs concatenate their per-edit chunks. */
async function renderEditBody(input: ToolInput): Promise<string> {
  if (input.kind === "edit") {
    const chunks = await Promise.all(
      input.edits.map((e) => renderEdit(input.filePath, e.oldText, e.newText)),
    );
    return chunks.join("");
  }
  if (input.kind === "write")
    return await renderWrite(input.filePath, input.content);
  if (input.kind === "patch") return await renderPatch(input.text);
  return "";
}

/** Pre-resolve the async body for one event. The output is a string
 *  of HTML that the SolidJS component splats via `innerHTML`. Per
 *  kind:
 *  - user → marked output with hard line breaks, optionally wrapped
 *    in a collapse shell when the prompt is long
 *  - assistant → marked output, optionally collapsed
 *  - reasoning → marked output (already nested inside a `<details>`,
 *    so no outer collapse)
 *  - tool_call (edit-class) → concatenated Pierre chunks, optionally
 *    collapsed
 *  - other kinds → undefined; the component renders inline */
async function preRenderEvent(
  event: TranscriptEvent,
): Promise<string | undefined> {
  if (event.kind === "user") {
    const body = `<div class="card-text card-text--user md">${await renderUserMarkdown(event.text)}</div>`;
    return maybeCollapse(body, event.text.split("\n").length);
  }
  if (event.kind === "assistant") {
    const body = `<div class="card-text card-text--assistant md">${await renderMarkdown(event.text)}</div>`;
    return maybeCollapse(body, event.text.split("\n").length);
  }
  if (event.kind === "reasoning") {
    return `<div class="card-text card-text--reasoning md">${await renderMarkdown(event.text)}</div>`;
  }
  if (event.kind === "tool_call" && isEditClass(event.inputs)) {
    const body = await renderEditBody(event.inputs);
    return maybeCollapse(body, codeLineCount(event.inputs));
  }
  return undefined;
}

/** Convert a Transcript to a self-contained HTML document. */
export async function transcriptToHtml(
  transcript: Transcript,
): Promise<string> {
  // Rewrite absolute in-cwd paths to ./relative form before render, so
  // long paths read as `./src/foo.ts` instead of
  // `/home/srid/code/kolu/.worktrees/damn-booth/packages/foo/src/foo.ts`.
  const prepared = relativizeTranscript(transcript);
  const counts = countEvents(prepared.events);
  const depths = computeDepths(prepared.events);
  const bodies = await Promise.all(prepared.events.map(preRenderEvent));
  const rendered: RenderedEvent[] = prepared.events.map((event, index) => ({
    event,
    index,
    depth: depths[index] ?? 0,
    bodyHtml: bodies[index],
  }));
  const titleText = deriveDisplayTitle(prepared);
  const body = renderToString(
    <Document
      transcript={prepared}
      titleText={titleText}
      counts={counts}
      rendered={rendered}
    />,
  );
  const pierreBootstrap = buildPierreBootstrap();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(titleText)} — kolu</title>
<style>${STYLES}</style>
</head>
<body data-hide-tools="true" data-hide-edits="false" data-hide-reasoning="true">
${body}
<script>${pierreBootstrap}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
