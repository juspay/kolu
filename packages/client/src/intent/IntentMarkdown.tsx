import { Lexer, marked, type Token, type Tokens } from "marked";
import { type Component, createMemo, For, type JSX, Show } from "solid-js";

const MARKED_OPTIONS = { breaks: true, gfm: true } as const;

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

const subtleBoxStyle = {
  "background-color": "color-mix(in oklch, currentColor 14%, transparent)",
};

/** Render a sequence of parsed inline markdown tokens as Solid nodes. */
const InlineTokens: Component<{ tokens: Token[]; links: boolean }> = (
  props,
) => (
  <For each={props.tokens}>{(token) => renderInline(token, props.links)}</For>
);

/** Render a sequence of parsed block markdown tokens as Solid nodes. */
const BlockTokens: Component<{ tokens: Token[]; links: boolean }> = (props) => (
  <For each={props.tokens}>{(token) => renderBlock(token, props.links)}</For>
);

function renderBlock(token: Token, links: boolean): JSX.Element {
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
        <p class="m-0 text-[0.78rem] font-semibold leading-snug">
          <InlineTokens tokens={token.tokens ?? []} links={links} />
        </p>
      );
    case "paragraph":
      return (
        <p class="m-0">
          <InlineTokens tokens={token.tokens ?? []} links={links} />
        </p>
      );
    case "blockquote":
      return (
        <blockquote class="my-1 border-l-2 border-current/30 pl-2 opacity-90">
          <BlockTokens tokens={token.tokens ?? []} links={links} />
        </blockquote>
      );
    case "code":
      return (
        <pre
          class="my-1 max-w-full overflow-x-auto rounded px-2 py-1 font-mono text-[0.67rem] leading-snug"
          style={subtleBoxStyle}
        >
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
          <For each={token.items}>{(item) => renderListItem(item, links)}</For>
        </ol>
      ) : (
        <ul class="my-1 list-disc space-y-0.5 pl-4">
          <For each={token.items}>{(item) => renderListItem(item, links)}</For>
        </ul>
      );
    case "table":
      return (
        <div class="my-1 max-w-full overflow-x-auto">
          <table class="w-full border-collapse text-[0.68rem]">
            <thead>
              <tr>
                <For each={token.header}>
                  {(cell) => (
                    <th
                      class="border-b border-current/25 px-1.5 py-0.5 text-left font-semibold"
                      style={{ "text-align": cell.align ?? "left" }}
                    >
                      <InlineTokens tokens={cell.tokens} links={links} />
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
                          <InlineTokens tokens={cell.tokens} links={links} />
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
          <InlineTokens tokens={token.tokens ?? [token]} links={links} />
        </p>
      );
    default:
      return null;
  }
}

function renderListItem(item: Tokens.ListItem, links: boolean): JSX.Element {
  return (
    <li>
      <Show when={item.task}>
        <span class="mr-1 font-mono opacity-70">
          {item.checked ? "[x]" : "[ ]"}
        </span>
      </Show>
      <BlockTokens tokens={item.tokens} links={links} />
    </li>
  );
}

function renderInline(token: Token, links: boolean): JSX.Element {
  switch (token.type) {
    case "escape":
      return token.text;
    case "text":
      return token.tokens ? (
        <InlineTokens tokens={token.tokens} links={links} />
      ) : (
        token.text
      );
    case "strong":
      return (
        <strong class="font-semibold">
          <InlineTokens tokens={token.tokens ?? []} links={links} />
        </strong>
      );
    case "em":
      return (
        <em>
          <InlineTokens tokens={token.tokens ?? []} links={links} />
        </em>
      );
    case "del":
      return (
        <del class="opacity-75">
          <InlineTokens tokens={token.tokens ?? []} links={links} />
        </del>
      );
    case "codespan":
      return (
        <code
          class="rounded px-1 py-0.5 font-mono text-[0.68rem]"
          style={subtleBoxStyle}
        >
          {token.text}
        </code>
      );
    case "br":
      return <br />;
    case "link": {
      const href = safeHref(token.href);
      const content = (
        <InlineTokens tokens={token.tokens ?? []} links={links} />
      );
      return href && links ? (
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

/** Safe markdown renderer for full intent text in workspace surfaces. */
export const IntentMarkdownBlock: Component<{
  markdown: string;
  links?: boolean;
}> = (props) => {
  const tokens = createMemo(() => marked.lexer(props.markdown, MARKED_OPTIONS));
  return (
    <div class="min-w-0 flex-1 space-y-1 break-words">
      <BlockTokens tokens={tokens()} links={props.links ?? true} />
    </div>
  );
};

/** Inline-only markdown renderer for the annotation slot — line 1 of
 *  intent renders alongside the branch-fallback case so a user's
 *  `**bold**`, `` `code` ``, and `[link](url)` show in the title bar,
 *  dock rows, switcher cards, and sub-panel tabs. Returns plain text
 *  for non-markdown input (e.g. branch names). Links default to off
 *  so the slot's click handler (open editor / open palette) isn't
 *  preempted by a nested anchor. */
export const IntentMarkdownInline: Component<{
  markdown: string;
  links?: boolean;
}> = (props) => {
  const tokens = createMemo(() =>
    Lexer.lexInline(props.markdown, MARKED_OPTIONS),
  );
  return <InlineTokens tokens={tokens()} links={props.links ?? false} />;
};
