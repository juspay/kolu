# troubleshooting

- Kind: how-to. Reader: someone whose kolu is not doing what they expect.
- Rewritten from: `f50641c6a`
- Words: 1,573 → 1,308 (target 1,200)
- Frontmatter: description 102 → 144 characters. No other key changed.

## Headings

No heading renamed. Four anchors are linked from other pages
(`#i-am-not-getting-desktop-notifications`, `#how-do-i-update-kolu`,
`#kolu-is-using-a-lot-of-memory`,
`#kolu-lost-my-session-or-my-settings-look-wrong`) and all keep their text. Each
answer now opens with the fix: the HTTPS/`localhost` requirement, the three
checks, the restore flow, the palette path, the three memory steps.

## Moved

- What each first-class agent's dock row can show (the live phases, Grok's `ask_user_question` prompts, Oh My Pi's approval and `ask` dialogs, pi's gates living in its TUI, Xyne's transcript carrying no live phase) → `agent-detection`, which owns how a state is detected, and `notifications`, which owns what a state means. The page keeps the seven agent names and links to `/agent-detection`.

## Cut

| Fact | Tag |
| --- | --- |
| "You are probably on plain `http://`" kept, but the explanation of why loopback is exempt is stated once under "Can I use it without Tailscale?" | duplicate |
| Which agents light up a tile with badge, session title and last-used model | visible on screen |
| "it is the same command from Quickstart" kept; "with nothing to run by hand" repetition dropped | duplicate |
| Backup ring "unchanged files skipped" | implementation |
| Diagnostics block: "it never reaches your machine, so it is absent from the server's log too" | implementation |
| Memory: "Two machines with a dozen busy terminals between them is a lot of state in one tab. That is expected, not a leak." reduced to one sentence | duplicate |
| Memory: "If you switched it while debugging something, switch it back to Auto" | duplicate (step says keep it on Auto) |

## Dropped code spans

| Span | Where it went |
| --- | --- |
| `ask_user_question`, `ask` | moved: the per-agent "awaiting you" signals belong to `agent-detection` |
