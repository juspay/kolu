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
 *  bridge), or `"none"` (nothing to anchor to: a raster image or a video). The renderers
 *  stay pure presenters; a new one can't silently ship without a comment
 *  decision because it has to pick a capture mode at this seam:
 *
 *    - `kind: "text"`   → a `FileData` with `content`; FileView renders the
 *      injected pierre source renderer (`BrowseFileView`). Markdown (`.md`)
 *      additionally gets a rendered appliance, so FileView shows a Source ⇄
 *      Rendered toggle (defaulting to rendered); other text stays source-only.
 *    - `kind: "binary"` → a `FileData` with `url`; FileView picks a rendered
 *      appliance by extension (raster `<img>`, `<video>` player, or sandboxed
 *      iframe). Rendered-only — no source on the wire to toggle to.
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
import { VideoRenderer } from "@kolu/solid-fileview/renderers/video";
import type { SelectedLineRange } from "@kolu/solid-pierre";
import {
  isMarkdown,
  isRasterImage,
  isSandboxPreviewable,
  isVideo,
} from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { Portal } from "solid-js/web";
import { createEventListener } from "@solid-primitives/event-listener";
import { toast } from "solid-sonner";
import { match, P } from "ts-pattern";
import { resolveLinkHref } from "@kolu/solid-browser";
import { resolveWikilink } from "@kolu/solid-markdown";
import { CommentTextSurface } from "../comments/CommentTextSurface";
import { useCommentScrollRequest } from "../comments/scrollRequest";
import { OptionMenu } from "../ui/OptionMenu";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import { app } from "../wire";
import BrowseFileView from "./BrowseFileView";
import BrowseIframeRenderer from "./BrowseIframeRenderer";
import { resolveMarkdownImageSrc } from "./markdownImageSrc";
import { openInCodeTab } from "./openInCodeTab";

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
      File truncated (exceeds 1 MB)
    </div>
  </Show>
);

type FootnoteState = { anchor: HTMLElement; definition: HTMLElement };

const FootnotePopover: Component<{
  fn: () => FootnoteState | null;
  onDismiss: () => void;
  onNavigateRelative: (href: string) => void;
  onNavigateWikilink: (target: string, anchor: HTMLElement) => void;
}> = (props) => {
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.fn()?.anchor,
    open: () => props.fn() !== null,
    onDismiss: props.onDismiss,
    anchor: "bottom-start",
    flip: true,
    panelMinWidth: 320,
  });

  createEventListener(
    () => (props.fn() ? document : undefined),
    "scroll",
    props.onDismiss,
    { capture: true },
  );

  const chrome = surface({ radius: "lg", shadow: "light", portalled: true });

  const content = createMemo(() => {
    const def = props.fn()?.definition;
    if (!def) return "";
    const clone = def.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    for (const backref of clone.querySelectorAll('a[href*="-ref-"]')) {
      backref.remove();
    }
    for (const nested of clone.querySelectorAll("[data-md-footnote]")) {
      nested.removeAttribute("data-md-footnote");
    }
    return clone.innerHTML;
  });

  return (
    <Show when={props.fn()}>
      {(fn) => (
        <Portal>
          <div
            ref={(el: HTMLElement) => {
              panelRef(el);
              const onPanelClick = (e: MouseEvent) => {
                const target = e.target as Element;
                const anchor = target.closest("a");
                if (!anchor) return;
                const href = anchor.getAttribute("href");
                if (anchor.hasAttribute("data-md-wikilink")) {
                  e.preventDefault();
                  const wlTarget = anchor.getAttribute("data-md-wikilink");
                  if (wlTarget) props.onNavigateWikilink(wlTarget, anchor);
                  return;
                }
                if (anchor.hasAttribute("data-md-rel")) {
                  e.preventDefault();
                  if (href) props.onNavigateRelative(href);
                }
              };
              el.addEventListener("click", onPanelClick);
              onCleanup(() => el.removeEventListener("click", onPanelClick));
            }}
            data-testid="footnote-popover"
            class={`fixed z-50 flex flex-col ${chrome.class} p-3`}
            style={{
              ...panelStyle(),
              ...chrome.style,
              width: "min(360px, calc(100vw - 2rem))",
              "max-height": "min(50vh, 22rem)",
              overflow: "auto",
            }}
          >
            <div
              class="text-sm leading-relaxed text-fg-2"
              innerHTML={content()}
            />
            <button
              type="button"
              class="mt-2 border-t border-edge pt-1.5 text-xs text-fg-3/60 hover:text-fg-2 transition-colors"
              onClick={() => {
                fn().definition.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
                props.onDismiss();
              }}
            >
              see all ↓
            </button>
          </div>
        </Portal>
      )}
    </Show>
  );
};

