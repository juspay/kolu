---
name: codex-debate
description: Run an automated code-review debate between the codex CLI (reviewer) and a Claude subagent (author) on the current diff, looping until they reach consensus, deadlock, or a round cap. Use when the user types `/codex-debate`, or asks to "have codex review this", "run the codex debate", "review this PR with codex", or "argue this with codex until you agree".
argument-hint: "[<pr-number>] [--base <branch>] [--max-rounds <n>] [--html <path>] [--comment]"
---

# Codex ⇄ Claude review debate

Automate the back-and-forth you'd otherwise courier by hand: **codex** (the
reviewer) critiques the current change, a **Claude subagent** (the author)
fixes what it agrees with and disputes what it doesn't, codex re-reviews, and so
on — until they reach **consensus**, hit a **deadlock**, or burn the **round
cap**. You stay out of the middle and review the agreed result at the end.

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

Parse `[<pr-number>] [--base <branch>] [--max-rounds <n>] [--comment]`:

- **`<pr-number>`** (optional): a PR to debate. If given, `gh pr checkout <n>`
  first and default the base to that PR's base branch. If omitted, debate the
  **current branch's** working-tree diff.
- **`--base <branch>`**: branch to diff against. Default: the PR base (when a PR
  number is given) else the repo default branch (`git symbolic-ref --short refs/remotes/origin/HEAD` → strip `origin/`, fallback `master`).
- **`--max-rounds <n>`**: hard cap on codex review rounds. Default **5**.
- **`--html <path>`**: where to write the reviewable HTML transcript. Default:
  `docs/codex-debate/<branch>.html` if `docs/` exists, else
  `codex-debate-transcript.html` in the repo root.
- **`--comment`**: also post a summary of the debate as a PR comment (only when a
  PR exists). **Off by default** — posting to a PR is an outward-facing write, so
  require the flag. Without it, report in chat only.

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
    repoPath: "<worktree root>",
    base: "<base branch>",
    maxRounds: <n, default 5>,
    htmlOut: "<resolved --html path>",
    skillDir: ".claude/skills/codex-debate"
  }
})
```

The workflow runs in the background and notifies you when it completes. It
alternates `codex:roundN` and `claude:roundN` agents under a **Debate** phase —
the user can watch live via `/workflows`. Each Claude round **edits the working
tree in place** (no commits, no push). After the debate, a final **Render**
phase subagent runs `scripts/render-debate.mjs` to write the self-contained HTML
transcript to `htmlOut`. It returns:

```
{ status: "consensus" | "deadlock" | "max-rounds",
  rounds, base, finalVerdict, filesChanged, transcript, htmlOut, htmlPath }
```

- **consensus** — codex approved with no blocking/major findings open.
- **deadlock** — codex kept raising the same blocking findings while Claude
  disputed them all; the script stopped rather than burn rounds. Needs you.
- **max-rounds** — the cap was hit with findings still open.

### 3. Present the result

Report in chat (do **not** push or commit — the working tree holds the agreed
changes for the human to review):

- **The HTML transcript path** (`htmlOut`) front and center — the workflow's
  Render phase already wrote it; this is the reviewable record of the whole
  debate. Surface it as a clickable path so the user can open it.
- The outcome (`status`) and round count.
- `git diff --stat <base>` so the user sees what the debate changed.
- A compact per-round table from `transcript` — each round's codex verdict
  (approved? open blocking/major count) and Claude's dispositions.
- On **deadlock**, surface both positions plainly (codex's held-firm findings +
  Claude's disputes with reasons) so the human can adjudicate — do not pick a
  winner yourself.
- The agreed changes are uncommitted in the working tree. The user commits/pushes
  (or runs `/do --from post-implement`) when satisfied.
- **If `--comment`** and a PR exists: post a `## Codex ⇄ Claude debate` summary
  comment via `gh pr comment` (outcome, round count, the per-round table). Use a
  single-quoted heredoc so backticks/`$` survive.

## Safety & notes

- **codex runs read-only.** The review prompt forbids file writes and git-write
  commands; the only writes to the tree come from the Claude author rounds.
  codex is invoked with `--dangerously-bypass-approvals-and-sandbox` on purpose:
  we're already inside Claude Code's sandbox, and codex's own `--sandbox
  read-only` mode hangs in containers without landlock.
- **No auto-merge.** The skill never commits, pushes, or merges. Consensus means
  "both AIs agree on the code in the working tree," not "ship it."
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
