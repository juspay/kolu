/** Safe Markdown → SolidJS renderer, extracted from kolu's intent surface
 *  into a standalone, app-agnostic package — the first "appliance" in the
 *  code-browser-preview grid plan (`docs/plans/code-browser-preview.solid-fileview.html`).
 *
 *  Built on `marked` (GFM) with a `safeHref` allowlist and no raw-HTML
 *  injection: `html` tokens render as escaped *text*, never as markup, so
 *  the renderer is safe to point at untrusted file contents.
 *
 *  `variant` bundles a parse mode with a styling scale:
 *    - "inline"   — inline-only lexing; for single-line annotation slots.
 *    - "compact"  — block lexing at chat/dock scale (kolu's intent body).
 *    - "document" — block lexing at reading scale (full-pane previews).
 *
 *  Note: "document" renders headings as bold paragraphs (no per-level size
 *  hierarchy) — exactly as the intent surface always has. Real heading
 *  sizes are a deliberate later refinement for when the Code tab consumes
 *  this variant; keeping them flat here makes the extraction behaviour-
 *  preserving for today's only consumer. */

import { Lexer, marked, type Token, type Tokens } from "marked";
import { type Component, createMemo, For, type JSX, Show } from "solid-js";

const MARKED_OPTIONS = { breaks: true, gfm: true } as const;

export type MarkdownVariant = "inline" | "compact" | "document";

type Styles = {
  block: string;
  heading: string;
  code: string;
  codespan: string;
  tableWrap: string;
  table: string;
};

/** Per-scale class sets. "compact" reproduces the intent surface's
 *  long-standing chat-scale styling byte-for-byte; "document" is its
 *  reading-scale counterpart for full-pane previews. */
const STYLES: Record<"compact" | "document", Styles> = {
  compact: {
    block: "min-w-0 flex-1 space-y-1 break-words",
    heading: "m-0 text-[0.78rem] font-semibold leading-snug",
    code: "my-1 max-w-full overflow-x-auto rounded px-2 py-1 font-mono text-[0.67rem] leading-snug",
    codespan: "rounded px-1 py-0.5 font-mono text-[0.68rem]",
    tableWrap: "my-1 max-w-full overflow-x-auto",
    table: "w-full border-collapse text-[0.68rem]",
  },
  document: {
    block: "min-w-0 space-y-3 break-words text-sm leading-relaxed",
    heading: "m-0 mt-4 mb-1 text-base font-semibold leading-snug first:mt-0",
    code: "my-2 max-w-full overflow-x-auto rounded px-3 py-2 font-mono text-[0.8rem] leading-normal",
    codespan: "rounded px-1 py-0.5 font-mono text-[0.85em]",
    tableWrap: "my-2 max-w-full overflow-x-auto",
    table: "w-full border-collapse text-[0.85rem]",
  },
};

/** Threaded through the (non-component) render functions so they stay pure
 *  and don't reach for a context they can't read outside a component body. */
type Ctx = { links: boolean; styles: Styles };

const subtleBoxStyle = {
  "background-color": "color-mix(in oklch, currentColor 14%, transparent)",
};

function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed.startsWith("#")) return trimmed;
  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return trimmed;
    }
    if (url.protocol === "mailto:") return trimmed;
  } catch {
    // Invalid markdown links are shown as plain text.
    return undefined;
  }
  return undefined;
}

/** Render a sequence of parsed inline markdown tokens as Solid nodes. */
const InlineTokens: Component<{ tokens: Token[]; ctx: Ctx }> = (props) => (
  <For each={props.tokens}>{(token) => renderInline(token, props.ctx)}</For>
);

/** Render a sequence of parsed block markdown tokens as Solid nodes. */
const BlockTokens: Component<{ tokens: Token[]; ctx: Ctx }> = (props) => (
  <For each={props.tokens}>{(token) => renderBlock(token, props.ctx)}</For>
);

