# conductor

- Kind: how-to. Reader: someone who wants the Conductor to run work across their terminals.
- Rewritten from: `f50641c6a`
- Words: 7,955 → 1,871
- Frontmatter: description 251 → 135 characters. `order` 52 → 52.5, so it no longer ties with `sessions` and the sidebar order stays as it was.
- Second source: `packages/client/src/conductor/helpContent.ts`. The page agrees with it (the example request is the help's own).

## Headings

| Old | New |
| --- | --- |
| What it is | What it is |
| It never waits | What wakes it |
| What it is watching | What it is watching |
| The status line | The status line |
| Talking while it works | Talk to it while it works |
| The first tab in the chrome bar | Open it |
| The conversation (+ The header, Session settings, The ⋯ menu, The strip, The transcript, The composer) | Type a message · Read the conversation · When it asks you |
| Attachments | Attach a file |
| Signing in | Sign in |
| What it knows how to do | Run a waterfall |
| When it comes back | After a restart |

No inbound links pointed at the old anchors from other pages. Same-page links were updated.

## Moved

- How kolu knows an agent is `ready` from its process alone, before it writes to disk → `agent-detection` "Before the first prompt" (linked from the wake table).
- The watched list as tools and a resource (`watch_terminal`, `unwatch_terminal`, `watched`, the baseline a watch answers with) → `mcp` "The Conductor's watched list" (already there; linked).
- `agent_say` reporting whether the words took, and refusing an agent still starting → `mcp`, the `agent_say` row (already there).
- The waits the Conductor is not given (`wait_agentState`, `watch_*`) and `wait_outputSettled` being capped → `mcp` "Two faces, one tool table" (already there).
- What a needs-you question does across the app → `notifications` (linked).

## Cut

| Fact | Tag |
| --- | --- |
| The coordinator used to be a terminal; the first waterfall that blocked on a wait | history |
| `exited` exists because of a hole that used to swallow waterfalls | history |
| The header's state chip is gone; the hint row under the composer is gone; the tool-server strip used to sit above every conversation | history |
| Steering's queue limit was "brought over from olai rather than rediscovered" | history |
| `agent_say` exists because an Enter was silently dropped | history |
| The model surviving a restart "is a fix rather than a given" (agent re-asserts its default) | implementation |
| One conversation per machine vs one for the fleet: the trade-off argument | rationale |
| Why the context meter is a fraction, not a percentage | rationale |
| Why there is no API-key box ("a feature with its own argument to make") | rationale |
| Why the Conductor is a tab and not modelled as a host; the tab's rounded top, hover, lit belly, `◆` and `alpha` marks, no `+` or hue | visible on screen |
| Reading column width (about 45rem, 70–90 characters a line), your messages at the column's right edge | visible on screen |
| Canvas controls (`▦ canvas · ▢ maximized`, dock and inspector toggles) hidden in the Conductor; recorder, settings and palette stay | visible on screen |
| Phone layout: pull handle reads **◆ Conductor**, one-line composer, tool cards drop the raw tool name | visible on screen |
| The help column's contents, rail when collapsed, width kept | visible on screen |
| Watched panel tree drawing (splits under `└`, `child-of` edges), row naming ladder, heading left off when it repeats the row | visible on screen |
| Per-tool card contents (`lifecycle_create`, `lifecycle_sendInput`, `agent_say`, `wait_outputSettled`, `screen_text`), the stripped `surface-mcp:` prefix | visible on screen |
| Answered questions stay readable (`Mode — trivial`, `Implementor — omp · anthropic/claude-opus-5-5`); the adapter's `Please answer the following questions.` is not printed | visible on screen |
| Repeated failures draw as one line (`screen_text failed 6 times: …`); lists over five items fold to three | visible on screen |
| Plan card, file diffs, markdown replies, the strip of background tasks (`run_in_background`) and subagents | visible on screen |
| A wake line's contents (`host/id`, name, host, state); several terminals per wake | visible on screen |
| A hidden conversation reads no screens and counts no clocks; open `⋯` closes when you leave | implementation |
| The conversation is opened against one tool endpoint for its life; `hosts` roster mechanics | implementation |
| padi exposes no exit status | implementation |
| Attachment bytes go up in pieces and never ride the message; files kept in kolu-server's state directory; why (one oversized message would drop the tab's connection; base64 in a transcript) | implementation |
| Durations are measured by kolu's own watch; they restart after a kolu-server restart; unread terminals show none | implementation |
| A piece of work is derived from the watch list, not declared by the agent; an away host keeps its last grouping | implementation |
| Look fetches only while open, visible, tab in front | implementation |
| `kolu` endpoint proved answering before a conversation opens | implementation |
| A session nobody typed into is replaced after a restart without a rule | implementation |
| A wake that cannot be delivered: one notice per failure episode; the three retry triggers | implementation |
| The standing instruction's full wording (host, `host/id`, never wait, brief through files, sleeping terminals) | duplicate (each fact is on this page or on `mcp`) |
| Plan kept out of git through `.git/info/exclude`; planner reviews by the repo's guidelines; mid-round requests wait | implementation |
| A red CI check is retried once; red twice is a real failure | implementation |
| The instruction is versioned with the binary | implementation |
| A host that was away rejoins when it reconnects | duplicate (`remote-hosts`) |
| `ready` covers the time behind a `nix develop` | duplicate (stated as "seconds or minutes") |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a`. Each is accounted for above.

| Span | Where it went |
| --- | --- |
| `hosts`, `watched`, `terminals`, `watch_terminal`, `unwatch_terminal`, `lifecycle_kill` | moved to `mcp` |
| `lifecycle_create`, `lifecycle_sendInput`, `agent_say`, `wait_outputSettled`, `screen_text`, `surface-mcp:` | cut, visible on screen (tool cards); the tools are on `mcp` |
| `nix develop` | cut, duplicate |
| `└`, `child-of`, `+`, `alpha`, `▦ canvas · ▢ maximized`, `run_in_background` | cut, visible on screen |
| `Mode — trivial`, `Implementor — omp · anthropic/claude-opus-5-5`, `Please answer the following questions.`, `screen_text failed 6 times: …` | cut, visible on screen |
| `.git/info/exclude` | cut, implementation |
