/** The Code tab's browse-mode adapter: owns the `fsReadFile` subscription
 *  and projects the wire's `kind` discriminator onto `@kolu/solid-fileview`'s
 *  `FileView` outlet — injecting kolu's renderer set rather than wiring any
 *  render mechanics here. The img/iframe strategies now live in the library
 *  (`@kolu/solid-fileview/renderers/*`); the pierre-backed source view and
 *  the artifact-sdk comment bridge stay in kolu (they're kolu's volatility),
 *  plugged in as appliances.
 *
 *  Commentability is decided *here*, once: every renderer is built through
 *  `withComments(capture, …)`, which declares how that view exposes itself for
 *  comments — `"text"` (selectable source DOM, line-addressable), `"prose"`
 *  (rendered text like the Markdown preview — anchored to its host subtree,
 *  no source line), `"iframe"` (the sandboxed preview owns its own postMessage
 *  bridge), or `"none"` (nothing to anchor to: a raster image). The renderers
 *  stay pure presenters; a new one can't silently ship without a comment
 *  decision because it has to pick a capture mode at this seam:
 *
 *    - `kind: "text"`   → a `FileData` with `content`; FileView renders the
 *      injected pierre source renderer (`BrowseFileView`). Markdown (`.md`)
 *      additionally gets a rendered appliance, so FileView shows a Source ⇄
 *      Rendered toggle (defaulting to rendered); other text stays source-only.
 *    - `kind: "binary"` → a `FileData` with `url`; FileView picks a rendered
 *      appliance by extension (image `<img>` or sandboxed iframe). Rendered-
 *      only — no source on the wire to toggle to.
 *
 *  The Source ⇄ Rendered toggle lights up wherever a file carries *both*
 *  forms — Markdown today (plan phase 3); a `renderable` wire kind for
 *  HTML/SVG follows (phase 4) with zero changes here beyond the renderer
 *  list. */

import {
  type FileData,
  FileView,
  type RenderedRenderer,
  type SourceRenderer,
} from "@kolu/solid-fileview";
import { ImageRenderer } from "@kolu/solid-fileview/renderers/image";
import { MarkdownRenderer } from "@kolu/solid-fileview/renderers/markdown";
import type { SelectedLineRange } from "@kolu/solid-pierre";
import { isMarkdown, isRasterImage } from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import { toast } from "solid-sonner";
import { match, P } from "ts-pattern";
import { CommentTextSurface } from "../comments/CommentTextSurface";
import { app } from "../wire";
import BrowseFileView from "./BrowseFileView";
import BrowseIframeRenderer from "./BrowseIframeRenderer";
import { resolveMarkdownImageSrc } from "./markdownImageSrc";

export type BrowseFileDispatcherProps = {
  terminalId: TerminalId;
  repoPath: string;
  filePath: string;
  theme: "light" | "dark";
  initialSelectedLines?: SelectedLineRange | null;
  /** Forwarded to the iframe renderer so an in-iframe link click moves the
   *  tree selection to the linked file (HTML-preview navigation). */
  onNavigate?: (path: string) => void;
};

