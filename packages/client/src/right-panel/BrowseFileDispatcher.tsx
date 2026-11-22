/** THE ONE FILE VIEWER — kolu's renderer set, its comment decision and its
 *  link resolvers, over a file somebody else has already read.
 *
 *  It projects a `FileData` onto `@kolu/solid-fileview`'s `FileView` outlet,
 *  injecting kolu's renderers rather than wiring any render mechanics here.
 *  The img/iframe strategies live in the library
 *  (`@kolu/solid-fileview/renderers/*`); the pierre-backed source view and the
 *  artifact-sdk comment bridge stay in kolu (they're kolu's volatility),
 *  plugged in as appliances.
 *
 *  THE READ IS THE CALLER'S, and that is what lets a file open in two places
 *  without two viewers. The Code tab hands it the retained per-host query it
 *  owns (`hostCodeTab.fileContent`, keyed on repo+file so a focus move never
 *  blanks the view); a work's card hands it a one-shot read of a member's
 *  worktree, or kolu's own copy of a file kept when the work ended. Both get
 *  the same markdown, the same images, the same comments — because there is
 *  one of each, here.
 *  Commentability is decided *here*, once: every renderer is built through
 *  `withComments(capture, …)`, which declares how that view exposes itself for
 *  comments — `"text"` (selectable source DOM, line-addressable), `"prose"`
 *  (rendered text like the Markdown preview — anchored to its host subtree,
 *  no source line), `"iframe"` (the sandboxed preview owns its own postMessage
 *  bridge), or `"none"` (nothing to anchor to: a raster image, video, or PDF).
 *  The renderers stay pure presenters; a new one can't silently ship without a
 *  comment decision because it has to pick a capture mode at this seam:
 *
 *    - `kind: "text"`   → a `FileData` with `content`; FileView renders the
 *      injected pierre source renderer (`BrowseFileView`). Markdown-family
 *      paths (`isMarkdown` / `MARKDOWN_EXTENSIONS`) additionally get a
 *      rendered appliance, so FileView shows a Source ⇄ Rendered toggle
 *      (defaulting to rendered); other text stays source-only.
 *    - `kind: "binary"` → a `FileData` with `url`; FileView picks a rendered
 *      appliance by extension (raster `<img>`, `<video>` player, native PDF
 *      viewer, or sandboxed iframe). Rendered-only — no source on the wire to
 *      toggle to.
 *
 *  The Source ⇄ Rendered toggle lights up wherever a file carries *both*
 *  forms — Markdown today (plan phase 3); a `renderable` wire kind for
 *  HTML/SVG follows (phase 4) with zero changes here beyond the renderer
 *  list. */

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
import type { CodeOpen } from "./openInCodeTab";

// The "File truncated" banner is rendered as a sibling ABOVE the comment
// surface in both sourceRenderer and textRenderers: the banner is chrome, not
// file content, so it must stay out of the commentable host or a user could
// select "File truncated …" and save a comment whose quote is UI copy the
// agent can't find in the file.
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

/** The one line for a file this viewer cannot draw — a binary no renderer
 *  claims, or text that is not text at all. */
const NoPreview: Component = () => (
  <div data-testid="file-no-preview" class="px-2 py-1 text-fg-3/50">
    No preview available for this file type
  </div>
);

