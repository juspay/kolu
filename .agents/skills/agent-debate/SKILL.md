---
name: agent-debate
description: 'Run an automated debate with a live Claude, Codex, or Grok peer until consensus — no round cap, no deadlock exit. Two explicit subcommands: `review` has the selected peer critique the current diff while the invoking agent fixes or disputes findings, committing the trail and optionally posting it to the PR; `answer` has both agents independently answer a prompt, cross-check, and return one confirmed answer. The peer runs in a split terminal driven through /kolu. Use when the user types `/agent-debate`, asks Claude/Codex/Grok to review a change, asks two agents to argue until they agree, or wants a consensus answer from two agents.'
---

# Agent debate

Debate a selected **Claude, Codex, or Grok peer** until consensus, with **no
round cap and no deadlock exit**. Require both an explicit mode and an explicit
peer: never infer a mutating review from prose, and never silently prefer one
agent over the others.

- **`review`** — the selected peer reviews the current diff; **you** (the author)
  fix or dispute each finding until both sides agree. Commit each author round
  and optionally post the compact trail to the PR.
- **`answer`** — you and the selected peer independently answer a prompt,
  cross-check, and return one confirmed answer. This mode is read-only and
  saves a transcript.

## The engine — a live peer in a split terminal beside you

Drive the debate from your own turn: spawn the selected peer as a **live split
terminal beside you** and take turns until consensus. There is no `Workflow`
tool and no subagent — you are one debater, the split session is the other.
**All terminal mechanics belong to the [/kolu skill](../../../apm_modules/_local/agents/.apm/skills/kolu/SKILL.md)**:
split provisioning, send→settle→submit, done-signals, large-paste files, re-key
recovery, and teardown. Read it first; this skill adds only the debate protocol.

Require a kolu terminal so you can spawn a sibling split. If the current session
is not in kolu, say the skill cannot run and stop.

### Select and launch the peer

Parse the required `--agent <claude|codex|grok>` into `PEER` before doing any
work. Reject a missing or unknown value rather than defaulting.

**Never pass a reasoning-effort flag.** Each peer runs at its own CLI default —
the level its vendor ships as right for the model. Pinning one here meant
tracking three different flag spellings and every vendor's supported levels, and
guessing at a tier from outside the tool that knows best.

Use the selected peer's exact preflight and interactive launch:

| `PEER` | Preflight | Split command |
| --- | --- | --- |
| `claude` | `claude auth status` | `claude --dangerously-skip-permissions` |
| `codex` | `codex login status` | `codex --yolo --cd "$REPO"` |
| `grok` | `grok models` | `grok --always-approve --cwd "$REPO"` |

Run Claude from a split whose cwd is already `$REPO`; its CLI has no cwd flag.
If preflight reports an authentication failure, name the matching login command
(`claude auth login`, `codex login`, or `grok login`) and stop. For any other
failure — including network/model discovery failure from `grok models` — surface
the exact error and stop. Do not mislabel it as auth trouble or try another agent.

Provision the peer as a **split tile parented to your own terminal**, never as a
detached terminal. Use /kolu's split-with-parent create
(`lifecycle_create` with `placement: {kind: "child-of", parentId}` first;
`kolu create --parent <id>` only as its documented fallback — both faces
REQUIRE a stated placement, so there is no spelling that leaves the peer
detached by accident). The unrestricted flag is **required**: the peer must
write its verdict file and ping the author's unix socket, so a sandboxed session
cannot run this protocol.

**Boot-check the chosen TUI.** `create` returning does not mean the peer is
ready. Snapshot the split and confirm the selected TUI is at its input prompt in
unrestricted mode (`YOLO mode` for Codex; bypass-permissions/always-approve for
Claude/Grok). A launch may update and fall back to a shell; never dispatch until
the expected TUI is visible.

**Keep both terminal references restart-safe and unambiguous.** Create a
per-run label such as `agent-debate:<timestamp>-<pid>`. On the MCP path, read
your author record from the `terminals` resource. Record its current id and a
unique restart-safe recovery key: prefer a non-empty unique `intent`; otherwise
use the exact `(agent.sessionId, cwd)` pair when both fields exist and identify
one terminal. Stop only when no available key identifies exactly one terminal.
Create the peer with unique intent `<run-label>:<peer>` and record its id plus
that intent. If `send` or `snapshot` reports "no terminal matching", list the
resource and re-resolve the author by its recorded recovery key or the peer by
exact intent, requiring one match. On the CLI fallback, apply the same one-match
rule to stable titles; if either side lacks a unique title, stop rather than
guess. Put the author id plus its recovery key in every peer ask.

