# @kolu/file-line-ref

Source-reference parsing in `path:line[-end]` shape. Terminal output,
log excerpts, git messages, GitHub URL fragments, Linear-style
snippets, VS Code's `:e file:N` — they all share the same wire
format, and this is the single place that knows how to read and
format it.

## API

- `LineRef = { path, startLine, endLine }` — parsed reference;
  `startLine` / `endLine` are `null` when the source had no `:N`.
- `LineRefMatch = LineRef & { text, index }` — match plus source
  positions, for `Linkprovider.range`-shaped consumers.
- `parseLineRefs(text)` — scan a string for every embedded reference.
- `formatLineRef(path, startLine, endLine)` — render a `LineRef`
  back to the canonical wire format.
- `resolveLineRefPath({ rawPath, repoRoot, cwd, paths })` — resolve
  a parsed `path` against a worktree's known file list, considering
  absolute, cwd-relative, and basename-only inputs.

## Encapsulated axis

The wire format for `path:line[-end]`. Adding column references
(`path:L:C`) or a workspace prefix (`@workspace/path:L`) would all
change here; consumers stay on the shape they bind against
(`LineRef`).