export type BrowseFileDispatcherProps = {
  /** WHERE the file comes from: the terminal whose host serves its bytes and
   *  whose repo a comment is anchored against.
   *
   *  `null` for a copy kolu holds ITSELF — a finished work's kept file, which
   *  outlived the worktree it was written in. There is no repo behind it and
   *  no terminal to address a comment to, so the links, the image resolver
   *  and the comment surface are simply absent rather than pointed at a
   *  terminal that has nothing to do with the bytes. */
  at: { host: string; terminalId: TerminalId } | null;
  filePath: string;
  /** Where a link in the document opens: the door of the view this viewer is
   *  drawn in. `null` when there is nowhere to open one — a copy kolu kept
   *  has no tree behind it — so a link is not followed. */
  open: CodeOpen | null;
  /** THE FILE, already read — text with its source, or a URL to bytes.
   *  `null` while the read is still out.
   *
   *  The read itself is the CALLER's: the Code tab's is a retained per-host
   *  query keyed on (repo, file) that survives a host switch
   *  (`hostCodeTab.fileContent`), and a work card's is a one-shot read of a
   *  member's worktree or of kolu's own copy. Only the RENDERING is shared —
   *  which is the whole point of this seam: one viewer, one renderer set, one
   *  comment decision, however the bytes arrived. */
  file: FileWithSource | FileWithUrl | null;
  /** Why the read failed, if it did — drawn in place of the file. */
  error: Error | undefined;
  /** The repo's vault a `[[wikilink]]` resolves against — its full file list
   *  (`fsListAll`, repo-relative, pathless) paired with that list's readiness,
   *  threaded from `CodeTab` rather than re-subscribed here so resolution shares
   *  the one live list. The two arrive as one value so they can't drift apart:
   *  `paths` is the snapshot, `pending` says whether it's still settling
   *  (`fsListAll.pending()`). The list briefly resets to `[]` whenever that
   *  stream resubscribes (e.g. a right-panel tab toggle), so a `[[wikilink]]`
   *  clicked in that window must read `pending` from the same object it would
   *  resolve `paths` against — gating on the stale flag of a different snapshot
   *  is exactly the mismatch this single value rules out. Mirrors the
   *  Code view's open-request pipeline, which gates resolution on `pending()`
   *  likewise. */
  repoVault: { paths: readonly string[]; pending: boolean };
  theme: "light" | "dark";
  initialSelectedLines?: SelectedLineRange | null;
  /** Forwarded to the iframe renderer so an in-iframe link click moves the
   *  tree selection to the linked file (HTML-preview navigation). */
  onNavigate?: (path: string) => void;
  /** Forwarded to the iframe renderer so the mouse back/forward (X1/X2)
   *  buttons work over an HTML preview (the sandbox traps them in the frame). */
  onHistory?: (direction: "back" | "forward") => void;
  /** Forwarded to the iframe renderer so an external link clicked in an HTML
   *  preview opens in a real browser tab (the sandbox can't open one itself). */
  onOpenExternal?: (url: string) => void;
  /** Forwarded to the iframe renderer so a kolu deep link (`#/…`) clicked in an
   *  HTML preview routes the parent app (the sandbox can't navigate it). */
  onDeepLink?: (hash: string) => void;
};

