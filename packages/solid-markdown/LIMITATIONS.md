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
(per-column alignment), task lists (**interactive** in the document preview —
a click writes the toggle back to the file), strikethrough, autolinks, thematic
breaks, hard/soft line breaks (the document preview folds a single newline to a
space, GitHub-faithfully; chat/dock keep message-style breaks).

GitHub extensions: **footnotes**, **`> [!NOTE]`/`[!WARNING]`/… alerts**, a
leading **YAML front-matter** block is stripped, **fenced-code syntax
highlighting** (Shiki, dual github-light/dark theme) with a **copy button**.

Inline HTML (sanitized): `<details>`/`<summary>`, `<kbd>`, `<sub>`/`<sup>`,
`<mark>`, `<p align>` wrappers, definition lists (`<dl>`), `<figure>`/
`<figcaption>`, table `<caption>`/`<colgroup>`, `<abbr>` (raw form). A
repo-relative image resolves against the document's directory and loads from the
host's file route; everything is themed for light/dark.

## Not implemented

These are genuine GitHub features we don't render yet:

| Feature | Behaviour today | What it needs |
| --- | --- | --- |
| **Math / LaTeX** (`$…$`, `$$…$$`, ` ```math `) | delimiters render literally | `marked-katex` + KaTeX CSS + an allowlist path |
| **Mermaid / diagram fences** (` ```mermaid `) | plain code block | a mermaid pass emitting SVG (SVG is not in the allowlist) |
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

## Partial / known edges

- **Heading permalinks** — ids + `#` jumps work, but there's no visible hover-¶.
- **`<picture>`/`<source>`** theme-aware README logos are stripped (only `<img>`).
- Inline raw tags outside the allowlist (`<q>`, `<cite>`, `<var>`, `<ruby>`,
  `<time>`, `<wbr>`) and raw `<ol type>` / `<colgroup style>` are dropped.
- Footnote a11y metadata (`aria-*`, the visually-hidden label) is stripped.
- Task-list write-back counts task markers with a scan that mirrors what the
  renderer indexes: it skips fenced code blocks and the leading YAML
  front-matter block (so a `- [ ]`-shaped line under a front-matter key never
  drifts the count), requires a space-or-tab run **then non-empty text** after
  the close bracket (so `- [ ]typo`, `- [ ]`, and `- [ ] ` — which `marked`
  renders as plain text, not a checkbox — are never counted), and honours the
  CommonMark fence-length rule (a shorter same-char fence inside a longer block,
  e.g. a ``` line inside a ```` block, is body, not a close). Only
  marked-syntax checkboxes are made interactive — the leading checkbox of an
  `<li>`, whether tight (`<li><input>`) or loose (`<li><p><input>`, the
  blank-line-separated form). A raw inline `<input type="checkbox">` in body
  text stays presentational so the two index spaces stay congruent. The one
  remaining edge: a task-looking line inside a **4-space indented** code block
  can miscount (rare), since indented code blocks aren't tracked.
