import { formatBytes } from "@kolu/byte-units";
import { resolveLinkHref } from "@kolu/solid-browser";
import {
  type FileWithSource,
  type FileWithUrl,
  type FileData,
  FileView,
  type RenderedRenderer,
  type SourceRenderer,
} from "@kolu/solid-fileview";
import { ImageRenderer } from "@kolu/solid-fileview/renderers/image";
import { MarkdownRenderer } from "@kolu/solid-fileview/renderers/markdown";
import { PdfRenderer } from "@kolu/solid-fileview/renderers/pdf";
import { VideoRenderer } from "@kolu/solid-fileview/renderers/video";
import { resolveWikilink } from "@kolu/solid-markdown";
import type { SelectedLineRange } from "@kolu/solid-pierre";
import { MAX_READ_BYTES } from "kolu-git/schemas";
import { binaryPreviewFamily, isMarkdown } from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import { toast } from "solid-sonner";
import { match, P } from "ts-pattern";
import { CommentTextSurface } from "../comments/CommentTextSurface";
import { useCommentScrollRequest } from "../comments/scrollRequest";
import { OptionMenu } from "../ui/OptionMenu";
import BrowseFileView from "./BrowseFileView";
import BrowseIframeRenderer from "./BrowseIframeRenderer";
import { FootnotePopover, type FootnoteTarget } from "./FootnotePopover";
import { resolveMarkdownImageSrc } from "./markdownImageSrc";
import { openInCodeTab } from "./openInCodeTab";

const TruncatedBanner: Component<{ show: boolean }> = (p) => (
  <Show when={p.show}>
    <div
      data-testid="browse-truncation-banner"
      class="border-b border-edge bg-surface-1/30 px-2 py-1 text-[10px] text-warning"
    >
      File truncated (exceeds {formatBytes(MAX_READ_BYTES)})
    </div>
  </Show>
);

const NoPreview: Component = () => (
  <div data-testid="file-no-preview" class="px-2 py-1 text-fg-3/50">
    No preview available for this file type
  </div>
);

export type BrowseFileDispatcherProps = {
  at: { host: string; terminalId: TerminalId } | null;
  filePath: string;
  file: FileWithSource | FileWithUrl | null;
  error: Error | undefined;
  repoVault: { paths: readonly string[]; pending: boolean };
  theme: "light" | "dark";
  initialSelectedLines?: SelectedLineRange | null;
  onNavigate?: (path: string) => void;
  onHistory?: (direction: "back" | "forward") => void;
  onOpenExternal?: (url: string) => void;
  onDeepLink?: (hash: string) => void;
};

