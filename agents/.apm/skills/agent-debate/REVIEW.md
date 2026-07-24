# Review mode

Read this only when `$ARGUMENTS` starts with `review`. The engine (peer launch,
the ping loop, teardown) is in `SKILL.md`; this file is the review protocol on
top of it.

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

2. **Spawn the selected peer** using the engine in `SKILL.md`. Record id and
   unique intent/title for both terminals.

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

## Peer verdict schema (`verdict-NNN.json`)

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
