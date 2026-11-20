import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  onCleanup,
  untrack,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { type Diagram, diagrams as diagramCache } from "./diagram";
import { highlightCode, loadHighlighter } from "./highlight";
import { decorateInlineCode, type InlineCodeAction } from "./inlineCode";
import {
  DIAGRAM_LANG,
  mermaidSources,
  renderMarkdownToRawHtml,
} from "./render";
import { sanitizeHtml } from "./sanitize";

export type MarkdownVariant = "inline" | "compact" | "document";

const NO_SOURCES: readonly string[] = [];

function sameSources(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((source, i) => source === b[i]);
}

function copyCodeBlock(button: HTMLElement): void {
  const pre = button.closest(".kolu-md-code")?.querySelector("pre");
  const text = pre?.textContent ?? "";
  if (!text) return;
  void navigator.clipboard
    ?.writeText(text)
    .then(() => {
      button.setAttribute("data-copied", "");
      setTimeout(() => button.removeAttribute("data-copied"), 1500);
    })
    .catch((err) => console.warn("markdown: copy to clipboard failed", err));
}

type LinkHandlers = {
  onNavigateRelative?: (href: string) => void;
  /** A wikilink click — the host resolves `target` (`Note` / `Note#Heading`)
   *  against the whole repo. `anchor` is the clicked element so the host can
   *  anchor a disambiguation menu to it when the target is ambiguous. */
  onNavigateWikilink?: (target: string, anchor: HTMLElement) => void;
  /** A footnote forward-reference click — the host opens the definition in a
   *  popover anchored to the marker. `anchor` is the clicked `[n]` marker;
   *  `definition` is its resolved `<li>` in the bottom footnotes list. */
  onFootnote?: (anchor: HTMLElement, definition: HTMLElement) => void;
  /** A press on an inline code span the host answered for (`inlineCode`):
   *  its exact text, and the button pressed, to anchor a menu to. */
  onInlineCode?: (text: string, anchor: HTMLElement) => void;
};

/** Own the click-dispatch over `.kolu-md` DOM: code-copy buttons, in-page
 *  anchors, and the intercepted link kinds (`LinkHandlers`). This is the single
 *  home for the `data-md-*` flag → host-handler mapping the renderer mints —
 *  every consumer that renders sanitized Markdown DOM (the document preview, the
 *  footnote popover) plugs into it instead of re-deriving the routing.
 *
 *  Bound imperatively (not via JSX `onClick`) because these are delegated
 *  handlers over sanitizer-minted DOM, not declarative element interactions the
 *  a11y lint would expect a role for.
 *
 *  Stops the anchor/copy bubble so a nested control in a clickable host slot
 *  (dock card, switcher card) doesn't double-fire that slot's handler. The
 *  cleanup is owned by the calling reactive scope (Solid `onCleanup`). */
export function bindMarkdownLinks(
  el: HTMLElement,
  handlers: LinkHandlers,
): void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;

    const codeAction = target.closest<HTMLElement>("[data-md-code-action]");
    if (codeAction) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onInlineCode?.(
        codeAction.getAttribute("data-md-code-action") ?? "",
        codeAction,
      );
      return;
    }

    const copyButton = target.closest<HTMLElement>("[data-md-copy]");
    if (copyButton) {
      e.preventDefault();
      e.stopPropagation();
      copyCodeBlock(copyButton);
      return;
    }

    const anchor = target.closest("a");
    if (anchor) {
      e.stopPropagation();
      const href = anchor.getAttribute("href");
      // This must come *before* the generic in-page-anchor branch below —
      // a footnote ref's href is also an in-page `#md-footnote-…`, so without
      // this it would just scroll.
      //
      // Pointer-only by design (see LIMITATIONS.md): the popover has no keyboard
      // focus/announcement relationship yet, so a *keyboard* activation of the
      // focused marker (Enter/Space) must keep the accessible jump-to-definition
      // instead of opening an unmanaged portal popover. A keyboard-synthesized
      // `click` reports `detail === 0` (no pointer click-count); a real
      // pointer/tap reports `detail >= 1`. So gate the popover on `detail > 0`
      // and let a keyboard activation fall through to the in-page-anchor scroll
      // branch below — which lands on the bottom-list definition, the accessible
      // record. (Removing this gate is the keyboard-a11y follow-up.)
      if (
        handlers.onFootnote &&
        e.detail > 0 &&
        anchor.hasAttribute("data-md-footnote") &&
        href?.startsWith("#") &&
        href.length > 1
      ) {
        const definition = el.querySelector(`#${CSS.escape(href.slice(1))}`);
        if (definition) {
          e.preventDefault();
          handlers.onFootnote(anchor as HTMLElement, definition as HTMLElement);
          return;
        }
      }
      // We `preventDefault` *unconditionally* — before checking whether the
      // target exists — because an `href="#…"` is only ever a within-preview
      // jump; letting the browser perform a real hash navigation against the
      // app document is never the intent.
      if (href?.startsWith("#") && href.length > 1) {
        e.preventDefault();
        const landing = el.querySelector(`#${CSS.escape(href.slice(1))}`);
        landing?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const wikilinkTarget = anchor.getAttribute("data-md-wikilink");
      if (wikilinkTarget !== null) {
        e.preventDefault();
        if (wikilinkTarget)
          handlers.onNavigateWikilink?.(wikilinkTarget, anchor);
        return;
      }
      if (anchor.hasAttribute("data-md-rel")) {
        e.preventDefault();
        if (href) handlers.onNavigateRelative?.(href);
      }
    }
  };
  el.addEventListener("click", onClick);
  onCleanup(() => el.removeEventListener("click", onClick));
}