const BrowseFileDispatcher: Component<BrowseFileDispatcherProps> = (props) => {
  const openPreviewPath = (path: string) => {
    const at = props.at;
    if (at === null) return;
    openInCodeTab({
      terminalId: at.terminalId,
      ref: { path, startLine: null, endLine: null },
      targetMode: "browse",
      allowBasenameFallback: false,
    });
  };

  const [wikiMenu, setWikiMenu] = createSignal<{
    anchor: HTMLElement;
    candidates: string[];
  } | null>(null);

  const onNavigateWikilink = (target: string, anchor: HTMLElement) => {
    if (props.repoVault.pending) {
      toast.error("Repo file list still loading — try the link again");
      return;
    }
    const res = resolveWikilink({ target, repoPaths: props.repoVault.paths });
    if (res.kind === "none") {
      toast.error(`No file matching [[${target}]]`);
      return;
    }
    if (res.kind === "unique") {
      openPreviewPath(res.path);
      return;
    }
    setWikiMenu({ anchor, candidates: res.candidates });
  };

  const wikiMenuOptions = createMemo(() =>
    (wikiMenu()?.candidates ?? []).map((path) => ({
      value: path,
      label: path,
    })),
  );

  const onNavigateRelative = (href: string) => {
    const path = resolveLinkHref(props.filePath, href);
    if (path === null) {
      toast.error(`Can't open link: ${href}`);
      return;
    }
    openPreviewPath(path);
  };

  const [footnote, setFootnote] = createSignal<FootnoteTarget | null>(null);
  const onFootnote = (anchor: HTMLElement, definition: HTMLElement) =>
    setFootnote((cur) =>
      cur?.anchor === anchor ? null : { anchor, definition },
    );

  type Capture = "text" | "prose" | "iframe" | "not-commentable";

  const textSurface = (
    file: () => FileData,
    view: JSX.Element,
    opts: { lineAnchored: boolean; surface?: "source" | "prose" },
  ): JSX.Element => (
    <Show when={props.at} fallback={view}>
      {(at) => (
        <CommentTextSurface
          terminalId={at().terminalId}
          path={file().path}
          contentTick={file().source?.content ?? ""}
          class="min-h-0 w-full flex-1"
          lineAnchored={opts.lineAnchored}
          surface={opts.surface}
        >
          {view}
        </CommentTextSurface>
      )}
    </Show>
  );

  const surfaceFor = (
    file: () => FileData,
    surface: "source" | "prose",
  ): "source" | "prose" | undefined =>
    isMarkdown(file().path) ? surface : undefined;

  const withComments = (
    capture: Capture,
    file: () => FileData,
    view: JSX.Element,
  ): JSX.Element =>
    match(capture)
      .with("text", () =>
        textSurface(file, view, {
          lineAnchored: true,
          get surface() {
            return surfaceFor(file, "source");
          },
        }),
      )
      .with("prose", () =>
        textSurface(file, view, {
          lineAnchored: false,
          get surface() {
            return surfaceFor(file, "prose");
          },
        }),
      )
      .with(P.union("iframe", "not-commentable"), () => view)
      .exhaustive();

  const sourceRenderer: SourceRenderer<FileWithSource> = {
    render: (file) => (
      <div class="flex h-full w-full flex-col">
        <TruncatedBanner show={file().source.truncated} />
        {withComments(
          "text",
          file,
          <BrowseFileView
            filePath={file().path}
            content={file().source.content}
            theme={props.theme}
            initialSelectedLines={props.initialSelectedLines}
          />,
        )}
      </div>
    ),
  };

  const renderedRenderers: RenderedRenderer<FileWithUrl>[] = [
    {
      match: (path) => binaryPreviewFamily(path) === "raster",
      render: (file) =>
        withComments(
          "not-commentable",
          file,
          <ImageRenderer
            path={file().path}
            url={file().url}
            class="image-preview-checkerboard"
          />,
        ),
    },
    {
      match: (path) => binaryPreviewFamily(path) === "video",
      render: (file) =>
        withComments(
          "not-commentable",
          file,
          <VideoRenderer path={file().path} url={file().url} />,
        ),
    },
    {
      match: (path) => binaryPreviewFamily(path) === "pdf",
      render: (file) =>
        withComments(
          "not-commentable",
          file,
          <PdfRenderer path={file().path} url={file().url} />,
        ),
    },
    {
      match: (path) => binaryPreviewFamily(path) === "sandbox",
      render: (file) =>
        withComments(
          "iframe",
          file,
          <BrowseIframeRenderer
            terminalId={props.at?.terminalId ?? null}
            path={file().path}
            url={file().url}
            onNavigate={props.onNavigate}
            onHistory={props.onHistory}
            onOpenExternal={props.onOpenExternal}
            onDeepLink={props.onDeepLink}
          />,
        ),
    },
    {
      match: () => true,
      render: (file) => withComments("not-commentable", file, <NoPreview />),
    },
  ];

  const textRenderers: RenderedRenderer<FileWithSource>[] = [
    {
      match: isMarkdown,
      render: (file) => (
        <div class="flex h-full w-full flex-col">
          <TruncatedBanner show={file().source.truncated} />
          {withComments(
            "prose",
            file,
            <MarkdownRenderer
              markdown={file().source.content}
              resolveImageSrc={(src) => {
                const at = props.at;
                return at === null
                  ? src
                  : resolveMarkdownImageSrc(
                      at.host,
                      at.terminalId,
                      props.filePath,
                      src,
                    );
              }}
              onNavigateRelative={onNavigateRelative}
              onNavigateWikilink={onNavigateWikilink}
              onFootnote={onFootnote}
            />,
          )}
        </div>
      ),
    },
  ];

  const textFile = createMemo((): FileWithSource | null => {
    const file = props.file;
    return file !== null && file.source !== undefined
      ? { ...file, source: file.source }
      : null;
  });
  const notText = createMemo(
    () => textFile()?.source.content.includes("\0") ?? false,
  );
  const binaryFile = createMemo((): FileWithUrl | null => {
    const file = props.file;
    return file !== null && file.url !== undefined
      ? { ...file, url: file.url }
      : null;
  });

  const scroll = useCommentScrollRequest();
  const jumpMode = createMemo<"source" | "rendered" | null>(() => {
    const req = scroll.request();
    if (!req || req.path !== props.filePath || !req.surface) return null;
    return req.surface === "prose" ? "rendered" : "source";
  });

  return (
    <>
      <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
        <Match when={props.error}>
          {(err) => (
            <div class="px-2 py-1 text-danger">Error: {err().message}</div>
          )}
        </Match>
        <Match when={notText()}>
          <NoPreview />
        </Match>
        <Match when={textFile()}>
          {(file) => (
            <FileView
              file={file()}
              source={sourceRenderer}
              rendered={textRenderers}
              mode={jumpMode()}
            />
          )}
        </Match>
        <Match when={binaryFile()}>
          {(file) => <FileView file={file()} rendered={renderedRenderers} />}
        </Match>
      </Switch>
      <OptionMenu
        triggerRef={() => wikiMenu()?.anchor}
        open={() => wikiMenu() !== null}
        onDismiss={() => setWikiMenu(null)}
        anchor="bottom-start"
        options={wikiMenuOptions()}
        onSelect={openPreviewPath}
        testIdPrefix="wikilink-disambiguation"
        maxHeight={280}
        truncate
        flip
      />
      <FootnotePopover
        target={footnote}
        onDismiss={() => setFootnote(null)}
        onNavigateRelative={onNavigateRelative}
        onNavigateWikilink={onNavigateWikilink}
      />
    </>
  );
};

export default BrowseFileDispatcher;
