# sessions

- Kind: how-to. Reader: someone who wants to know what comes back after a reload, restart or crash, and how to park a terminal.
- Rewritten from: `f50641c6a`
- Words: 1,103 → 859 (`.waterfall/words.mjs`; target 750).
- Frontmatter: description 243 → 155 characters. `order` stays 52, `section` and `koluHero` unchanged.

## Headings

| Old | New |
| --- | --- |
| What survives | What survives (a table) · The restore card · Recover a session from a backup |
| Sleep a terminal | Sleep a terminal |
| Wake — on the exact conversation | Wake on the exact conversation · What wake cannot bring back |
| Next | Next |

No page, changelog entry or README links into this page's headings (`.waterfall/anchors.md` lists no `sessions` section), so no link needed updating. Outbound links checked: `/padi`, `/kaval`, `/changelog`, `/dock`, `/agents`, `/agent-detection#what-a-resume-may-carry` (the heading exists today, in a page another rewriter holds) and `/troubleshooting#kolu-lost-my-session-or-my-settings-look-wrong`.

## Moved

Nothing. No other ledger records a fact moved to this page; `switcher` links here rather than moving anything.

## Cut

| Fact | Tag |
| --- | --- |
| "That durability is why you can park work freely: nothing you set up is expensive to lose, because it isn't lost" | rationale (kept as one clause) |
| The restore card's repo groups use the same monogram and colour spine as the live dock | visible on screen |
| A split's frozen pane "shows a compact frozen body"; the tile "stays a full canvas citizen" | visible on screen |
| A command mark is only a sensor: anyone whose text you display (a `cat`, a curl response, an ssh banner) can print the escape sequence, so kolu never types one | implementation |
| The wake line is "never replayed from something a shell printed", and "that is also why the line cannot be forged" | rationale |
| A resume marker among the dropped arguments; the flags of a pre-existing saved target returning on the next live sample | implementation |
| Each dormant member's parent edge named twice (sleep and wake); "each split back under the tile it belonged to" | duplicate |
| A snapshot is taken before **Start fresh** clears anything, stated twice (Start fresh bullet and the backup ring) | duplicate (kept in "Recover a session from a backup") |
| One dormant record per member | implementation |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 1 missing.

| Span | Where it went |
| --- | --- |
| `cat` | cut with the command-mark sensor passage (implementation) |

Every other command form is verbatim: `claude --resume <id>`, `codex resume <id>`, `opencode --session <id>`, `xyne --session <id>`, `FOO=1 claude`, `--model`, `--dangerously-skip-permissions`, `--no-alt-screen`.
