# mcp

- Kind: reference. Reader: someone wiring a coding agent to kolu, and looking up what the agent can call.
- Rewritten from: `f50641c6a`
- Words: 4,313 → 2,500
- Frontmatter: description 258 → 148 characters. No other key changed.
- Second source: `packages/kolu-mcp/src/say.ts` for `agent_say`'s refusals.

## Headings

| Old | New |
| --- | --- |
| Two faces, one tool table | What the Conductor's face changes |
| Connect it to your agent | Connect it to your agent |
| Inside a kolu terminal | Inside a kolu terminal (frozen: same-page link) |
| Drive a terminal | Drive a terminal |
| What your agent can do | What your agent can do |
| Supervise several terminals at once | Watch many terminals at once |
| Terminals that keep asking until you deal with them | Report a terminal until you deal with it |
| The Conductor's watched list | The Conductor's watched list (kept: `conductor.mdx` links to it) |
| Watch the whole workspace (live views) | Live views |
| It survives kolu restarting underneath it | When kolu's background service restarts |
| What an agent can't touch | What an agent can't touch |
| Install the skill and server together | unchanged (changelog links to it) |

No inbound link pointed at a renamed anchor (`.waterfall/anchors.md` lists only
`#inside-a-kolu-terminal`, same-page, and `#install-the-skill-and-server-together`
from `changelog/unreleased.mdx`; both headings are unchanged). Nothing to update
elsewhere.

## Moved

Nothing moved off this page. Facts moved *to* it by the `conductor` rewrite all
survive: `watch_terminal` / `unwatch_terminal` and the `watched` resource with
its found-state baseline ("The Conductor's watched list"), `agent_say`'s
"did the words take" answer and its refusals ("Create and drive terminals"), and
the waits the Conductor is not given plus the capped `wait_outputSettled`
("What the Conductor's face changes").

## Cut

| Fact | Tag |
| --- | --- |
| An agent running several workers needed a wait per worker, re-armed by hand, with blind gaps between waits | history |
| "A terminal you opened before kolu was upgraded runs the new build's `kolu`" told as a change; the daemon owning and re-pointing the `PATH` entry so tool and daemon cannot disagree | implementation |
| "Your own `PATH` is untouched apart from these names taking precedence" | implementation |
| `kolu mcp` is "a small `kolu mcp` process", "no browser involved", "nothing new to install if you already run kolu" (kept in one clause; the browser aside dropped) | duplicate |
| Why the fleet face needs no stdio relay, no ssh child per host, one server entry for the conversation's life; the bearer token being minted fresh per kolu-server process | implementation |
| `hosts` standing in for `daemonStatus` · `status` · `identity` "because in a fleet they are columns of that roster"; "never answered with an empty list, which an agent would read as nothing is running there" (shortened to the refusal fact) | rationale |
| "Everything else is one definition serving both; so this page is the answer to what the Conductor can do" | rationale |
| The two faces restated a second time after the table ("That one exception is worth stating plainly…") | duplicate |
| Eight tools also carry a readable display name a host can show ("Send input to a terminal") | visible on screen |
| `screen_image`'s structured arm "and the picture is not repeated as base64 prose" | implementation |
| "Reach for `screen_image` when the answer is visual: a TUI's layout, a coloured diff, a pass or fail run; `screen_text` stays the cheaper everyday read" | visible on screen |
| The `<Aside>` "Text and Enter are separate steps" (the rule itself kept as step 3 of the loop) | duplicate |
| Both waits exist "because the gaps between those calls are where a driving agent gets misled"; `settledMs` "an *and*, not a second wait"; "an agent that goes back to work re-enters it" | rationale |
| The watch subscription "is the per-host face's too", restated before and after the table | duplicate |
| Why a parameterised subscription does not also report `gone` ("that is not an oversight — this feed is a level") | rationale |
| Reopening a name with different parameters starting the queue over, argued ("the events it held are answers to the question you just stopped asking") — kept as the plain fact | rationale |
| The nag budget "belongs to the QUESTION", including narrowing `states` out and back — kept as the plain fact | rationale |
| A sleeping terminal's refusal "rather than claiming the terminal does not exist or that it died"; "The waits refuse it up front instead of waiting out their window" | rationale |
| "These update live — an agent subscribed to `urgency` is notified the moment…" (kept, shortened) | — |
| The restart "deliberately keeps your terminals running, so nothing else notices"; "`kolu mcp` doesn't need restarting alongside it" | rationale |
| The `--host` drop announcement described as not carried "yet", "the retryable failure described below, just after an idle gap" | history |
| The allowlist being "deliberate, reviewed", "anything not on the list is simply unreachable", "so handing an agent your kolu lets it do the work without handing it the keys to the whole workspace" | rationale |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`.

| Span | Where it went |
| --- | --- |
| `PATH=…` | kept as `PATH=` (the span the old page also used in the Steps); the fact is unchanged |
| `send-text` | cut, duplicate: the rule is step 3 of the driving loop, in plain words (`lifecycle_sendInput` is the tool name) |
