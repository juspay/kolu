# @kolu/solid-markdown

Markdown rendered into themed, sanitized DOM for a Solid app. The pipeline is
three stages: `marked` in GFM mode parses to raw HTML (`src/render.ts`),
DOMPurify sanitizes it (`src/sanitize.ts`), and the `Markdown` component mounts
the result in a `.kolu-md` container.

Finished ` ```mermaid ` blocks take a side path. `render.ts` lists them
(`mermaidSources`), `src/diagram.ts` draws each distinct source once in a
hidden sandboxed iframe (`src/diagram-frame.ts`, running
`src/diagram-frame-program.js`) and remembers the result, and the sanitize pass
swaps each drawn block for a `<figure>` holding a light and a dark `<img>`.

| Entry | What it holds |
| --- | --- |
| `.` | `Markdown`, `MarkdownVariant`, `bindMarkdownLinks`, `decorateInlineCode`, `InlineCodeAction`, `resolveWikilink`, `WikilinkResolution`. |
| `./render` | `renderMarkdownToRawHtml`, `splitFrontMatter`, `mermaidSources`, `DIAGRAM_LANG`, `RenderOptions`. Output is untrusted HTML. |
| `./url-policy` | `safeHref`, `isLoadableImage`, and a re-export of `hasOwnScheme`. |
| `./markdown.css` | The stylesheet, scoped to `.kolu-md`. |

Depended on by `kolu-client` and `@kolu/solid-fileview`. It depends on
`@kolu/html-escape` and `@kolu/url-shape` inside the workspace, plus `marked`
and three of its plugins, `dompurify`, `shiki`, `yaml`, `solid-js` and
`mermaid`. Only mermaid's prebuilt single file is used, as an asset URL loaded
into the frame.

## Variants

`variant` picks the parse mode and the styling scale.

- `inline` — inline-only parse, no block wrapper, for annotation slots. Links
  default off, so the slot's own click handler wins.
- `compact` — block parse at chat and dock scale. Draws finished mermaid
  blocks.
- `document` — full-pane preview: GitHub-faithful soft breaks, Shiki
  highlighting, copy buttons, front-matter table, read-only task-list
  checkboxes, and finished mermaid blocks drawn as diagrams. The preview never
  writes back to the file.

`inline` never draws a diagram: a one-line parse cannot hold a code block.

The host wires the parts that are its concern: `resolveImageSrc` for a
repo-relative image, `onNavigateRelative` for a repo-relative link,
`onNavigateWikilink` for `[[Note]]`, and `onFootnote` for a footnote popover.
Each one unwired leaves that link kind inert, never navigating the app origin.
`onRendered` is called with the container after every write of rendered HTML,
including a re-render with unchanged text when a diagram lands. It is where a
host re-applies its own passes over the rendered DOM.

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
- Mermaid runs only inside the sandboxed frame (`sandbox="allow-scripts"`, a
  CSP with no network). Never import `mermaid` into the page; the only
  reference is the `?url` asset path in `diagram-frame.ts`.
- A diagram's SVG reaches the page only as an `<img>` source (a `data:` URL),
  and an error message only as `textContent`. Never parse either as markup.
- Only a block whose closing fence has arrived is a diagram. An unfinished
  block stays a code block, so streaming text never flashes a parse error.
- `LIMITATIONS.md` lists what the renderer does not support, such as maths and
  emoji shortcodes. Keep it in step when you add or drop a feature.

Tests sit beside each stage: `render.test.ts`, `sanitize.test.ts`,
`diagram.test.ts`, `url-policy.test.ts`, `wikilink.test.ts`,
`highlight.test.ts` and `inlineCode.test.ts`.
