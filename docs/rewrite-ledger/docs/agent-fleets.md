# agent-fleets

- Kind: explanation. Reader: someone deciding whether to let one agent drive many agents, and wanting the shape of that pattern.
- Rewritten from: `f50641c6a`
- Words: 1,738 → 1,150
- Frontmatter: description 331 → 145 characters. Other keys unchanged.
- Added import: `Steps` (the drive loop is now four steps before the shell block).

## Headings

| Old | New |
| --- | --- |
| Three layers: you, a coordinator, a fleet | The three roles |
| (inside that section, the span-of-attention argument) | Why add a coordinator |
| The loop: create, prompt, wait, read | The drive loop |
| Knowing when an agent is done — and whether it's asking you | Knowing when an agent is done |
| `waiting` is not always "done" — which is why `kolu debrief` exists | Why `kolu debrief` waits for quiet as well |
| Questions flow up to the coordinator, never out to you | Questions go up, never out |
| A fleet can span machines | A fleet can span machines |
| The seams, and when not to bother | What to watch for |
| Related | Related |

No page links into this page's anchors (`.waterfall/anchors.md` lists no `agent-fleets` section), so no inbound link needed updating.

Outbound links changed to page level so another rewriter's heading rename cannot break them:

- `/kaval#why-kaval-tui-send-not-a-message-bus` → `/kaval`.
- The agent-state list linked `/padi`; it now links `/agent-detection`, the page that owns how a state is detected.

## Moved

Nothing was moved to another page. Facts whose home is elsewhere were cut to a link:

- The Conductor's shape (one conversation for the fleet, reaching every machine, its needs-you panel) → two sentences and a link to [`conductor`](/conductor), which owns it.
- Why a send carries text or a key but never both → link to `kaval`, which owns it.

## Cut

| Fact | Tag |
| --- | --- |
| The italic preface ("this page explains a pattern, not a feature… the daemons underneath are on the kaval and padi pages") | duplicate (the cards and Related links say it) |
| "This isn't hypothetical" framing around the remote-terminals link | rationale |
| The `kolu` verbs "subsume the older `kaval-tui` / `padi-tui` verbs, which still work for now" | history |
| "You don't watch ten agents; you can't"; "You trade keystrokes for review" | rationale |
| The coordinator paragraph repeating that the Conductor has the same tools and a question panel | duplicate (`conductor`) |
| "the single door that work passes through" repeated in the card and again under questions | duplicate |
| The one-door shape being "the same shape kolu uses to put an agent under a chat app" (`/architecture`) | rationale |
| The [seam](/blog/remote-terminals) wording and "autonomous instead of stalling" rhetoric | rationale |
| "Because padi binds a per-host daemon over ssh"; "the fleet is a mix of hosts" | implementation / duplicate (`remote-hosts`) |
| The incident behind `debrief` (a worker three minutes into a "wait, then push once" plan, nudged off it) | history |
| "Doing it in one command is not only shorter"; "`--snapshot` without `--settled` still gives a screen, just without that promise" | implementation |
| "That's a feature, not a bug"; "the honest trade-off"; "which is exactly the moment you'd otherwise start dropping threads" | rationale |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 4 missing.

| Span | Where it went |
| --- | --- |
| `kaval-tui`, `padi-tui` | cut, history (the preview note no longer names the older verbs) |
| `--settled`, `--snapshot` | kept, but only as `--settled <ms>` and `--snapshot <N>`, so the bare spans do not match |
