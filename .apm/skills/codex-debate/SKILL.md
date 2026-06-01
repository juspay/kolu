---
name: codex-debate
description: Run an automated code-review debate between the codex CLI (reviewer) and a Claude subagent (author) on the current diff, looping until they reach consensus, deadlock, or a round cap. Use when the user types `/codex-debate`, or asks to "have codex review this", "run the codex debate", "review this PR with codex", or "argue this with codex until you agree".
argument-hint: "[<pr-number>] [--base <branch>] [--max-rounds <n>] [--html <path>] [--no-commit] [--no-comment]"
---

# Codex ⇄ Claude review debate

Automate the back-and-forth you'd otherwise courier by hand: **codex** (the
reviewer) critiques the current change, a **Claude subagent** (the author)
fixes what it agrees with and disputes what it doesn't, codex re-reviews, and so
on — until they reach **consensus**, hit a **deadlock**, or burn the **round
cap**. You stay out of the middle: each round lands as its own commit whose
message carries the debate context (codex's findings + Claude's dispositions) so
the PR history reads as the debate, a **live HTML transcript** updates after
every round so you can watch it unfold, and the summary is **posted to the PR**
as a comment at the end.

## Why this shape

The two sides are asymmetric, and that asymmetry is the whole design:

- **codex** is CLI-invokable headlessly (`codex exec`, authed via ChatGPT), so it
  runs from a shell command.
- **Claude on a Max plan is *not* headless** — `claude -p` doesn't work with Max
  auth. But the **Workflow tool's `agent()` spawns Claude subagents through the
  harness**, not `claude -p`, so it works. That subagent is the author side.

So the debate runs as a Workflow: `agent()` is Claude, a Bash-invoked
`codex exec` is the reviewer, and the script couriers structured verdicts
between them and decides when they agree. Both sides are forced to emit
schema-constrained JSON, so consensus is detected in code, not by vibes.

**This skill requires Claude Code's `Workflow` tool** (it is the engine). Under
codex/opencode runtimes the skill is inert.

## Arguments

Parse `[<pr-number>] [--base <branch>] [--max-rounds <n>] [--html <path>] [--no-commit] [--no-comment]`:

- **`<pr-number>`** (optional): a PR to debate. If given, `gh pr checkout <n>`
  first and default the base to that PR's base branch. If omitted, debate the
  **current branch's** working-tree diff.
- **`--base <branch>`**: branch to diff against. Default: the PR base (when a PR
  number is given) else the repo default branch (`git symbolic-ref --short refs/remotes/origin/HEAD` → strip `origin/`, fallback `master`).
- **`--max-rounds <n>`**: hard cap on codex review rounds. Default **5**.
- **`--html <path>`**: where to write the reviewable HTML transcript. Default:
  `codex-debate-transcript.html` in the repo root — a **committable** file (NOT
  gitignored), re-rendered live after every round so you can open it and watch
  the debate unfold. Per-worktree, so parallel debates don't collide.
- **`--no-commit`**: don't commit per round — leave all agreed changes
  uncommitted in the working tree for you to commit yourself. Default is to
  **commit each round** (see below).
- **`--no-comment`**: don't post the debate summary to the PR. By **default**, when
  a PR exists, the debate summary IS posted as a PR comment (see step 3). Pass
  this to suppress the outward-facing write and report in chat only.

## Steps

### 1. Resolve context

- Determine `repoPath` (the worktree root, normally the cwd).
- Resolve `base` per the rules above.
- If a PR number was given, `gh pr checkout <n>` and confirm the branch.
- Confirm there is a non-empty diff: `git diff --stat <base>`. If empty, tell the
  user there's nothing to review and stop.
- **Preflight codex**: `codex login status`. If not logged in, stop and tell the
  user to run `codex login` (suggest the `!` prefix to do it in-session).

### 2. Run the debate Workflow

Invoke the **`Workflow` tool** pointing at this skill's committed script, passing
context through `args`:

```
Workflow({
  scriptPath: ".claude/skills/codex-debate/debate.workflow.js",
  args: {
    repoPath: "<worktree root>",        // also the per-worktree scratch dir root
    base: "<base branch>",
    maxRounds: <n, default 5>,
    htmlOut: "<resolved --html path>",  // omit to default to ./codex-debate-transcript.html
    commit: <false only if --no-commit>,
    skillDir: ".claude/skills/codex-debate"
  }
})
```

The workflow runs in the background and notifies you when it completes. It
alternates `codex:roundN` and `claude:roundN` agents under a **Debate** phase —
the user can watch live via `/workflows`. Each Claude round edits the working
tree, then (unless `--no-commit`) a `commit:roundN` agent **commits exactly that
round's changed files** with a message embedding the round's codex findings and
Claude's dispositions — never pushing or merging.

