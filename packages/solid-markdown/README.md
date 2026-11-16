# @kolu/solid-markdown

Markdown rendered into themed, sanitized DOM for a Solid app. The pipeline is
three stages: `marked` in GFM mode parses to raw HTML (`src/render.ts`),
DOMPurify sanitizes it (`src/sanitize.ts`), and the `Markdown` component mounts
the result in a `.kolu-md` container.

| Entry | What it holds |
| --- | --- |
| `.` | `Markdown`, `MarkdownVariant`, `bindMarkdownLinks`, `decorateInlineCode`, `InlineCodeAction`, `resolveWikilink`, `WikilinkResolution`. |
| `./render` | `renderMarkdownToRawHtml`, `splitFrontMatter`, `RenderOptions`. Output is untrusted HTML. |
| `./url-policy` | `safeHref`, `isLoadableImage`, and a re-export of `hasOwnScheme`. |
| `./markdown.css` | The stylesheet, scoped to `.kolu-md`. |

Depended on by `kolu-client` and `@kolu/solid-fileview`. It depends on
`@kolu/html-escape` and `@kolu/url-shape` inside the workspace, plus `marked`
and three of its plugins, `dompurify`, `shiki`, `yaml` and `solid-js`.

## Variants

`variant` picks the parse mode and the styling scale.

- `inline` — inline-only parse, no block wrapper, for annotation slots. Links
  default off, so the slot's own click handler wins.
- `compact` — block parse at chat and dock scale.
- `document` — full-pane preview: GitHub-faithful soft breaks, Shiki
  highlighting, copy buttons, front-matter table, and read-only task-list
  checkboxes. The preview never writes back to the file.

The host wires the parts that are its concern: `resolveImageSrc` for a
repo-relative image, `onNavigateRelative` for a repo-relative link,
`onNavigateWikilink` for `[[Note]]`, and `onFootnote` for a footnote popover.
Each one unwired leaves that link kind inert, never navigating the app origin.

`inlineCode` makes inline code a host can act on pressable. The host answers
for one span's exact text (`action`: a name for the press and whether it is
open now, or `undefined`), and a span it answers for becomes a `<button>`
around the same `<code>`, with that name as its `aria-label`. `onPress` gets
the text and the button. kolu's Conductor uses it to open a file it names.

## What not to break

- Raw HTML from `./render` must pass through `sanitizeHtml` before it reaches
  the DOM. Keeping the parse layer DOM-free is what lets it be tested in plain
  Node, where DOMPurify and `window` are absent.
- Link and image policy live in the sanitize pass only. Markdown-minted tags and
  inline HTML tags converge there, so one decision covers both.
- `rawHtml` is decided at the token level, not by the tag allowlist. A compact
  or inline slot is a UI row built from user and agent strings, so a raw `<h1>`
  or `<a>` must render as literal text there.
- Shiki output is trusted markup because Shiki escapes the code text itself. Any
  other injected HTML is not.
- `resolveWikilink` matches whole basenames, never stems: `[[lua-filters]]`
  resolves to `lua-filters.md` and not to `lua-filters.feature`. Matching is
  NFC-normalized and the returned path is the verbatim repo entry.
- `bindMarkdownLinks` is the single home for the `data-md-*` flag to handler
  mapping. Every consumer of sanitized Markdown DOM plugs into it rather than
  re-deriving the routing.
- `decorateInlineCode` runs after the sanitizer and only moves the `<code>`
  nodes the sanitizer produced into buttons it builds itself, so a span's text
  can never become markup. Code inside `<pre>` is never touched.
- `LIMITATIONS.md` lists what the renderer does not support, such as maths,
  mermaid and emoji shortcodes. Keep it in step when you add or drop a feature.

Tests sit beside each stage: `render.test.ts`, `sanitize.test.ts`,
`url-policy.test.ts`, `wikilink.test.ts`, `highlight.test.ts` and
`inlineCode.test.ts`.