function bindInteractions(el: HTMLElement, handlers: LinkHandlers): void {
  bindMarkdownLinks(el, handlers);
  const onPointerDown = (e: Event) => {
    const target = e.target as Element | null;
    if (target?.closest?.("a, [data-md-copy], [data-md-code-action]")) {
      e.stopPropagation();
    }
  };
  el.addEventListener("pointerdown", onPointerDown);
  onCleanup(() => el.removeEventListener("pointerdown", onPointerDown));
}

export const Markdown: Component<{
  markdown: string;
  variant?: MarkdownVariant;
  links?: boolean;
  /** Resolve a repo-relative image `src` to a loadable URL (see
   *  `SanitizeOptions.resolveImageSrc`). Document variant only. */
  resolveImageSrc?: (src: string) => string | undefined;
  /** Open a repo-relative *link* `href` (a scheme-less `[doc](docs/guide.md)`)
   *  in the host instead of letting the browser navigate the app origin in a
   *  new tab (#1161). The host resolves the path against the previewed file and
   *  opens it (e.g. in the Code tab). Unwired ⇒ such links are inert. */
  onNavigateRelative?: (href: string) => void;
  /** Open an Obsidian-style `[[wikilink]]` in the host. Unlike a relative link,
   *  the `target` (`Note` / `Note#Heading`) resolves *pathless* across the
   *  whole repo. `anchor` is the clicked element, so the host can anchor a
   *  disambiguation menu to it when the basename matches more than one file.
   *  Unwired ⇒ wikilinks are inert. */
  onNavigateWikilink?: (target: string, anchor: HTMLElement) => void;
  /** Open a footnote definition in a host popover when its `[n]` marker is
   *  clicked. `anchor` is the clicked marker; `definition` is its `<li>` in the
   *  bottom footnotes list (the popover reads its content from there). Unwired
   *  ⇒ a footnote ref keeps its default jump-to-definition scroll. Document
   *  variant only. */
  onFootnote?: (anchor: HTMLElement, definition: HTMLElement) => void;
  /** INLINE CODE THE HOST CAN ACT ON. `action` answers for one span's exact
   *  text — a name for pressing it and whether it is the one open now — or
   *  `undefined` to leave it plain code; `onPress` gets a press on one it
   *  answered for. Read reactively: a span becomes pressable the moment the
   *  host can act on it. Code blocks are never touched (`./inlineCode`). */
  inlineCode?: {
    readonly action: (text: string) => InlineCodeAction | undefined;
    readonly onPress: (text: string, anchor: HTMLElement) => void;
  };
  /** Called after EVERY write of rendered HTML into the container — the first
   *  paint, a text change, and a re-render with the same text (a diagram
   *  landing, the highlighter warming up). This is where a host re-applies its
   *  own passes over the rendered DOM: each write replaces everything inside
   *  the container. Runs after the DOM is in place, in the same update,
   *  untracked. */
  onRendered?: () => void;
}> = (props) => {
  const variant = (): MarkdownVariant => props.variant ?? "document";
  const isDocument = () => variant() === "document";
  const links = () => props.links ?? variant() !== "inline";

  const hasCodeFence = () => /^[ \t]{0,3}(?:```|~~~)/m.test(props.markdown);
  const [highlighter] = createResource(
    () => (isDocument() && hasCodeFence()) || undefined,
    () =>
      loadHighlighter().catch((err) => {
        console.warn(
          "markdown: shiki highlighter failed to load; code renders plain",
          err,
        );
        return null;
      }),
  );

  const sources = createMemo(
    (): readonly string[] =>
      variant() === "inline" || !props.markdown.includes(DIAGRAM_LANG)
        ? NO_SOURCES
        : mermaidSources(props.markdown),
    NO_SOURCES,
    { equals: sameSources },
  );
  const [diagrams] = createResource(
    () => (sources().length > 0 ? sources() : false),
    (list): Map<string, Diagram> | Promise<Map<string, Diagram>> => {
      const known = list.map((s) => [s, diagramCache.peek(s)] as const);
      if (known.every(([, d]) => d !== undefined)) {
        return new Map(known as (readonly [string, Diagram])[]);
      }
      return Promise.all(
        list.map(async (s) => [s, await diagramCache.load(s)] as const),
      ).then((entries) => new Map(entries));
    },
  );

  const html = createMemo(() => {
    const drawn = diagrams();
    const sanitized = sanitizeHtml(
      renderMarkdownToRawHtml(props.markdown, {
        inline: variant() === "inline",
        breaks: !isDocument(),
        rawHtml: isDocument(),
        frontMatter: isDocument(),
      }),
      {
        links: links(),
        richHtml: isDocument(),
        resolveImageSrc: props.resolveImageSrc,
        highlightCode:
          isDocument() && highlighter() != null ? highlightCode : undefined,
        diagram: (source) => drawn?.get(source),
      },
    );
    const inlineCode = props.inlineCode;
    return inlineCode === undefined
      ? sanitized
      : decorateInlineCode(sanitized, inlineCode.action);
  });

  createEffect(() => {
    html();
    untrack(() => props.onRendered?.());
  });

  return (
    <Dynamic
      component={variant() === "inline" ? "span" : "div"}
      ref={(el: HTMLElement) =>
        bindInteractions(el, {
          get onNavigateRelative() {
            return props.onNavigateRelative;
          },
          get onNavigateWikilink() {
            return props.onNavigateWikilink;
          },
          get onFootnote() {
            return props.onFootnote;
          },
          get onInlineCode() {
            return props.inlineCode?.onPress;
          },
        })
      }
      class="kolu-md"
      data-md-variant={variant()}
      innerHTML={html()}
    />
  );
};
