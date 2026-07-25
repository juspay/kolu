# Answer mode

Read this only when `$ARGUMENTS` starts with `answer`. The engine (peer launch,
the ping loop, teardown) is in `SKILL.md`; this file is the answer protocol on
top of it.

Treat author and selected peer as equals:

```text
answer --agent <claude|codex|grok> -- <prompt>
```

Require a non-empty prompt after `--`. Set `$REPO` to the current worktree root;
answer mode has no cross-repo flag. Require this to be a trusted repo for the
same reason review mode does (`REVIEW.md`): the unrestricted peer reads
repository instructions that can induce command execution. Run the selected peer
preflight, create `.agent-debate/`, and require
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
