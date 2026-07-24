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
**All terminal mechanics belong to the [/kolu skill](../kolu/SKILL.md)**:
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
(`lifecycle_create` with `parentId` first; `padi-tui create --parent` only as
its documented fallback). The unrestricted flag is **required**: the peer must
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
`lifecycle_sendInput` on the author terminal with text
`AGENT-DEBATE <run-label> VERDICT-WRITTEN <round>`, waits for that terminal with
`wait_outputSettled { idleMs: 250, timeoutMs: 10000 }`, then calls
`lifecycle_sendInput` again with `key: "Enter"`. If the author id is stale, list
terminals, require exactly one match for the recorded author recovery key, and
use its new id. This full text→settle→Enter sequence avoids the dropped-submit
race; the per-run payload cannot be confused for an ordinary prompt.

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

- `review` → [review mode](#review-mode).
- `answer` → [answer mode](#answer-mode).
- Anything else, including no arguments → ask for the explicit mode and
  `--agent <claude|codex|grok>`, then stop.

For either mode, reject a missing `--agent`. Never add a bare review alias:
`/agent-debate` deliberately does not encode or default its peer.

<a id="review-mode"></a>
# Review mode

The selected peer is the reviewer; **you are the author** with edit and commit
tools.

Two limits must be stated plainly:

- <a id="the-peer-runs-unsandboxed--a-trusted-diff-precondition"></a>**The peer
  runs unsandboxed, so review requires a trusted local diff.** The peer's
  read-only behavior rests on its prompt, not the kernel. Do not run this against
  an untrusted third-party PR: repository content can direct command execution,
  credential reads, or network access. A disposable worktree is not a security
  sandbox. Use a real OS/container sandbox with the tree mounted read-only for
  untrusted code.
- **Consensus is parsed with re-asks, not schema-forced.** A live TUI cannot be
  forced to emit valid JSON, so trust only the validated verdict file.

## Review arguments

After the leading `review`, parse:

```text
--agent <claude|codex|grok> [<pr-number>] [--repo <path>] [--base <branch>]
[--no-commit] [--no-comment] [--rationale <note>] [--context <note>]
```

- `--repo <path>` — absolute target repo, defaulting to the current worktree
  root. Root **every** git, gh, scratch, and split operation in it.
- `<pr-number>` — check out that PR in `$REPO` and default the base from it.
- `--base <branch>` — remote-tracking ref, defaulting to the PR base or remote
  default. Review from its merge-base with `HEAD`.
- `--no-commit` — leave author fixes uncommitted. Otherwise commit each round.
- `--no-comment` — suppress the compact PR comment.
- `--rationale <note>` — deliberate design decisions that the peer must receive
  in round 1 and the author must weigh in every disposition.
- `--context <note>` — task intent for the author only. Keep it out of the
  peer's independent review.

## Review steps

1. **Resolve context.** Confirm kolu, `PEER`, and `$REPO`. Fetch
   origin. If a PR number was supplied, check it out from inside `$REPO`.
   When a PR number was supplied, or when comments are enabled, discover the PR
   with `(cd "$REPO" && gh pr view --json number,baseRefName)`. Treat "no PR"
   as no comment target; treat auth/network/CLI errors as blocking because the
   requested PR operation cannot be trusted. With `--no-comment` and no PR
   number, skip `gh` entirely. Resolve the remote base and merge-base. If
   merge-base resolution fails, stop with the bad ref. Require either a
   non-empty diff or untracked files in scope.

   In commit mode, require a completely clean initial tree. Tell the user to
   commit/stash or rerun with `--no-commit`; do not sweep pre-existing changes
   into round commits. Run the selected peer preflight. Create the gitignored
   `$REPO/.agent-debate/`, then require
   `git -C "$REPO" check-ignore -q .agent-debate/`. If it is not ignored, stop
   and tell the target repo to ignore it; never edit that repo's ignore files as
   a side effect of review. Remove prior `verdict-*`, `section-*`, `ask-*`,
   `answer-*`, `candidate-*`, `candidate.md`, and `comment.md` artifacts.

2. **Spawn the selected peer** using the engine above. Record id and unique
   intent/title for both terminals.

3. **Debate each round.**

   - Write the peer ask. Require read-only inspection of `git diff
     <merge-base>`, `git status --short`, and every untracked file in scope;
     ignore `.agent-debate/`. In round 1, require all findings at every severity
     with `file:line`, covering correctness, swallowed errors, unjustified
     fallbacks, security, simplicity, and efficiency. Include `--rationale`.
     In later rounds, require the peer to read
     `section-(N-1)-author.md`, close every existing finding by verifying the
     fix or answering the dispute, and raise only regressions introduced since
     the prior round.
   - Validate `verdict-NNN.json` against the schema below. For every open
     finding, fix or dispute it. Write one clear `fixed`, `disputed`, or
     `partial` disposition with reasoning to `section-NNN-author.md`; this is
     your memory and the peer's next-round input.
   - Unless `--no-commit`, stage only the exact paths edited this round and
     commit with the findings and dispositions in the message. Record the SHA.
     Skip an empty dispute-only commit. A failed expected commit makes the round
     incomplete. Never push or merge.
   - If `approved` is true, present the result. Otherwise ping the peer with the
     next ask and end your turn.
   - Treat a downstream ship/process gate as resolved-and-deferred once both
     sides agree it cannot be satisfied mid-review. Never use this for a code
     defect.
   - If the peer cannot produce valid output after a re-ask, tear down and
     report `reviewer-error` as infrastructure failure, not consensus. Name the
     selected peer in the error; do not fall back to another one.

4. **Present and optionally post.** Tear down the peer split. Report peer,
   round count, and `git -C "$REPO" log --oneline <merge-base>..HEAD`.
   When a PR exists and comments are enabled, post one compact comment:

   - Header: `## <Peer> ⇄ <Author> debate`, using the actual normalized harness
     names, followed by consensus rounds and base.
   - One table row per debate commit: `| Round | Commit | Description |`. Keep
     each short SHA bare so GitHub autolinks it.
   - One legend line per stable finding id, sorted numerically:

     ```sh
     jq -rs '[.[].findings[]] | unique_by(.id) | sort_by(.id|ltrimstr("F")|tonumber)[]
             | "- **\(.id)** — \(.issue|split(". ")[0])"' "$REPO"/.agent-debate/verdict-*.json
     ```

   Do not inline verdicts or dispositions; the detail lives in commits and the
   gitignored scratch. Post from `$REPO` with `gh pr comment -F`. The skill
   never pushes or merges.

### Peer verdict schema (`verdict-NNN.json`)

```json
{
  "approved": false,
  "summary": "one-paragraph assessment this round",
  "findings": [
    {
      "id": "F1",
      "severity": "blocking|major|minor|nit",
      "location": "file:line",
      "issue": "what is wrong and why",
      "suggestion": "concrete fix",
      "status": "open|resolved"
    }
  ],
  "responseToRebuttal": "address each author dispute; empty in round 1"
}
```

Set `approved` to true only when every finding at every severity is resolved.
Keep finding ids stable across rounds.

## Runs to consensus — no cap, no deadlock exit

Continue until the verdict is approved. Never stop at a round cap or declare
deadlock. The only narrow carve-out is a mutually agreed
resolved-and-deferred ship gate. To stop manually, interrupt and tear down.

<a id="answer-mode"></a>
# Answer mode

Treat author and selected peer as equals:

```text
answer --agent <claude|codex|grok> -- <prompt>
```

Require a non-empty prompt after `--`. Set `$REPO` to the current worktree root;
answer mode has no cross-repo flag. Require this to be a trusted repo for the
same reason as review mode: the unrestricted peer reads repository instructions
that can induce command execution. Run the selected peer preflight, create
`.agent-debate/`, and require
`git -C "$REPO" check-ignore -q .agent-debate/`; stop if it is not ignored.
Clear old answer/candidate artifacts, spawn the peer, and use the same ping loop.
Both sides may read tracked/source files for grounding but may modify **only**
the ignored `.agent-debate/` scratch. Make no tracked-file edits, commits, or PR
writes.

Use role-based files so the protocol is independent of either harness:

- Author: `.agent-debate/answer-author-N.md`
- Peer: `.agent-debate/answer-peer-N.md`
- Peer verdict: `.agent-debate/answer-verdict-N.json`
- Author candidate verdict: `.agent-debate/candidate-author-N.json`

Run the answer rounds:

- **Round 1 — independent.** Give both sides only the prompt. Dispatch the peer
  ask and write the author answer without reading `answer-peer-1.md`.
- **Rounds 2+ — cross-check.** Read the other side's latest answer. Revise and
  record what changed, or object with a reason and `file:line` for repo-grounded
  claims. Put the author's explicit agreement/objections at the top of
  `answer-author-N.md`.
- **Keep the peer files consistent.** In every answer round, require the peer's
  `answer-peer-N.md` bytes to equal the `answer` string from
  `answer-verdict-N.json` plus one trailing newline. Reject and re-ask on a
  mismatch.
- **Confirm one candidate.** Mutual agreement on evolving answers can be a swap
  false positive. Synthesize one `.agent-debate/candidate.md`, then have both
  sides judge that identical text in a confirmation round. The author writes
  `candidate-author-N.json` as
  `{ "approved": true|false, "objections": ["..."] }`. The peer writes an
  answer verdict with `phase: "candidate"`, copies the candidate byte-for-byte
  into `answer`, and sets `agreesWithOther: true` with no objections only when
  it approves that candidate. Author approval plus peer approval → consensus.
  Either side objects → remove the candidate and resume with both objections
  folded into the next answer round.

Use this peer answer-verdict schema:

```json
{
  "phase": "answer|candidate",
  "answer": "peer's complete answer this round",
  "keyPoints": ["core claims"],
  "agreesWithOther": false,
  "objections": [
    {
      "point": "the disputed claim or gap",
      "reason": "why; cite file:line for repo-grounded prompts"
    }
  ],
  "changedMind": "what changed because the author convinced the peer; empty in round 1 or no change"
}
```

Use `phase: "answer"` in ordinary rounds and `phase: "candidate"` only for
candidate confirmation. Count peer agreement only when `agreesWithOther` is
true and `objections` is empty.

On consensus, tear down and present the confirmed candidate with peer and round
count. Assemble `.agent-debate/answer-<slug>.md` deterministically:
header, each round's `answer-author-N.md` and `answer-peer-N.md` in order, then
`candidate.md`. Point the user to it. If the peer cannot produce a valid verdict
after a re-ask, report infrastructure failure; otherwise keep debating until
confirmation succeeds or a human interrupts and tears down. Never present a
half-debate as agreed.

## Files

Keep all ephemeral state in the gitignored per-worktree `.agent-debate/` and
clear it at the start of every run:

- `ask-NNN.md`
- `verdict-NNN.json`
- `section-NNN-author.md`
- `answer-author-N.md`
- `answer-peer-N.md`
- `answer-verdict-N.json`
- `candidate-author-N.json`
- `candidate.md`
- `answer-<slug>.md`
- `comment.md`

None of the scratch feeds a PR comment except the compact generated
`comment.md`. There are no workflow or headless-agent scripts; the engine is
this protocol plus [/kolu](../kolu/SKILL.md).

This skill is generated from `agents/.apm/skills/agent-debate/`; edit the source
there and keep generated `.claude/` and `.agents/` copies identical in the same
commit (see `.claude/rules/apm-workflow.md`).

ARGUMENTS: $ARGUMENTS
