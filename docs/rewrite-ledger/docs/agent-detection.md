# agent-detection

- Kind: reference. Reader: someone running a coding agent in a kolu terminal who wants to know what kolu can see about it.
- Rewritten from: `f50641c6a`
- Words: 4,891 → 2,500
- Frontmatter: `description` 266 → 157 characters. No other key changed.
- Facts moved *to* this page by other rewriters, all present: `conductor` → "Before the first prompt" (ready from the process alone); `troubleshooting` → per-agent awaiting-you signals (Grok's `ask_user_question`, Oh My Pi's `Allow tool:` and `ask` dialogs, pi's gates living in its TUI, Xyne's transcript carrying no live phase).

## Headings

| Old | New |
| --- | --- |
| One state vocabulary | One state vocabulary |
| Before the first prompt | Before the first prompt (frozen; inbound links kept) |
| How detection works | How detection works |
| — | When several agents share a directory (new; replaces the per-agent repetition of the shared-directory limit) |
| What a resume may carry | What a resume may carry (frozen; linked from `sessions`) |
| Claude Code · Codex · Grok · OpenCode · Pi · Oh My Pi · Xyne | unchanged (`#codex`, `#opencode`, `#oh-my-pi` kept for the changelog) |
| Pi's session-store locations | Pi's session-store locations |
| — | What an Oh My Pi tile shows (new `###`, splits the Oh My Pi section under the 300-word heading limit) |
| Oh My Pi's agent-directory locations | Oh My Pi's agent-directory locations |
| Adding an agent | Which agents appear in the palette |

No heading with an inbound link was renamed, so no inbound link needed updating. `Adding an agent` had no inbound link (checked `.waterfall/anchors.md` and `grep -rn "agent-detection#"`).

## Moved

- What each state means to the user, and where it is shown → `notifications` (linked from "One state vocabulary"); this page keeps how each state is detected.

## Cut

| Fact | Tag |
| --- | --- |
| The awaiting-you hue sits outside the warm/pending family; a finished background agent washes its whole row amber with an unread badge on the pip | visible on screen (`notifications` owns what a state means) |
| The shape carries the meaning, so a state survives a peripheral glance or reduced colour sensitivity | visible on screen |
| Detection calls `tcgetpgrp` (POSIX, Linux and macOS alike) | implementation |
| File-change watches are backed by a low-rate stat reconciliation that self-heals within about a second | implementation |
| Arguments are read from `/proc` on Linux and through the baked `osfacts` helper on macOS | implementation |
| A shell's printed mark is a hint and can name a shim, never a command | duplicate (the allowlist paragraph states the rule) |
| The `OSC 633;E` mark named as the escape sequence, and `cat`/curl/ssh banner as examples of text that can print it | implementation (the behaviour is kept, the sequence's name is not) |
| Unknown flags, wrappers, paths, positional prompt text and resume markers are dropped | duplicate (allowlist: only declared launch-shape flags come back) |
| `AI_PROFILE=… opencode` as a second example of a typed environment prefix | duplicate |
| A terminal saved by an older kolu comes back without its old flags once | history |
| A terminal woken from sleep with an agent that never wrote a session comes back to a bare shell | duplicate (the resume paragraph says a terminal kolu cannot build a resume for wakes to a bare shell) |
| Claude's model and context are read from the newest `assistant` message rather than any entry, because a `user` entry is newest during a turn and after every tool call, which blanked both | implementation (the fact that they come from the newest assistant message is kept) |
| Claude writes `~/.claude/sessions/<pid>.json` the moment it starts, already carrying the session id its transcript will take | implementation (the ready-before-transcript behaviour is kept) |
| Live SQLite updates "ride a watch on the write-ahead log" stated per agent | duplicate (said once under "How detection works") |
| Codex's count is not a sum that would double-count cache re-reads | rationale |
| Why kolu reads OpenCode's SQLite instead of an HTTP API (no port discovery, no extra process, WAL lets kolu open it read-only) | rationale |
| OpenCode 1.x `session` / `message` tables are not read, named as such | duplicate (the page says a database without `session_v2` lights nothing) |
| Grok's transcript export unwraps the `<user_query>` harness | implementation |
| Grok's task progress "stays null until Grok's plan checklist is a stable first-class count" | rationale (the limit itself is kept) |
| Grok's `ask_user_question` promotion explained twice (so a prompt never reads as "running tools") | duplicate |
| pi's buckets are disjoint, so the sum is never a double count | rationale |
| pi accepts both the id and the path; the path is spliced because an id alone cannot be found after a redirect | implementation (the absolute path and the reason it survives a redirect are kept) |
| A pi launched by a harness that sets `PI_CODING_AGENT_DIR` per run for config isolation; session updates in any store wake the tile as the default tree does | implementation (the page says detection follows the redirect) |
| `KOLU_PI_DIR` / `KOLU_OMP_DIR` described as "the escape hatch for tests and unusual setups, never a replacement for per-terminal resolution" | rationale |
| macOS has redacted same-user process environments since 10.13 | implementation (the blind spot is kept) |
| The omp breadcrumb is written `fresh` before the JSONL exists, and `<tty>` named as the key | implementation (the pre-session behaviour is kept) |
| omp detection has "no candidate list, no ownership arbiter … by construction" | rationale |
| A recognition loose enough to take any corner risks reading prose as a prompt | rationale |
| An omp breadcrumb left by an earlier run in the same terminal is ignored rather than re-binding | implementation |
| A `/tree` jump back shows the todo list that point in the conversation had; a cleared list shows no progress | implementation (counting rules and the resumed/compacted case are kept) |
| omp's progress count agrees with the tile, the inspector card and omp's own line | visible on screen |
| Xyne's transcript has "no event stream, no pid map, no in-progress marker"; waiting is "the floor every turn returns to" | implementation / rationale (always-waiting and its consequence are kept) |
| Xyne's directory naming repeated as "original working directory" | duplicate |
| How an agent is added to kolu: `AgentVocab` / `AgentPlugin`, `<agent>Vocab` / `<agent>Plugin`, `packages/integrations/<agent>/`, the `kolu-agents` registry, `AgentInfo`, derived tables, the `governance` test, `anyagent`, `nix/workspace.nix` and the lockfile | implementation (the reader-facing half, which agents appear in the palette, is kept) |
| The 24×24 brand mark serving tile chrome and dock pip | visible on screen |

## Dropped code spans

From `.waterfall/compare.mjs` against `f50641c6a` (29). Each is accounted for above.

| Span | Where it went |
| --- | --- |
| `tcgetpgrp`, `osfacts`, `OSC 633;E`, `cat`, `AI_PROFILE=… opencode` | cut, implementation or duplicate |
| `~/.claude/sessions/<pid>.json`, `user`, `tool-calls` | cut, implementation (the page keeps `~/.claude/sessions/<foreground-pid>.json` and `finish: "stop"`) |
| `session`, `message`, `~/.pi`, `settings.json` | cut, duplicate (the page keeps `session_v2`, `session_message` and `<agent dir>/settings.json`) |
| `<tty>`, `fresh`, `/tree`, `<user_query>` | cut, implementation |
| `input + cacheRead + cacheWrite` (both wrappings) | reworded as the three names in prose; the sum is kept |
| `--no-session` | kept as `pi --no-session` and `omp --no-session` |
| `AgentVocab`, `AgentPlugin`, `<agent>Vocab`, `<agent>Plugin`, `AgentInfo`, `kolu-agents`, `governance`, `anyagent`, `packages/integrations/<agent>/`, `nix/workspace.nix` | cut with "Adding an agent", implementation |
