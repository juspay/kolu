# padi

- Kind: explanation + reference. Reader: someone who wants to know what the daemon behind kolu remembers, and someone driving it with `padi-tui`.
- Rewritten from: `f50641c6a`
- Words: 1,467 → 1,096 (`.waterfall/words.mjs`; the plan's own counter read 1,531 → target 1,000).
- Frontmatter: description 183 → 158 characters. No other key changed. The `koluHero` block and the inline SVG are unchanged.

## Headings

| Old | New |
| --- | --- |
| Where it sits | Where it sits |
| Steady-state supervision | When kaval stops answering |
| What padi knows | What padi knows |
| The thin shell face — `padi-tui` | Read the workspace from the shell (plus new `###` entries: Which daemon it talks to · Wait for an agent turn) |
| Why it is not inside kolu-server | Why it is not inside kolu-server |

`#steady-state-supervision` is linked from `website/src/content/docs/remote-hosts.mdx` (line 105 at the time of writing), which belongs to another rewriter in this wave, so it is **not** updated here: `remote-hosts.mdx — /padi#steady-state-supervision → /padi#when-kaval-stops-answering`. No other file in the repo links the old anchor.

## Moved

Nothing was moved off this page. `kaval` now points here for the workspace layer, padi's socket discovery and the agent-state waits, and all three are here.

## Cut

| Fact | Tag |
| --- | --- |
| The gloss of _paḍi_ ("the stepped stand a koḷu sits on") | duplicate (the naming note was on `kaval` too) |
| padi being a `@kolu/surface` daemon with drain-capable live recycle that keeps a client connected across an upgrade | implementation (the Surface pages own it) |
| "The split is simple: kaval keeps shells alive; padi keeps the workspace legible" | rationale |
| The supervision narrative restated: "is continuous, not a boot-time step", "one slow moment changes nothing", "a hot restart loop is not a repair", "the kaval-down card is for the genuinely unrepairable now" | rationale |
| The re-connect case argued at length: "from the outside that looks exactly like a stuck kaval, and it is the opposite", "nothing is broken, and there is only a connection to re-make", "it only ever re-makes a line to a daemon it has just checked is still answering" | rationale (the behaviour and its timings are kept in the table) |
| "A daemon that is genuinely gone is a different fact… re-making a line to a daemon that is not there would mean starting a new one, which is a restart", and the restatement of the three-strike limit | rationale (the three-strike limit is kept in the table) |
| kaval's self-check described as covering "the case padi cannot" and turning "stuck forever, which nothing handles, into stopped, which the supervisor already handles" | rationale (the self-check and its exit are kept) |
| "an agent driving its siblings never guesses a path" kept; "a tui is a dial" kept as "a tui only dials" | — |
| The deeper design notes sentence pointing at the padi atlas note | duplicate (the same link is in the card grid at the foot of the page) |
| Canvas flattening of descendants into the root tile's tab strip and the Dock keeping the true tree, inside the `create` cell | duplicate (`tiles`, `dock`) |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 0 missing. Every command, flag, environment variable, exit code and JSON field of the old page is still on it, and the `padi-tui status` output block is unchanged.