**Live HTML.** After every state change — each codex verdict (`render:rN-codex`)
and each Claude round (`render:rN-claude`), plus a final `render:final` — a
mechanical render agent re-writes `htmlOut` via `scripts/render-debate.mjs`. So
the committable `codex-debate-transcript.html` updates in **real time**: open it
and watch the debate unfold, round by round, rather than waiting for the end.

Ephemeral scratch (verdicts, rebuttals, transcript JSON) lives under the
gitignored, per-worktree `<repoPath>/.codex-debate/`, so **parallel debates in
different worktrees never collide** and the scratch never shows up in the diff
codex reviews. The HTML output itself sits at the repo root (committable). It
returns:

```
{ status: "consensus" | "deadlock" | "max-rounds",
  rounds, base, finalVerdict, filesChanged, transcript, htmlOut }
```

(each `transcript[]` round also carries a `commit` SHA when that round committed.)

- **consensus** — codex approved with no blocking/major findings open.
- **deadlock** — codex kept raising the same blocking findings while Claude
  disputed them all; the script stopped rather than burn rounds. Needs you.
- **max-rounds** — the cap was hit with findings still open.

### 3. Present the result

Report in chat (do **not** push or merge — the per-round commits sit on the
local branch for the human to review):

- **The HTML transcript path** (`htmlOut`) front and center — re-rendered live
  throughout the run and finalized at the end; this committable file is the
  reviewable record of the whole debate. Surface it as a clickable path.
- The outcome (`status`) and round count.
- `git log --oneline <base>..HEAD` (the per-round debate commits) and
  `git diff --stat <base>` so the user sees what the debate changed.
- A compact per-round table from `transcript` — each round's codex verdict
  (approved? open blocking/major count), Claude's dispositions, and the
  round's `commit` SHA.
- On **deadlock**, surface both positions plainly (codex's held-firm findings +
  Claude's disputes with reasons) so the human can adjudicate — do not pick a
  winner yourself.
- The agreed changes are committed per round on the local branch (or, under
  `--no-commit`, uncommitted in the working tree). The user reviews, then pushes
  / merges (or runs `/do --from post-implement`) when satisfied.
- **Post the debate summary to the PR (default).** When a PR exists and
  `--no-comment` was NOT passed, post a `## Codex ⇄ Claude debate` comment via
  `gh pr comment`. Include: the outcome badge (consensus/deadlock/max-rounds) and
  round count; a per-round table (codex approved? open blocking/major findings;
  Claude's dispositions; the round's commit SHA); and, on deadlock, both
  positions. Use a single-quoted heredoc so backticks/`$` survive. This is an
  outward-facing write — it's on by default because the whole point is to leave
  the review trail on the PR; `--no-comment` suppresses it.

## Safety & notes

- **codex runs read-only — enforced, not just asked.** codex is invoked with
  `--sandbox read-only`, so the kernel sandbox blocks file writes and other
  state-mutating syscalls; the prompt's "don't write" instruction is belt-and-
  suspenders, not the only guard. This matters because codex reviews arbitrary
  diffs and could be prompt-injected by file contents. The only writes to the
  tree come from the Claude author rounds. (codex auto-falls-back to its bundled
  bubblewrap when the system one is absent, so read-only works in containers.)
- **Commits, but never pushes or merges.** Each round is committed locally (unless
  `--no-commit`) so the PR history reads as the debate, but the skill never
  pushes or merges. Consensus means "both AIs agree on the committed code," not
  "ship it" — the human reviews the commits and pushes/merges.
- **Parallel-safe.** Ephemeral scratch (verdicts, rebuttals, transcript JSON) lives
  under the gitignored, per-worktree `<repoPath>/.codex-debate/`; the HTML output
  sits at the repo root (committable, not gitignored). Both are per-worktree, so
  debates on many worktrees run at once without clobbering each other — no shared
  `/tmp` paths.
- **Posts to the PR by default.** When a PR exists, the debate summary is posted
  as a PR comment (outward-facing write) unless `--no-comment` is passed — the
  point is to leave the review trail on the PR.
- **Bounded.** The loop always terminates — consensus, deadlock detection, or the
  round cap. It cannot run forever.

## Files

- `debate.workflow.js` — the Workflow script (the loop + consensus/deadlock logic + Render phase).
- `scripts/codex-review.sh` — the canonical, deterministic `codex exec` invocation.
- `scripts/codex-verdict.schema.json` — the JSON Schema codex's verdict is constrained to.
- `scripts/render-debate.mjs` — deterministic node renderer: transcript JSON → self-contained HTML.

These are generated from `.apm/skills/codex-debate/`; edit the source there and
run `just ai apm` to regenerate.

ARGUMENTS: $ARGUMENTS