Keep one warm peer session for the whole debate. Round 1 receives the full ask;
later rounds receive lean follow-ups and rely on the session's context.

**Make the reverse ping executable.** Put this exact protocol in every ask: after
writing and validating its output file, the peer calls kolu
`lifecycle_sendInput` on the author terminal with
`{ id, text: "AGENT-DEBATE <run-label> VERDICT-WRITTEN <round>", submit: true }`
— ONE call, which waits for that terminal's prompt to be idle, types, waits for
the TUI to take it, and presses Enter. If the author id is stale, list terminals,
require exactly one match for the recorded author recovery key, and use its new
id. If the call REFUSES (the author was mid-turn), read `staged`: `false` means
nothing landed, so wait for the author and ping again; `true` means the text is
in its input box, so send `{ id, key: "Enter" }` and never re-send the text. The
per-run payload cannot be confused for an ordinary prompt.

**Exchange files, not rendered screen text.** Write each round's instructions to
`$REPO/.agent-debate/ask-NNN.md` and send only a short pointer to that file.
Never paste the diff or a rebuttal. Require the peer to write its structured
result to disk, print `VERDICT-WRITTEN`, then ping the author terminal. Read the
file byte-for-byte. If it is missing or malformed, ask the peer to rewrite it;
never infer a verdict from the TUI.

**Tear down only the split you spawned.** Re-resolve its recorded title after a
kaval re-key if needed. Never use a pattern kill (`pkill -f`, `pgrep`,
`ps | grep | kill`, or any marker/substring match). Report unrelated agent
processes by pid and args; never hunt them.

## The core loop — symmetric pings to consensus

End each side's turn by pinging the other terminal:

```text
author → send peer the round ask (file + pointer)      → END TURN
peer   → inspect, write verdict, ping author           → end turn
author → read, fix/dispute, write section, commit      → ping peer → END TURN
 … until the peer verdict is approved
```

Treat the incoming ping as the primary done-signal. The verdict is durable
because the peer writes it before pinging. A lost ping can still stall an ended
turn, so whenever you wake without a fresh ping, perform one bounded
`wait --until match:'VERDICT-WRITTEN'`/snapshot per /kolu and read the file. If
the environment cannot re-invoke you, keep that bounded wait alive instead of
ending the turn. The debate ends only on consensus.

Run autonomously like `/be-review`: make the author-side fix/dispute decisions
without asking the human between rounds. If an orchestrator is driving you,
escalate a genuinely human decision through its reporting channel; otherwise
decide and continue.

## Parse the mode

Inspect the first whitespace-delimited token of `$ARGUMENTS`:

- `review` → read [`REVIEW.md`](REVIEW.md) and follow it.
- `answer` → read [`ANSWER.md`](ANSWER.md) and follow it.
- Anything else, including no arguments → ask for the explicit mode and
  `--agent <claude|codex|grok>`, then stop.

For either mode, reject a missing `--agent`. Never add a bare review alias:
`/agent-debate` deliberately does not encode or default its peer.


Read only the mode you're running — they share this engine and nothing else.

## Files

Keep all ephemeral state in the gitignored per-worktree `.agent-debate/` and
clear it at the start of every run:

- review mode: `ask-NNN.md`, `verdict-NNN.json`, `section-NNN-author.md`
- answer mode: `answer-author-N.md`, `answer-peer-N.md`, `answer-verdict-N.json`,
  `candidate-author-N.json`, `candidate.md`, `answer-<slug>.md`
- both: `comment.md`

None of the scratch feeds a PR comment except the compact generated
`comment.md`. There are no workflow or headless-agent scripts; the engine is
this protocol plus [/kolu](../../../apm_modules/_local/agents/.apm/skills/kolu/SKILL.md).

This skill is generated from `agents/.apm/skills/agent-debate/`; edit the source
there and keep generated `.claude/` and `.agents/` copies identical in the same
commit (see `.claude/rules/apm-workflow.md`).
