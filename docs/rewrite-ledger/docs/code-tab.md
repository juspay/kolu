# code-tab

- Kind: how-to. Reader: someone reading files and diffs beside a terminal while an agent works.
- Rewritten from: `f50641c6a`
- Words: 996 → 770
- Frontmatter: description 224 → 149 characters. Other keys unchanged. Removed the unused `Aside` import (the page uses none).

## Headings

| Old | New |
| --- | --- |
| Browse and jump | Browse and jump |
| Your git changes — live | Your git changes, live |
| — | Filter the tree (new `###`) |
| — | See ignored files (new `###`) |
| — | A folder replaced by a file (new `###`) |
| Markdown and artifacts | Markdown and artifacts (kept: linked from the changelog) |
| File comments | File comments |

Links updated in `website/src/content/changelog/unreleased.mdx`:

- line 122: `/code-tab#your-git-changes--live` → `/code-tab#your-git-changes-live`
- line 124: `/code-tab#your-git-changes--live` → `/code-tab#a-folder-replaced-by-a-file`
- line 126: `/code-tab#your-git-changes--live` → `/code-tab#filter-the-tree`

No other page links into this one's headings.

## Moved

- The panel header line naming the pane's directory, the repo root emphasis, and the tab/file selection following the focused pane → `right-panel` "What the panel remembers". The opening keeps one clause ("the repo of whichever pane has focus") and links to `/right-panel`.

## Cut

| Fact | Tag |
| --- | --- |
| "a Pierre file tree with git-status tinting over a syntax-highlighted source view"; the tool's name in the opening | implementation (the tree and highlighting are kept in plain words) |
| "It is how you read what an agent is working on without leaving the terminal beside it" (second telling in the opening) | duplicate |
| Focus a split in another repo and the tree follows; focus back and the main terminal's own tree and selected file return | duplicate (`right-panel` "What the panel remembers") |
| "so the tree is your project, not your `node_modules`" | rationale |
| Walking down into `node_modules/solid-js/` a click at a time; "each directory you open costs one directory read; the ones you never open cost nothing" | visible on screen / implementation |
| "An ignored file listed in its own right opens and renders like any other" | duplicate (every file opens that way) |
| "recursively watching `node_modules` is what exhausts a machine's file-watch budget"; "kolu deliberately doesn't watch inside ignored directories" as a choice | rationale |
| "a payload-free repo-change pulse re-running `git status`, with no polling" | implementation |
| The eye toggle does not appear in the diff views "since the diff views list changed files where an ignored path can't turn up" | rationale |
| A new match opens its folder again, while editing the filter to one that matches the same files does not | implementation (the rule it serves is kept) |
| The Source/Rendered toggle "keeps both views alive (flipping is instant …)" | implementation |
| Comments "a way to review a change and hand the agent your notes in its own words" | rationale |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`.

| Span | Where it went |
| --- | --- |
| `node_modules` | cut, rationale (the watch-budget argument). The collapsed-row example keeps `node_modules/`. |
| `node_modules/solid-js/` | cut, visible on screen |
| `git status` | cut, implementation (the repo-change pulse). The behaviour, live repaint on disk change, is kept. |
