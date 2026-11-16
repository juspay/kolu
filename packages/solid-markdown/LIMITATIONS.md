# `@kolu/solid-markdown` — what's supported, and what isn't

The renderer is `marked` (GFM) + a few plugins → DOMPurify (a tight,
Markdown-only allowlist) → the themed `.kolu-md` stylesheet. This file is the
honest inventory of where it stops, derived from an empirical feature audit
(run the real config against a CommonMark/GFM/extended corpus). Keep it in sync
when you add or drop a feature.

## Supported

CommonMark + GFM: headings (with stable anchor ids + in-page `#` jumps),
paragraphs, emphasis/strong, inline + fenced code, blockquotes (incl. nested),
ordered/unordered/nested lists (real markers; `start` honoured), GFM tables
(per-column alignment), task lists (rendered **read-only** — checkboxes show
their `[x]`/`[ ]` state but are presentational, like GitHub renders a README's
task list; the preview never writes back to the file), strikethrough, autolinks, thematic
breaks, hard/soft line breaks (the document preview folds a single newline to a
space, GitHub-faithfully; chat/dock keep message-style breaks).

GitHub extensions: **footnotes**, **`> [!NOTE]`/`[!WARNING]`/… alerts**, a
leading **YAML front-matter** block renders as a **metadata table** in the
document preview (keys in a header column, values beside them — GitHub-faithful;
front-matter that can't be tabulated — malformed YAML, or a non-mapping block —
is shown raw as a YAML code block rather than dropped), and is dropped in the
compact intent slot. **Fenced-code syntax highlighting** (Shiki,
dual github-light/dark theme) with a **copy button**.

**Mermaid diagrams**: a finished ` ```mermaid ` fence draws as a diagram in the
`document` and `compact` variants (the Code tab preview, the Conductor reader
and its pop-out, the Conductor chat, the intent editor's preview). Mermaid runs
in a hidden sandboxed iframe, one per diagram, thrown away once it has drawn,
and the drawing is shown as an image, with
mermaid's own light and dark themes following the app. A block mermaid rejects
keeps its source and shows mermaid's message under it; so does every block
when the renderer cannot load or times out.

Inline HTML (sanitized): `<details>`/`<summary>`, `<kbd>`, `<sub>`/`<sup>`,
`<mark>`, `<p align>` wrappers, definition lists (`<dl>`), `<figure>`/
`<figcaption>`, table `<caption>`/`<colgroup>`, `<abbr>` (raw form). A
repo-relative image resolves against the document's directory and loads from the
host's file route; a repo-relative **link** likewise resolves against the
document's directory and, on click, opens the target file in the host (the Code
tab) rather than navigating the app origin — GitHub-faithfully (a trailing
`#fragment` opens the file but doesn't yet scroll to the heading). Everything is
themed for light/dark.

**Obsidian-style wikilinks** (`[[Note]]`, `[[Note|alias]]`, `[[Note#heading]]`)
render as a visually distinct (violet, bracketed) anchor and resolve *pathless*
across the whole repo: `[[Architecture]]` opens `Architecture.md` (only `.md`
implied — never a same-stemmed `Architecture.feature`) wherever it lives, with no
directory hint. A qualified `[[docs/Note]]` narrows to that directory. Resolution is lazy (on click) and routes through the
same Code-tab front door; an ambiguous basename surfaces a disambiguation menu
anchored to the link, and a miss toasts. The `![[…]]` **embed/transclusion**
form is deliberately left inert (literal text), and a `#heading` opens the file
but doesn't scroll to the heading — same as relative links.

## Not implemented

These are genuine GitHub features we don't render yet:

| Feature | Behaviour today | What it needs |
| --- | --- | --- |
| **Math / LaTeX** (`$…$`, `$$…$$`, ` ```math `) | delimiters render literally | `marked-katex` + KaTeX CSS + an allowlist path |
| **Emoji shortcodes** (`:tada:`) | literal text (Unicode `🎉` works) | `marked-emoji` / a shortcode→unicode map |
| **`@mention` autolinks** | literal text | a custom inline extension + a host profile-URL base |
| **`#123` / `GH-99` / commit-SHA autolinks** | literal text | a custom inline extension + a host repo context |
| **GFM "disallowed raw HTML" neutralization** | we hard-*strip* the tags (safe, not byte-identical) | the spec's neutralize-don't-remove behaviour |

## Not implemented (non-GitHub ecosystem syntax)

GitHub itself does **not** render these either — they're markdown-it / Pandoc /
Obsidian extensions. Listed for completeness; low priority.

- `==highlight==`, `^superscript^`, `~subscript~` (single `~` is GFM strike),
  `++inserted++` markdown syntax — the `<mark>`/`<sup>`/`<sub>`/`<ins>` tags are
  allowlisted, so only the parser shorthand is missing.
- Definition-list `Term / : def` markdown syntax (raw `<dl>` works).
- Abbreviations `*[HTML]: …`, `[[TOC]]` generation, inline footnotes
  `^[note]`, image-dimension `![](url =200x100)`, TOML front-matter (`+++`).
- Obsidian `![[…]]` **embeds/transclusion** (the `[[…]]` *link* form IS
  supported — see above; only inlining the referenced note's content isn't).

## Partial / known edges

- **Heading permalinks** — ids + `#` jumps work, but there's no visible hover-¶.
- **Mermaid diagrams are pictures.** A block counts as a diagram only once its
  closing fence has arrived; until then (a streaming answer, a half-typed
  intent, a file still being written or cut by the size limit) it is a plain
  code block. Diagram text cannot be selected or found with the browser's
  search, links inside a diagram do nothing, and there is no zoom or pan. Only
  ` ```mermaid ` fences draw (not `.mmd` files), and an empty block stays an
  empty code block. Icons and remote images inside labels do not load: the
  renderer's policy blocks fetches and images.
- **`<picture>`/`<source>`** theme-aware README logos are stripped (only `<img>`).
- Inline raw tags outside the allowlist (`<q>`, `<cite>`, `<var>`, `<ruby>`,
  `<time>`, `<wbr>`) and raw `<ol type>` / `<colgroup style>` are dropped.
- Footnote a11y metadata (`aria-*`, the visually-hidden label) is stripped.
- **Footnote popover is pointer-only.** A footnote forward-ref is flagged
  (`data-md-footnote`) so the host can open its definition in a click/tap
  popover anchored to the marker. The interception is gated on a *pointer*
  activation (`click.detail > 0`): a **keyboard** activation (Enter/Space on the
  focused marker) falls through to the in-page jump-to-definition scroll instead,
  landing on the bottom footnotes list — the accessible record. Full keyboard
  semantics (a managed-focus popover with an `aria-details` relationship) are a
  tracked follow-up. The marker (`data-md-footnote`) is parser-minted, never
  honoured on a raw README anchor that merely declared it — the renderer strips
  any document-authored `data-md-footnote*` before re-minting (the same spoof
  guard the wikilink marker uses).
- **Task lists are read-only.** Checkboxes render with their `[x]`/`[ ]` state
  but are `disabled` (presentational) — the preview never writes a toggle back
  to the file, the way GitHub renders a README's task list.
