/** The Code tab's browse-mode adapter: owns the `fsReadFile` subscription
 *  and projects the wire's `kind` discriminator onto `@kolu/solid-fileview`'s
 *  `FileView` outlet — injecting kolu's renderer set rather than wiring any
 *  render mechanics here. The img/iframe strategies now live in the library
 *  (`@kolu/solid-fileview/renderers/*`); the pierre-backed source view and
 *  the artifact-sdk comment bridge stay in kolu (they're kolu's volatility),
 *  plugged in as appliances:
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
import { type Component, createMemo, Match, Switch } from "solid-js";
import { toast } from "solid-sonner";
import { app, client } from "../wire";
import BrowseFileView from "./BrowseFileView";
import BrowseIframeRenderer from "./BrowseIframeRenderer";
import { resolveMarkdownImageSrc } from "./markdownImageSrc";
import { toggleTaskInSource } from "./taskToggle";

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

  // Kolu's source appliance: pierre's syntax-highlighted CodeView wrapped in
  // the comment surface, carrying kolu's theme + initial line selection. The
  // render closure reads `props` reactively (FileView calls it inside its own
  // JSX), so theme/selection changes flow through without rebuilding it.
  const sourceRenderer: SourceRenderer = {
    render: (file) => (
      <BrowseFileView
        terminalId={props.terminalId}
        filePath={file.path}
        content={file.source?.content ?? ""}
        truncated={file.source?.truncated ?? false}
        theme={props.theme}
        initialSelectedLines={props.initialSelectedLines}
      />
    ),
  };

  // Kolu's rendered appliances, tried in order. Raster images take the plain
  // `<img>` (on a checkerboard so transparency reads); everything else in the
  // binary set — `.html`/`.svg`/`.pdf` — falls through to the sandboxed
  // iframe, exactly reproducing the old `!isRasterImage` split.
  const renderedRenderers: RenderedRenderer[] = [
    {
      match: isRasterImage,
      render: (file) => (
        <ImageRenderer
          path={file.path}
          url={file.url ?? ""}
          class="image-preview-checkerboard"
        />
      ),
    },
    {
      match: () => true,
      render: (file) => (
        <BrowseIframeRenderer
          terminalId={props.terminalId}
          path={file.path}
          url={file.url ?? ""}
          onNavigate={props.onNavigate}
        />
      ),
    },
  ];

  // Kolu's rendered appliances for *text* files — just Markdown today. A
  // `.md` file carries source (the text on the wire) AND a rendered form (the
  // same text as a document), so FileView offers a Source ⇄ Rendered toggle,
  // defaulting to rendered. Non-markdown text matches nothing here and stays
  // source-only (no toggle). Markdown renders from `content`, not a URL — so
  // these never appear in the binary `renderedRenderers` list above.
  const textRenderers: RenderedRenderer[] = [
    {
      match: isMarkdown,
      // A `kind:"text"` FileData always carries `source` (see textFile()
      // below), so the `?.`/`?? ""` is type-defensive narrowing of the
      // optional field — never a real blank-document path.
      render: (file) => (
        <MarkdownRenderer
          markdown={file.source?.content ?? ""}
          truncated={file.source?.truncated ?? false}
          resolveImageSrc={(src) =>
            resolveMarkdownImageSrc(props.terminalId, props.filePath, src)
          }
          onToggleTask={(taskIndex) => {
            // Flip the Nth task marker in the current source and write it back;
            // the file watcher re-yields the new content, re-rendering the
            // checkbox in its toggled state.
            const next = toggleTaskInSource(
              file.source?.content ?? "",
              taskIndex,
            );
            if (next === null) return;
            void client.fs
              .writeFile({
                repoPath: props.repoPath,
                filePath: props.filePath,
                content: next,
              })
              .catch((err: Error) =>
                toast.error(`Failed to save: ${err.message}`),
              );
          }}
        />
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