const BrowseFileDispatcher: Component<BrowseFileDispatcherProps> = (props) => {
  // ── Wikilink navigation ────────────────────────────────────────────
  // A `[[Note]]` click resolves pathless against the whole repo (`repoVault`),
  // GitHub/Obsidian-style. A unique hit opens through the door of the view this
  // viewer is drawn in, like every other "open this file" made there; a miss
  // toasts; an ambiguous basename (two `Note.md` in different folders) surfaces
  // a disambiguation menu anchored to the clicked link rather than failing
  // closed — the user picks the file they meant.
  // The shared "open" tail: every preview-link path — wikilink or doc-relative —
  // ends at the same door. Only the *resolution* differs per callback
  // (pathless vault vs. doc-relative); the *open* lives here, once. No fuzzy
  // basename fallback — the resolvers already produced an exact repo entry, and
  // a fallback would silently open a same-basename file in another folder.
  const openPreviewPath = (path: string) => {
    // A kept file has no repo to resolve a link INTO — kolu holds the bytes,
    // not the tree they came from. Nothing to open, so nothing is offered.
    props.open?.({
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
    // The vault list resubscribes (and momentarily empties) on right-panel tab
    // toggles while a persisted preview stays clickable, so resolving against a
    // pending snapshot would falsely report "no file" or stale candidates. Ask
    // the user to retry rather than resolve a one-shot click against `[]`; the
    // list settles in a tick. (The view's open-request effect can simply re-run
    // when `pending()` flips — a click can't, hence the explicit guard.)
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

  // A repo-relative link resolves against the previewed doc's own directory
  // (GitHub-style), then opens through the same front door terminal `path:line`
  // links use — so a miss surfaces a toast and any file type opens, not a bogus
  // new tab (#1161). Named (not inlined on the preview) so the footnote popover
  // routes a relative link in a note body through the exact same resolver.
  const onNavigateRelative = (href: string) => {
    const path = resolveLinkHref(props.filePath, href);
    // The anchor is tagged `data-md-rel` (so the click was already
    // preventDefault'd) yet didn't resolve to a repo path — a traversal that
    // escapes the repo root, or a fragment/query-only href. Surface it rather
    // than no-op silently, so a dead link isn't indistinguishable from a live one.
    if (path === null) {
      toast.error(`Can't open link: ${href}`);
      return;
    }
    openPreviewPath(path);
  };

  // ── Footnote popover ───────────────────────────────────────────────
  // A `[n]` marker click (routed across the `@kolu/solid-markdown` seam by
  // `onFootnote`) opens the matching definition in a popover anchored to the
  // marker, instead of scrolling to the bottom "Footnotes" list. The bottom list
  // stays as-is; the popover reads its content from there. Clicking the marker
  // that's already open toggles it closed.
  const [footnote, setFootnote] = createSignal<FootnoteTarget | null>(null);
  const onFootnote = (anchor: HTMLElement, definition: HTMLElement) =>
    setFootnote((cur) =>
      cur?.anchor === anchor ? null : { anchor, definition },
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
  //   - "none"   nothing to anchor to (a raster image or a video)
  // `"iframe"` and `"none"` are left untouched; the two text-bearing modes get
  // the `CommentTextSurface` wrapper.
  type Capture = "text" | "prose" | "iframe" | "none";

  // Both text-bearing modes mount the same surface and anchor against whatever
  // root actually holds the selection; they share the same sizing class
  // (`min-h-0 w-full flex-1`) and differ only in line addressability.
  // Both sit as a `flex-1` sibling BELOW the (optional) truncation banner —
  // the banner is chrome, not file content, so it stays out of the commentable
  // host (see `sourceRenderer` and the `prose` renderer below): a user must
  // not be able to select "File truncated …" and save a comment whose quote
  // the agent can't find.
  //
  // WITH NO TERMINAL there is nothing to anchor a comment TO — a kept file's
  // bytes are kolu's own copy, addressed by the work that kept them and not by
  // a repo any agent can be pointed back at, and a reader can draw a work's
  // file before it has learnt the work's terminal. The surface is still
  // there, with commenting off: a terminal arriving or leaving turns
  // commenting on or off around the SAME drawn view. The view is never put in
  // two places (a bare arm and a wrapped arm): moving one drawn node between
  // them is a DOM insert into itself.
  const textSurface = (
    file: () => FileData,
    view: JSX.Element,
    opts: { lineAnchored: boolean; surface?: "source" | "prose" },
  ): JSX.Element => (
    <CommentTextSurface
      terminalId={props.at?.terminalId ?? null}
      path={file().path}
      // The host's text is the file source, so the highlight overlay
      // re-anchors when the server bumps content on save.
      contentTick={file().source?.content ?? ""}
      // `flex-1 min-h-0` so the host fills the space left under the
      // (optional) truncation-banner sibling without overflowing it.
      class="min-h-0 w-full flex-1"
      lineAnchored={opts.lineAnchored}
      surface={opts.surface}
    >
      {view}
    </CommentTextSurface>
  );

  // A comment records its surface only when the file is multi-surface — i.e.
  // Markdown, which offers the Source ⇄ Rendered toggle. Plain source (no
  // rendered form, no toggle) leaves it undefined so the tray jump doesn't
  // try to flip a toggle that isn't there.
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
      .with(P.union("iframe", "none"), () => view)
      .exhaustive();

  // Kolu's source appliance: pierre's syntax-highlighted CodeView, carrying
  // kolu's theme + initial line selection. The render closure reads `props`
  // reactively (FileView calls it inside its own JSX), so theme/selection
  // changes flow through without rebuilding it.
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

  // Kolu's rendered appliances, tried in order — one branch per set of the
  // binary partition in `kolu-common/preview`, each named by its own predicate
  // so the routing decision isn't a positional catch-all. Raster images take
  // the plain `<img>` (on a checkerboard so transparency reads); videos take a
  // `<video controls>` element; PDFs take the browser's native PDF viewer.
  // These three have nothing to anchor a comment to. The sandbox set —
  // `.html`/`.htm`/`.svg` — takes the sandboxed iframe (which owns its own
  // comment bridge). A binary that matches none of the four (a future
  // `.wasm`/font that slipped into
  // `BINARY_PREVIEWABLE_EXTENSIONS` without a category) falls to the explicit
  // "unsupported" renderer below rather than silently landing in an iframe that
  // can't render it — the partition has no silent extra category at runtime.
  const renderedRenderers: RenderedRenderer<FileWithUrl>[] = [
    {
      match: (path) => binaryPreviewFamily(path) === "raster",
      render: (file) =>
        withComments(
          "none",
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
          "none",
          file,
          <VideoRenderer path={file().path} url={file().url} />,
        ),
    },
    {
      match: (path) => binaryPreviewFamily(path) === "pdf",
      render: (file) =>
        withComments(
          "none",
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
    // Final, explicit no-match: a binary that's neither raster, video, nor
    // sandbox. Surfaces the gap visibly instead of FileView rendering blank
    // (no source on the wire, no matched rendered appliance → empty outlet).
    {
      match: () => true,
      render: (file) => withComments("none", file, <NoPreview />),
    },
  ];

  // Text appliances — markdown-family paths (`isMarkdown`) carry source on
  // the wire AND a rendered document form, so FileView offers a Source ⇄
  // Rendered toggle, defaulting to rendered. The rendered document is
  // `"prose"`: selectable light DOM, so it's commentable — anchored against
  // its own host subtree (not the whole page) and with no source `lineRange`
  // (a rendered line isn't a source line). It records `surface: "prose"` so
  // the tray jump flips the toggle back to Rendered before re-finding (the
  // rendered quote "Hello Doc" needn't appear in source "# Hello Doc", so
  // landing on Source would fail the re-find); the comment re-anchors within
  // the preview. Non-markdown text matches nothing here and stays source-only
  // (no toggle). Markdown-family content renders from `content`, not a URL —
  // so these never appear in the binary `renderedRenderers` list above.
  const textRenderers: RenderedRenderer<FileWithSource>[] = [
    {
      match: isMarkdown,
      render: (file) => (
        <div class="flex h-full w-full flex-col">
          <TruncatedBanner show={file().source.truncated} />
          {withComments(
            "prose",
            file,
            // TruncatedBanner above owns the truncation chrome — keeps it
            // outside the commentable host so users can't anchor a comment
            // to UI copy the agent can't find in the file.
            <MarkdownRenderer
              markdown={file().source.content}
              resolveImageSrc={(src) => {
                const at = props.at;
                // A kept file's images are already whatever the document
                // names: there is no repo to resolve a relative `src`
                // against, so it is left exactly as written.
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

  // The file arrives already read (see `file` on the props) — the two arms
  // below only decide WHICH renderer set it goes to. Identity changes when
  // the content or the URL changes (e.g. a `?v=<tag>` cache key moving with
  // the bytes), so FileView re-renders exactly when the file did.
  const textFile = createMemo((): FileWithSource | null => {
    const file = props.file;
    return file !== null && file.source !== undefined
      ? { ...file, source: file.source }
      : null;
  });
  // NOT TEXT AT ALL — git's own test for "binary": a NUL in the content. A
  // font or an archive that no binary renderer claims arrives here decoded
  // as text, and drawn as code it is a screen of replacement characters.
  const notText = createMemo(
    () => textFile()?.source.content.includes("\0") ?? false,
  );
  const binaryFile = createMemo((): FileWithUrl | null => {
    const file = props.file;
    return file !== null && file.url !== undefined
      ? { ...file, url: file.url }
      : null;
  });

  // A controlled FileView mode driven by a tray-jump scroll request: when the
  // pending request targets THIS file and names a surface, force the toggle to
  // it (prose → rendered, source → source) so the jump lands on the surface
  // the comment lives on even when the file is already open in the other mode
  // (same path → no remount, so the toggle wouldn't otherwise move). Returns
  // null when no request matches — FileView then stays self-controlled.
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
      {/* Ambiguous-wikilink disambiguation: an anchored list of the repo files
       *  whose basename matched. Picking one opens it; the menu reuses the same
       *  anchored-option-list scaffold the Dock/minimap pickers use — but with
       *  the unbounded-content opts those fixed pickers don't need: an ambiguous
       *  `[[index]]` can match dozens of long repo paths, so cap the height
       *  (scroll the overflow), truncate long path labels (full path in the
       *  hover title), and let the panel flip above the link when it sits near
       *  the viewport bottom. */}
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
      {/* Footnote popover: the clicked `[n]` marker's definition, anchored to
       *  the marker. Reuses the same anchored-panel scaffold as the wikilink
       *  menu above; its inner links route through the preview's own resolvers
       *  (relative + wikilink), so a link in a note body opens just like one in
       *  the body text. */}
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