export type BrowseFileDispatcherProps = {
  terminalId: TerminalId;
  repoPath: string;
  filePath: string;
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
   *  `openInCodeTab` pipeline, which gates resolution on `pending()` likewise. */
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

  // ── Wikilink navigation ────────────────────────────────────────────
  // A `[[Note]]` click resolves pathless against the whole repo (`repoVault`),
  // GitHub/Obsidian-style. A unique hit opens through the same front door every
  // other "open this file" producer uses; a miss toasts; an ambiguous basename
  // (two `Note.md` in different folders) surfaces a disambiguation menu anchored
  // to the clicked link rather than failing closed — the user picks the file
  // they meant.
  // The shared "open" tail: every preview-link path — wikilink or doc-relative —
  // ends at the same front door. Only the *resolution* differs per callback
  // (pathless vault vs. doc-relative); the *open* lives here, once. No fuzzy
  // basename fallback — the resolvers already produced an exact repo entry, and
  // a fallback would silently open a same-basename file in another folder.
  const openPreviewPath = (path: string) =>
    openInCodeTab({
      ref: { path, startLine: null, endLine: null },
      repoRoot: props.repoPath,
      targetMode: "browse",
      allowBasenameFallback: false,
    });

  const [wikiMenu, setWikiMenu] = createSignal<{
    anchor: HTMLElement;
    candidates: string[];
  } | null>(null);

  const onNavigateWikilink = (target: string, anchor: HTMLElement) => {
    // The vault list resubscribes (and momentarily empties) on right-panel tab
    // toggles while a persisted preview stays clickable, so resolving against a
    // pending snapshot would falsely report "no file" or stale candidates. Ask
    // the user to retry rather than resolve a one-shot click against `[]`; the
    // list settles in a tick. (The `openInCodeTab` effect can simply re-run
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

  // ── Relative-link navigation ───────────────────────────────────────
  // Shared by the MarkdownRenderer and the footnote popover's inner links.
  // A repo-relative link resolves against the previewed doc's own directory
  // (GitHub-style), then opens through the same front door every other
  // "open this file" producer uses. A miss (traversal escaping the repo root,
  // or a fragment/query-only href) surfaces a toast rather than no-op'ing
  // silently, so a dead link isn't indistinguishable from a working one.
  const onNavigateRelative = (href: string) => {
    const path = resolveLinkHref(props.filePath, href);
    if (path === null) {
      toast.error(`Can't open link: ${href}`);
      return;
    }
    openPreviewPath(path);
  };

  // ── Footnote popover ───────────────────────────────────────────────
  // A footnote forward-ref click opens a popover anchored to the marker,
  // showing the definition inline. Toggle: clicking the same marker again
  // closes it. Dismiss: outside-click/Escape (via useAnchoredPopover) +
  // scroll (capture-phase listener). The popover reuses the same link
  // resolvers the preview uses, so relative links and wikilinks inside a
  // footnote body still open the right way.
  const [footnote, setFootnote] = createSignal<FootnoteState | null>(null);

  const onFootnote = (anchor: HTMLElement, definition: HTMLElement) => {
    const current = footnote();
    if (current?.anchor === anchor) {
      setFootnote(null);
      return;
    }
    setFootnote({ anchor, definition });
  };

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
  const textSurface = (
    file: FileData,
    view: JSX.Element,
    opts: { lineAnchored: boolean; surface?: "source" | "prose" },
  ): JSX.Element => (
    <CommentTextSurface
      terminalId={props.terminalId}
      path={file.path}
      // The host's text is the file source, so the highlight overlay
      // re-anchors when the server bumps content on save.
      contentTick={file.source?.content ?? ""}
      // `flex-1 min-h-0` so the host fills the space left under the (optional)
      // truncation-banner sibling without overflowing it.
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
    file: FileData,
    surface: "source" | "prose",
  ): "source" | "prose" | undefined =>
    isMarkdown(file.path) ? surface : undefined;

  const withComments = (
    capture: Capture,
    file: FileData,
    view: JSX.Element,
  ): JSX.Element =>
    match(capture)
      .with("text", () =>
        textSurface(file, view, {
          lineAnchored: true,
          surface: surfaceFor(file, "source"),
        }),
      )
      .with("prose", () =>
        textSurface(file, view, {
          lineAnchored: false,
          surface: surfaceFor(file, "prose"),
        }),
      )
      .with(P.union("iframe", "none"), () => view)
      .exhaustive();

  // Kolu's source appliance: pierre's syntax-highlighted CodeView, carrying
  // kolu's theme + initial line selection. The render closure reads `props`
  // reactively (FileView calls it inside its own JSX), so theme/selection
  // changes flow through without rebuilding it.
  const sourceRenderer: SourceRenderer = {
    render: (file) => (
      <div class="flex h-full w-full flex-col">
        <TruncatedBanner show={file.source?.truncated ?? false} />
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

  // Kolu's rendered appliances, tried in order — one branch per set of the
  // three-way binary partition in `kolu-common/preview`, each named by its own
  // predicate so the routing decision isn't a positional catch-all. Raster
  // images take the plain `<img>` (on a checkerboard so transparency reads);
  // videos take a `<video controls>` element; both have nothing to anchor a
  // comment to. The sandbox set — `.html`/`.htm`/`.svg`/`.pdf` — takes the
  // sandboxed iframe (which owns its own comment bridge). A binary that matches
  // none of the three (a future `.wasm`/font that slipped into
  // `BINARY_PREVIEWABLE_EXTENSIONS` without a category) falls to the explicit
  // "unsupported" renderer below rather than silently landing in an iframe that
  // can't render it — the partition has no silent fourth category at runtime.
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
      match: isVideo,
      render: (file) =>
        withComments(
          "none",
          file,
          <VideoRenderer path={file.path} url={file.url ?? ""} />,
        ),
    },
    {
      match: isSandboxPreviewable,
      render: (file) =>
        withComments(
          "iframe",
          file,
          <BrowseIframeRenderer
            terminalId={props.terminalId}
            path={file.path}
            url={file.url ?? ""}
            onNavigate={props.onNavigate}
            onHistory={props.onHistory}
            onOpenExternal={props.onOpenExternal}
          />,
        ),
    },
    // Final, explicit no-match: a binary that's neither raster, video, nor
    // sandbox. Surfaces the gap visibly instead of FileView rendering blank
    // (no source on the wire, no matched rendered appliance → empty outlet).
    {
      match: () => true,
      render: (file) =>
        withComments(
          "none",
          file,
          <div class="px-2 py-1 text-fg-3/50">
            No preview available for this file type
          </div>,
        ),
    },
  ];

  // Kolu's rendered appliances for *text* files — just Markdown today. A
  // `.md` file carries source (the text on the wire) AND a rendered form (the
  // same text as a document), so FileView offers a Source ⇄ Rendered toggle,
  // defaulting to rendered. The rendered document is `"prose"`: selectable
  // light DOM, so it's commentable — anchored against its own host subtree
  // (not the whole page) and with no source `lineRange` (a rendered line isn't
  // a source line). It records `surface: "prose"` so the tray jump flips the
  // toggle back to Rendered before re-finding (the rendered quote "Hello Doc"
  // needn't appear in source "# Hello Doc", so landing on Source would fail
  // the re-find); the comment re-anchors within the preview. Non-markdown text
  // matches nothing here and stays source-only (no toggle). Markdown renders
  // from `content`, not a URL — so these never appear in the binary
  // `renderedRenderers` list above.
  const textRenderers: RenderedRenderer[] = [
    {
      match: isMarkdown,
      // A `kind:"text"` FileData always carries `source` (see textFile()
      // below), so the `?.`/`?? ""` is type-defensive narrowing of the
      // optional field — never a real blank-document path.
      render: (file) => (
        <div class="flex h-full w-full flex-col">
          <TruncatedBanner show={file.source?.truncated ?? false} />
          {withComments(
            "prose",
            file,
            // TruncatedBanner above owns the truncation chrome — keeps it
            // outside the commentable host so users can't anchor a comment
            // to UI copy the agent can't find in the file.
            <MarkdownRenderer
              markdown={file.source?.content ?? ""}
              resolveImageSrc={(src) =>
                resolveMarkdownImageSrc(props.terminalId, props.filePath, src)
              }
              onNavigateRelative={onNavigateRelative}
              onNavigateWikilink={onNavigateWikilink}
              onFootnote={onFootnote}
            />,
          )}
        </div>
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
        value=""
        onSelect={openPreviewPath}
        testIdPrefix="wikilink-disambiguation"
        maxHeight={280}
        truncate
        flip
      />
      <FootnotePopover
        fn={footnote}
        onDismiss={() => setFootnote(null)}
        onNavigateRelative={onNavigateRelative}
        onNavigateWikilink={onNavigateWikilink}
      />
    </>
  );
};

export default BrowseFileDispatcher;
