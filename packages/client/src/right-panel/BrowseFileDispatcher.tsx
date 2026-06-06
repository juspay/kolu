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
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import { toast } from "solid-sonner";
import { match, P } from "ts-pattern";
import { resolveLinkHref, resolveWikilink } from "@kolu/solid-browser";
import { CommentTextSurface } from "../comments/CommentTextSurface";
import { useCommentScrollRequest } from "../comments/scrollRequest";
import { OptionMenu } from "../ui/OptionMenu";
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

export type BrowseFileDispatcherProps = {
  terminalId: TerminalId;
  repoPath: string;
  filePath: string;
  /** The repo's full file list (`fsListAll`), repo-relative — the vault a
   *  `[[wikilink]]` resolves against, pathless. Threaded from `CodeTab` rather
   *  than re-subscribed here so resolution shares the one live list. */
  repoPaths: readonly string[];
  /** Whether `repoPaths` is still settling (`fsListAll.pending()`). The file
   *  list briefly resets to `[]` whenever that stream resubscribes (e.g. a
   *  right-panel tab toggle), so a `[[wikilink]]` clicked in that window must
   *  not resolve against the empty/stale snapshot — it would toast a bogus "no
   *  file" or surface stale candidates. Mirrors the `openInCodeTab` pipeline,
   *  which gates resolution on this same `pending()` for the same reason. */
  repoPathsPending: boolean;
  theme: "light" | "dark";
  initialSelectedLines?: SelectedLineRange | null;
  /** Forwarded to the iframe renderer so an in-iframe link click moves the
   *  tree selection to the linked file (HTML-preview navigation). */
  onNavigate?: (path: string) => void;
  /** Forwarded to the iframe renderer so the mouse back/forward (X1/X2)
   *  buttons work over an HTML preview (the sandbox traps them in the frame). */
  onHistory?: (direction: "back" | "forward") => void;
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
  // A `[[Note]]` click resolves pathless against the whole repo (`repoPaths`),
  // GitHub/Obsidian-style. A unique hit opens through the same front door every
  // other "open this file" producer uses; a miss toasts; an ambiguous basename
  // (two `Note.md` in different folders) surfaces a disambiguation menu anchored
  // to the clicked link rather than failing closed — the user picks the file
  // they meant.
  const openWikilinkPath = (path: string) =>
    openInCodeTab({
      ref: { path, startLine: null, endLine: null },
      repoRoot: props.repoPath,
      targetMode: "browse",
      // `path` is already an exact repo entry from the resolver — no fuzzy
      // fallback (it would defeat the point of having disambiguated).
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
    if (props.repoPathsPending) {
      toast.error("Repo file list still loading — try the link again");
      return;
    }
    const res = resolveWikilink({ target, repoPaths: props.repoPaths });
    if (res.kind === "none") {
      toast.error(`No file matching [[${target}]]`);
      return;
    }
    if (res.kind === "unique") {
      openWikilinkPath(res.path);
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
            onHistory={props.onHistory}
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
              onNavigateRelative={(href) => {
                // A repo-relative link resolves against the previewed doc's own
                // directory (GitHub-style), then opens through the same front
                // door terminal `path:line` links use — so a miss surfaces a
                // toast and any file type opens, not a bogus new tab (#1161).
                const path = resolveLinkHref(props.filePath, href);
                // The anchor is tagged `data-md-rel` (so the click was already
                // preventDefault'd) yet didn't resolve to a repo path — a
                // traversal that escapes the repo root, or a fragment/query-only
                // href. Surface it rather than no-op silently, so a dead link
                // isn't indistinguishable from a working one.
                if (path === null) {
                  toast.error(`Can't open link: ${href}`);
                  return;
                }
                openInCodeTab({
                  ref: { path, startLine: null, endLine: null },
                  repoRoot: props.repoPath,
                  targetMode: "browse",
                  // GitHub-exact: open this path or fail. No fuzzy basename
                  // fallback — `docs/guide.md` must not silently open a
                  // same-basename `src/guide.md` (#1161).
                  allowBasenameFallback: false,
                });
              }}
              onNavigateWikilink={onNavigateWikilink}
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
        onSelect={openWikilinkPath}
        testIdPrefix="wikilink-disambiguation"
        maxHeight={280}
        truncate
        flip
      />
    </>
  );
};

export default BrowseFileDispatcher;