function renderBlock(token: Token, ctx: Ctx): JSX.Element {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "html":
      return (
        <p class="m-0 whitespace-pre-wrap break-words opacity-80">
          {(token as Tokens.HTML).text}
        </p>
      );
    case "heading":
      return (
        <p class={ctx.styles.heading}>
          <InlineTokens tokens={token.tokens ?? []} ctx={ctx} />
        </p>
      );
    case "paragraph":
      return (
        <p class="m-0">
          <InlineTokens tokens={token.tokens ?? []} ctx={ctx} />
        </p>
      );
    case "blockquote":
      return (
        <blockquote class="my-1 border-l-2 border-current/30 pl-2 opacity-90">
          <BlockTokens tokens={token.tokens ?? []} ctx={ctx} />
        </blockquote>
      );
    case "code":
      return (
        <pre class={ctx.styles.code} style={subtleBoxStyle}>
          <code>{token.text}</code>
        </pre>
      );
    case "hr":
      return <div class="my-1 h-px bg-current/25" />;
    case "list":
      return token.ordered ? (
        <ol
          class="my-1 list-decimal space-y-0.5 pl-4"
          start={typeof token.start === "number" ? token.start : undefined}
        >
          <For each={token.items}>{(item) => renderListItem(item, ctx)}</For>
        </ol>
      ) : (
        <ul class="my-1 list-disc space-y-0.5 pl-4">
          <For each={token.items}>{(item) => renderListItem(item, ctx)}</For>
        </ul>
      );
    case "table":
      return (
        <div class={ctx.styles.tableWrap}>
          <table class={ctx.styles.table}>
            <thead>
              <tr>
                <For each={token.header}>
                  {(cell) => (
                    <th
                      class="border-b border-current/25 px-1.5 py-0.5 text-left font-semibold"
                      style={{ "text-align": cell.align ?? "left" }}
                    >
                      <InlineTokens tokens={cell.tokens} ctx={ctx} />
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={token.rows}>
                {(row) => (
                  <tr>
                    <For each={row}>
                      {(cell) => (
                        <td
                          class="border-b border-current/10 px-1.5 py-0.5"
                          style={{ "text-align": cell.align ?? "left" }}
                        >
                          <InlineTokens tokens={cell.tokens} ctx={ctx} />
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      );
    case "text":
      return (
        <p class="m-0">
          <InlineTokens tokens={token.tokens ?? [token]} ctx={ctx} />
        </p>
      );
    default:
      return null;
  }
}

function renderListItem(item: Tokens.ListItem, ctx: Ctx): JSX.Element {
  return (
    <li>
      <Show when={item.task}>
        <span class="mr-1 font-mono opacity-70">
          {item.checked ? "[x]" : "[ ]"}
        </span>
      </Show>
      <BlockTokens tokens={item.tokens} ctx={ctx} />
    </li>
  );
}

function renderInline(token: Token, ctx: Ctx): JSX.Element {
  switch (token.type) {
    case "escape":
      return token.text;
    case "text":
      return token.tokens ? (
        <InlineTokens tokens={token.tokens} ctx={ctx} />
      ) : (
        token.text
      );
    case "strong":
      return (
        <strong class="font-semibold">
          <InlineTokens tokens={token.tokens ?? []} ctx={ctx} />
        </strong>
      );
    case "em":
      return (
        <em>
          <InlineTokens tokens={token.tokens ?? []} ctx={ctx} />
        </em>
      );
    case "del":
      return (
        <del class="opacity-75">
          <InlineTokens tokens={token.tokens ?? []} ctx={ctx} />
        </del>
      );
    case "codespan":
      return (
        <code class={ctx.styles.codespan} style={subtleBoxStyle}>
          {token.text}
        </code>
      );
    case "br":
      return <br />;
    case "link": {
      const href = safeHref(token.href);
      const content = <InlineTokens tokens={token.tokens ?? []} ctx={ctx} />;
      return href && ctx.links ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          class="pointer-events-auto underline decoration-current/40 underline-offset-2 hover:decoration-current"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {content}
        </a>
      ) : (
        <span>{content}</span>
      );
    }
    case "image":
      return <span class="font-mono opacity-75">{token.text}</span>;
    case "html":
      return <span class="opacity-80">{(token as Tokens.HTML).text}</span>;
    case "checkbox":
      return (
        <span class="font-mono opacity-70">
          {token.checked ? "[x]" : "[ ]"}
        </span>
      );
    default:
      return null;
  }
}

/** Render Markdown as safe SolidJS nodes. `variant` picks parse mode +
 *  styling scale; `links` enables anchor rendering (off → links render as
 *  plain text, so a host slot's click handler isn't preempted by a nested
 *  anchor). `links` defaults on for block variants, off for inline. */
export const Markdown: Component<{
  markdown: string;
  variant?: MarkdownVariant;
  links?: boolean;
}> = (props) => {
  const variant = (): MarkdownVariant => props.variant ?? "document";
  const styles = (): Styles =>
    STYLES[variant() === "document" ? "document" : "compact"];
  const ctx = (): Ctx => ({
    links: props.links ?? variant() !== "inline",
    styles: styles(),
  });
  const tokens = createMemo<Token[]>(() =>
    variant() === "inline"
      ? Lexer.lexInline(props.markdown, MARKED_OPTIONS)
      : marked.lexer(props.markdown, MARKED_OPTIONS),
  );

  return (
    <Show
      when={variant() !== "inline"}
      fallback={<InlineTokens tokens={tokens()} ctx={ctx()} />}
    >
      <div class={styles().block}>
        <BlockTokens tokens={tokens()} ctx={ctx()} />
      </div>
    </Show>
  );
};