const BrowseFileDispatcher: Component<BrowseFileDispatcherProps> = (props) => {
  const fileContent = app.streams.fsReadFile.use(
    () => ({
      terminalId: props.terminalId,
      repoPath: props.repoPath,
      filePath: props.filePath,
    }),
    {
      onError: (err) => toast.error(`File content stream: ${err.message}`),
    },
  );

  // The comment address space a view exposes — the single axis this seam
  // decides on (see the header):
  //   - "text"   selectable source DOM (Pierre's shadow-rooted CodeView),
  //              line-addressable → CommentTextSurface, lineRange kept
  //   - "prose"  rendered text (the Markdown preview, light DOM) — anchored
  //              against its host subtree, but a rendered line isn't a source
  //              line, so no lineRange → CommentTextSurface, lineAnchored false
  //   - "iframe" the sandboxed preview owns its own postMessage bridge (it
  //              must bind to the element the renderer creates)
  //   - "none"   nothing to anchor to (a raster image)
  // `"iframe"` and `"none"` are left untouched; the two text-bearing modes get
  // the `CommentTextSurface` wrapper.
  type Capture = "text" | "prose" | "iframe" | "none";

  // Both text-bearing modes mount the same surface and anchor against whatever
  // root actually holds the selection; they differ only in host sizing and
  // line addressability. "text" sits below the truncation banner (`flex-1`);
  // "prose" owns the whole pane (`h-full`).
  const textSurface = (
    file: FileData,
    view: JSX.Element,
    opts: { class: string; lineAnchored: boolean },
  ): JSX.Element => (
    <CommentTextSurface
      terminalId={props.terminalId}
      path={file.path}
      // The host's text is the file source, so the highlight overlay
      // re-anchors when the server bumps content on save.
      contentTick={file.source?.content ?? ""}
      class={opts.class}
      lineAnchored={opts.lineAnchored}
    >
      {view}
    </CommentTextSurface>
  );

  const withComments = (
    capture: Capture,
    file: FileData,
    view: JSX.Element,
  ): JSX.Element =>
    match(capture)
      .with("text", () =>
        textSurface(file, view, {
          class: "min-h-0 w-full flex-1",
          lineAnchored: true,
        }),
      )
      .with("prose", () =>
        textSurface(file, view, {
          class: "h-full w-full",
          lineAnchored: false,
        }),
      )
      .with(P.union("iframe", "none"), () => view)
      .exhaustive();

  // Kolu's source appliance: pierre's syntax-highlighted CodeView, carrying
  // kolu's theme + initial line selection. The render closure reads `props`
  // reactively (FileView calls it inside its own JSX), so theme/selection
  // changes flow through without rebuilding it.
  //
  // The "File truncated" banner is rendered as a sibling ABOVE the comment
  // surface, not inside it: the banner is chrome, not file content, so it must
  // stay out of the commentable host or a user could select "File truncated …"
  // and save a comment whose quote is UI copy the agent can't find in the file.
  const sourceRenderer: SourceRenderer = {
    render: (file) => (
      <div class="flex h-full w-full flex-col">
        <Show when={file.source?.truncated}>
          <div class="px-2 py-1 text-warning text-[10px] border-b border-edge bg-surface-1/30">
            File truncated (exceeds 1 MB)
          </div>
        </Show>
        {withComments(
          "text",
          file,
          <BrowseFileView
            filePath={file.path}
            content={file.source?.content ?? ""}
            theme={props.theme}
            initialSelectedLines={props.initialSelectedLines}
          />,
        )}
      </div>
    ),
  };

  // Kolu's rendered appliances, tried in order. Raster images take the plain
  // `<img>` (on a checkerboard so transparency reads) — nothing to anchor a
  // comment to; everything else in the binary set — `.html`/`.svg`/`.pdf` —
  // falls through to the sandboxed iframe (which owns its own comment bridge),
  // exactly reproducing the old `!isRasterImage` split.
  const renderedRenderers: RenderedRenderer[] = [
    {
      match: isRasterImage,
      render: (file) =>
        withComments(
          "none",
          file,
          <ImageRenderer
            path={file.path}
            url={file.url ?? ""}
            class="image-preview-checkerboard"
          />,
        ),
    },
    {
      match: () => true,
      render: (file) =>
        withComments(
          "iframe",
          file,
          <BrowseIframeRenderer
            terminalId={props.terminalId}
            path={file.path}
            url={file.url ?? ""}
            onNavigate={props.onNavigate}
          />,
        ),
    },
  ];

  // Kolu's rendered appliances for *text* files — just Markdown today. A
  // `.md` file carries source (the text on the wire) AND a rendered form (the
  // same text as a document), so FileView offers a Source ⇄ Rendered toggle,
  // defaulting to rendered. The rendered document is `"prose"`: selectable
  // light DOM, so it's commentable — anchored against its own host subtree
  // (not the whole page) and with no source `lineRange` (a rendered line isn't
  // a source line). A comment made here re-finds within the preview; flipping
  // to Source may not re-highlight it — the rendered quote ("Hello Doc") needn't
  // appear verbatim in source ("# Hello Doc") — acceptable drift; the comment
  // still lives in the tray. Non-markdown text matches nothing here and stays
  // source-only (no toggle). Markdown renders from `content`, not a URL — so
  // these never appear in the binary `renderedRenderers` list above.
  const textRenderers: RenderedRenderer[] = [
    {
      match: isMarkdown,
      // A `kind:"text"` FileData always carries `source` (see textFile()
      // below), so the `?.`/`?? ""` is type-defensive narrowing of the
      // optional field — never a real blank-document path.
      render: (file) =>
        withComments(
          "prose",
          file,
          <MarkdownRenderer
            markdown={file.source?.content ?? ""}
            truncated={file.source?.truncated ?? false}
            resolveImageSrc={(src) =>
              resolveMarkdownImageSrc(props.terminalId, props.filePath, src)
            }
          />,
        ),
    },
  ];

  // Project each wire variant to a `FileData`. Identity changes when the
  // content/url changes (e.g. the server bumps `?v=<mtime>` on save), so
  // FileView re-renders through the same subscription path as before.
  const textFile = createMemo<FileData | null>(() => {
    const fc = fileContent();
    return fc?.kind === "text"
      ? {
          path: props.filePath,
          source: { content: fc.content, truncated: fc.truncated },
        }
      : null;
  });
  const binaryFile = createMemo<FileData | null>(() => {
    const fc = fileContent();
    return fc?.kind === "binary" ? { path: props.filePath, url: fc.url } : null;
  });

  return (
    <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
      <Match when={fileContent.error()}>
        {(err) => (
          <div class="px-2 py-1 text-danger">Error: {err().message}</div>
        )}
      </Match>
      <Match when={textFile()}>
        {(file) => (
          <FileView
            file={file()}
            source={sourceRenderer}
            rendered={textRenderers}
          />
        )}
      </Match>
      <Match when={binaryFile()}>
        {(file) => <FileView file={file()} rendered={renderedRenderers} />}
      </Match>
    </Switch>
  );
};

export default BrowseFileDispatcher;
