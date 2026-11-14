# terminal-ui

- Kind: reference. Reader: someone driving kolu's terminals from a shell script or an agent.
- Rewritten from: `f50641c6a`
- Words: 1,915 → 1,359 (plan target 1,400)
- Frontmatter: `description` 112 → 110 characters (em-dash replaced with a colon). No other key changed.
- Second source: `packages/kolu-cli/src/verbs/watch.ts` (the two feeds, the mute's fail-open rule, the refusal of a scope that can never match, `--heartbeat` being CLI-only). It agrees with the old page.

## Headings

The page was one `##` with three `###` under it. It is now seven `##` headings, in the order a driver reads them.

| Old | New |
| --- | --- |
| The `kolu` command | The verbs |
| (inside that section) | A driving loop |
| (inside that section) | stdout, ids and exit codes |
| (inside that section) | Which machine a verb talks to |
| `kolu surface` — the same API as shell verbs | `kolu surface` as command-line verbs |
| `kolu watch` as a doorbell that keeps ringing | `kolu watch` as a standing alert |
| `create` makes you say where the terminal goes | Where a new terminal goes |

No link anywhere in the repo points at a `terminal-ui` anchor (`grep -rn "terminal-ui#"` finds none, and `.waterfall/anchors.md` has no `terminal-ui` section), so no link needed updating. Outbound links were checked: `/mcp`, `/dock`, `/remote-hosts`, `/kaval`, `/padi`, `/agent-fleets`, `/surface/expose-to-cli` are pages; `/surface/ref-surface-cli#exit-codes` is a frozen heading that exists today.

## Moved

- What a watch line's `snapshot` / `transition` / `nag` kind means, and that a snapshot is what makes starting late safe → `mcp`, the watch-subscription section ("Report a terminal until you deal with it"), where it already was. This page keeps the flags, the example, the rendered feed, and a link to `/mcp`.
- `nag.left` being `0` on the last reminder → `mcp`, same section (already there). This page keeps the CLI's own `"nag":{"index":1,"left":2}` payload and that `left` is absent when uncapped.

## Cut

| Fact | Tag |
| --- | --- |
| `kolu debrief`'s last step "used to be two more commands" | history |
| `kaval-tui` and `padi-tui` "were the two tools these verbs replace" | history |
| The daemon re-points the PATH entry at the current build every time it starts | implementation |
| "This is how one agent drives a fleet of others" | duplicate (`agent-fleets`) |
| Why the watcher is never scoped by a list of ids (a watcher narrowed to the terminals you remembered goes blind) | rationale |
| Why `create` refuses a default placement (a script that never mentions placement "just never thought about it", a fleet that should have been splits) | rationale |
| Why `--json` is filtered in kolu: a script consumes it with `jq` and nothing re-implements the timing | rationale |
| Over MCP, `watch_next` answers "is anything there?" with its own `timeoutMs`, so a clock tick would mix liveness into terminal events | duplicate (`mcp` documents `watch_next`) |
| The alarm framing of `kolu watch`: "every alert kolu has taps you once, miss that tap and the terminal is silent forever", and the hours nobody notices | rationale |
| The surface matrix's `2` "moves the other way"; "one carve-out a driver learns once"; a key no verb owns as a second example of rejected input | duplicate (the row and the sentence already say the input did not match) |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`: 8 missing.

| Span | Where it went |
| --- | --- |
| `-o` | still here, spelled `-o <path>` in the `kolu screenshot` row |
| `--ignore` | still here, spelled `--ignore <id>` (the flag's own form) |
| `1/2/3` | still here as `1`/`2`/`3` in the sentence introducing the surface exit codes |
| `create` | the bare span was the old `### create …` heading; the verb is `kolu create` throughout |
| `jq` | cut, rationale |
| `watch_next`, `timeoutMs` | cut, duplicate (`mcp`) |
| `left: 0` | moved to `mcp`; `left` itself is still on this page |
