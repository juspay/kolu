# right-panel

- Kind: how-to. Reader: someone reading the panel beside a terminal, to see what an agent is doing and to act on it.
- Rewritten from: `f50641c6a`
- Words: 2,332 → 1,209
- Frontmatter: description 251 → 132 characters. `title`, `order`, `section`, `koluHero` unchanged. Removed the unused `Aside` import (the page uses none).

## Headings

| Old | New |
| --- | --- |
| What it shows, in order of urgency | What the Inspector shows |
| odu CI, when the checkout runs odu | odu CI |
| — | What a click opens (new `###` under odu CI) |
| Compose a prompt | Compose a prompt |
| Ports the terminal is serving | Ports the terminal is serving (kept: linked from `remote-hosts`) |
| Servers that detached, and the rest of the host | Servers that detached |
| A printed `localhost` URL is the same door | (section cut to two sentences + link, inside "Ports the terminal is serving") |
| The terminal CLI, documented in place | Reach a terminal from a shell |
| What it shows follows your focus | What the panel remembers |

Links updated: `website/src/content/changelog/unreleased.mdx:108`,
`/right-panel#odu-ci-when-the-checkout-runs-odu` → `/right-panel#odu-ci`.

`#ports-the-terminal-is-serving` is linked from `remote-hosts.mdx` (two places),
so that heading was kept verbatim. No other anchor of this page is linked.

## Moved

Nothing new moved out. The printed-`localhost` card, the two forwarding
mechanisms, the `⌘/Super+K` → **Forward a port…** path and the security note are
the fact home of `remote-hosts` "Port forwarding" (plan §4); this page keeps two
sentences and links to `/remote-hosts#port-forwarding`, as it already did.

## Cut

| Fact | Tag |
| --- | --- |
| The Inspector is "ordered by how much a fact wants your attention, not by how the data is grouped internally" | rationale |
| Violet / rust named as the state colours (now a link to `notifications`, the fact home for what a state means) | duplicate |
| "You read 'does this need me?' off the colour before reading a word" | rationale |
| The branch chip's hue matches the dock's branch labels; the repo chip's monogram and soft repo-colour frame | visible on screen |
| "Nine passing checks stay folded behind their rollup"; "you never open a list to find good news, and never miss bad news" | visible on screen / rationale |
| The odu heading "names odu and links to its site, so a reader who has not met the tool knows whose CI this is" | rationale (the link itself stays) |
| Lanes that overlap are drawn overlapping; the long bar nothing sits beside is what the run is waiting on; a running lane's hatched tail; an empty track is a lane still claiming a machine; the scale reads `0` to the run's elapsed | visible on screen |
| "a selection is not a pipeline"; "a green under it says less about the pipeline, so it describes what the run covered rather than being a detail of it" | rationale |
| A lane log is "searchable, coloured, followed live … rather than in a second log view built here" | rationale |
| The door is a raw TCP relay, so odu's websocket and same-origin check pass through unmodified; no odu setting has to be touched | implementation |
| kolu reads only odu's runs, so a new version of odu's cache, door or tunnel never trips the unavailable line | implementation |
| "a reading that breaks mid-flight"; "an installation to go and look at never hides behind the same blank an absent odu draws" | implementation / rationale |
| kolu dials the odu daemon itself and lets go of the connection when you close the panel or look away | implementation |
| The Compose box "dodging the same paste race the CLI is careful about" | rationale |
| Port detection "is not a guess at printed text"; listeners attributed to the terminal whose process subtree holds them | implementation |
| A port bound to all interfaces "already answers on the address you're viewing kolu at" | rationale |
| The `⇄ :<port>` pill is teal; "one list, one row per port" | visible on screen |
| The printed-URL card is live and upgrades on the next scan; `nothing is listening yet`; ⌘/Ctrl-click opens the raw URL; non-loopback links keep the usual behaviour; "printed text never creates a port fact of its own" | duplicate (`remote-hosts` "Port forwarding") |
| The detached claim "is read from what the browser has loaded of the terminal's output" | implementation (the reload behaviour it causes is kept) |
| "a door belongs to the machine rather than to any one terminal" as the reason an open-door row stays visible | rationale |
| The Attach section is folded "since reaching a terminal from a shell is something you do occasionally rather than watch" | rationale |
| "Every command that targets a terminal has the same shape, so the section is built that way" | rationale |
| `padi-tui` described as the "awareness sibling"; `--socket` "points those id-less commands at this server" | duplicate (`kaval`, `padi`) |
| Closing the panel or switching tabs keeps views mounted; the touch-device drawer keeps the Code view; hidden Code views pause their file queries | implementation (the pause is on `code-tab`, where the reader sees it) |
| "the split is what makes splits work"; "Collapse it on a build-log tile and it stays collapsed there" | rationale / example |
| The header line's repo root is emphasized and the path below it dimmed | visible on screen |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`.

| Span | Where it went |
| --- | --- |
| `http://localhost:5173/`, `127.*`, `[::1]`, `0.0.0.0` | cut, duplicate: the printed-`localhost` section is now two sentences and a link to `/remote-hosts#port-forwarding`, which owns the card and the loopback forms |
| `0` (the timeline scale's left end) | cut, visible on screen |
