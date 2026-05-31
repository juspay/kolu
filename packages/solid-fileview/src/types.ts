/** The contract for `@kolu/solid-fileview` — the "outlet" the Code-browser
 *  preview plan describes (`docs/plans/code-browser-preview.solid-fileview.html`).
 *  Pure data + function shapes, no rendering: every concrete renderer is an
 *  appliance the consumer plugs in. */

import type { JSX } from "solid-js";

/** What a renderer draws from. A file may have a `content` (UTF-8 source on
 *  disk), a `url` (a server-rendered form), or *both* — the two orthogonal
 *  axes the preview taxonomy is built on:
 *    - source only   → plain code (content, no url)
 *    - rendered only → image / pdf (url, no content)
 *    - both          → markdown / html / svg (content AND url)
 *  The presence of each field is exactly what decides whether the Source ⇄
 *  Rendered toggle is offered. */
export type FileData = {
  /** Path the file lives at — drives renderer matching and labels. */
  path: string;
  /** UTF-8 source text, when the file has a source form. */
  content?: string;
  /** True when `content` was truncated by a size limit upstream. */
  truncated?: boolean;
  /** Server-built URL for a rendered form (image `<img src>`, iframe `src`),
   *  when the file has one. */
  url?: string;
};

/** Renders a file's *source* form (e.g. syntax-highlighted text). Injected,
 *  never built in: `FileView` has no syntax highlighter of its own, so a
 *  consumer plugs one in (kolu backs this with `@kolu/solid-pierre`). */
export type SourceRenderer = {
  render: (file: FileData) => JSX.Element;
};

/** Renders a file's *rendered* form (image, sandboxed iframe, markdown
 *  document, …). `match` claims the paths this appliance handles; `FileView`
 *  picks the first matching renderer from the list it's given. */
export type RenderedRenderer = {
  match: (path: string) => boolean;
  render: (file: FileData) => JSX.Element;
};

/** The two viewing modes. The toggle between them is offered iff a file has
 *  *both* a source and a rendered form. */
export type FileViewMode = "source" | "rendered";
