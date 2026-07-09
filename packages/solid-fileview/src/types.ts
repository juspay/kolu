/** The contract for `@kolu/solid-fileview` — the "outlet" the Code-browser
 *  preview plan describes (`docs/atlas/src/content/atlas/solid-fileview.mdx`).
 *  Pure data + function shapes, no rendering: every concrete renderer is an
 *  appliance the consumer plugs in. */

import type { JSX } from "solid-js";

/** What a renderer draws from. A file may have a `source` (UTF-8 text on
 *  disk), a `url` (a route-served rendered form), or both:
 *    - source only   → plain code, plus source-rendered documents like Markdown
 *    - url only      → image / video / pdf / sandboxed HTML/SVG today
 *    - both          → consumers that can supply source and a separate URL
 *  The host supplies the source renderer and rendered renderer list that match
 *  this shape; `FileView` offers the Source ⇄ Rendered toggle when both are
 *  available for the same file.
 *
 *  `content` and `truncated` are nested under `source` so their presence is
 *  coupled structurally: a file either has a source form (text + its
 *  truncation flag, as one unit) or it doesn't. The flat shape would admit
 *  the illegal `{ url, truncated }`-without-content state. */
export type FileData = {
  /** Path the file lives at — drives renderer matching and labels. */
  path: string;
  /** The file's source form, when it has one. */
  source?: {
    /** UTF-8 source text. */
    content: string;
    /** True when `content` was truncated by a size limit upstream. */
    truncated: boolean;
  };
  /** Server-built URL for a rendered form (image `<img src>`, iframe `src`),
   *  when the file has one. */
  url?: string;
};

/** File shape for renderers that require a source form. */
export type FileWithSource = FileData & {
  source: NonNullable<FileData["source"]>;
};

/** File shape for renderers that require a route-served URL. */
export type FileWithUrl = FileData & {
  url: string;
};

/** Renders a file's *source* form (e.g. syntax-highlighted text). Injected,
 *  never built in: `FileView` has no syntax highlighter of its own, so a
 *  consumer plugs one in (kolu backs this with `@kolu/solid-pierre`). */
export type SourceRenderer<TFile extends FileData = FileData> = {
  render: (file: TFile) => JSX.Element;
};

/** Renders a file's *rendered* form (image, video, PDF, sandboxed iframe,
 *  markdown document, …). `match` claims the paths this appliance handles;
 *  `FileView` picks the first matching renderer from the list it's given. */
export type RenderedRenderer<TFile extends FileData = FileData> = {
  match: (path: string) => boolean;
  render: (file: TFile) => JSX.Element;
};

/** The two viewing modes. The toggle between them is offered iff a file has
 *  *both* a source and a rendered form. */
export type FileViewMode = "source" | "rendered";
