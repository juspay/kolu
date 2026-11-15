# @kolu/html-escape

One function, for interpolating a string into HTML text or an attribute value.
Zero dependencies, workspace ones included.

- `escapeHtml(s)` replaces `&`, `<`, `>`, `"` and `'`. The apostrophe is in the
  set because an attribute value may end up single-quoted.

It is its own leaf package so that app-agnostic appliances can reach it. The
static transcript renderer and the scrollback export need five string
replacements, not the whole domain contract package and its agent, git and oRPC
tree.

The single entry is `.`, which is `src/index.ts`. Depended on by `kolu-client`,
`@kolu/solid-markdown`, `@kolu/terminal-snapshot` and `@kolu/transcript-html`.

## What not to break

- No workspace dependency, and no runtime dependency, ever. That is the reason
  the package exists.
- Keep all five characters in the table. Dropping the apostrophe makes every
  single-quoted attribute injectable.
