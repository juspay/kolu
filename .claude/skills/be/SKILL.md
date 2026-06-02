---
name: be
description: Modern, interactive alternative to `/do` — clarify intent up front, then take a task end-to-end with an AI review gauntlet (codex debate → lens debate (lowy ⇄ hickey) → code-police → CI → evidence). ONLY invoke when the user explicitly types `/be` or `$be`; never auto-select from a natural-language request.
argument-hint: "<issue-url | prompt>"
---

# Be

Take a task to a shipped, reviewed PR. Unlike `/do` (autonomous start to finish), `/be` **opens with a short interview** — and is then **fully autonomous**, exactly like `/do`, from §1 onward. The interview is the *only* place `/be` asks the user anything; after it, make sensible defaults and keep moving — no further `AskUserQuestion`, no stopping between steps. The single exception is the optional plan-review pause in §1, and only when "plan first" was chosen. Concise by design — defer mechanics to the skills it calls.

**Requires Claude Code's `Workflow` and `Skill` tools.** Under codex/opencode the review fan-out degrades to sequential subagents.

## 0. Interview (the differentiator)

Before any work, ask the user via **`AskUserQuestion`** (one call, batched):

- **Plan first?** — write an HTML plan to `docs/plans/<slug>.html` for review *before* implementing, or implement straight. Default: straight, unless the task is large/ambiguous. *(If the prompt already points at an existing `docs/plans/*.html`, skip this question — that file is the plan of record; reuse it.)*
- **Task kind** — bug fix · feature/new behavior · refactor/chore. This sets the test strategy (see §2).
- **Ultracode?** — include this question *only when no system-reminder says ultracode is on*. Remind the user that `/be` runs richer with ultracode (deeper review fan-out, adversarial verification of each finding) and ask whether to proceed on the standard pass or pause so they can enable it. Options: *Proceed (standard pass)* / *I'll enable ultracode first*. If they pick the latter, stop and let them turn it on, then re-run.

Add a question only when something material is genuinely unclear — don't pad. Honor anything the user already pinned in the prompt instead of re-asking. **This single `AskUserQuestion` call is your one and only chance to ask** — surface every clarification you need now (including the ultracode check above), because everything after this is autonomous.

## 1. Set up

- `git fetch origin`; branch off `origin/<default>` (`git symbolic-ref --short refs/remotes/origin/HEAD`). Feature branches only — never commit to master.
- Read `.agency/do.md` for the project's **check / fmt / test / ci** commands and its **`## PR evidence`** section. Reuse them throughout.
- **If "plan first" (or working off an existing plan):** the `docs/plans/<slug>.html` file is the **plan of record**. If new, write it; either way **stop and hand it to the user to read and comment** — do *not* use plan mode. Wait for them to reply; incorporate their feedback, and resume the workflow only once they say proceed. This is the one sanctioned pause. **The plan ships in the PR** — commit it onto the branch (with the §2 work or its own commit) so the merged diff carries the plan it was built from.

## 2. Implement

- **Bug:** reproduce first — write a **failing e2e test** that captures the bug (via the `/test` harness), confirm it's red, *then* fix until green. No fix without a reproducing test.
- **Feature / new behavior:** write the covering test (e2e/integration/unit as fits) before or alongside the change.
- **Refactor/chore:** no test-first requirement; rely on existing coverage.

Run **check** and **fmt**, then commit (conventional message) and push the feature branch.

## 3. Open the PR

**Before any review** — so every reviewer's findings land as comments on a real PR. Load **`/forge-pr`** (Skill tool) and `gh pr create --draft` with a genuine title/body covering the scope so far. The PR exists for the rest of the run; later steps push commits and post comments to it.

**If there's a plan of record, finalize it now.** Once the PR URL exists, update `docs/plans/<slug>.html` to read as it will *after merge* — flip its status to implemented/done and **link the PR** (e.g. a header line `Implemented in #<n>`) — then commit (`docs(plan): link PR #<n>`) and push so the finalized plan is part of this PR. This applies equally to a freshly-written plan and one the user brought in.

## 4. Review gauntlet

Run **in order** — each surfaces different defects, each posts its findings to the PR:

1. **`/codex-debate`** (Skill tool) on the diff. It loops codex⇄claude to consensus, commits per round, and posts its summary as a PR comment by default. Let it finish before moving on.
2. **`/lens-debate`** (Skill tool) on the diff, briefed with the change rationale only — do **not** seed findings. One call does the whole `/lowy` ⇄ `/hickey` structural pass: it reviews with both lenses **independently in parallel** (forcing both onto Opus, overriding their `model: sonnet` frontmatter), debates **every** finding to consensus, applies each agreed `fix` as its own commit, and posts the debate summary to the PR. Pass the change rationale via its `rationale` arg so the lenses don't flag deliberate decisions. Deadlock is not possible; on the rare **unresolved** finding, adjudicate it yourself before moving on. Let it finish.
3. **`/code-police`** (Skill tool) on the resulting diff — its rules → fact-check → elegance passes until clean. **Each finding is its own commit** — never batch: apply the narrow fix, re-run **check** and **fmt**, `git add` only the touched files, commit (`fix(police):` …) with the finding restated in one line, and `git push`. Then post its findings to the PR as a comment.

## 5. Ship

1. **`/ci`** — run the pipeline (background; consume `--progress json`), fix→fmt→commit→retry on real failures, confirm green on current `HEAD`.
2. **`/evidence`** — follow the **`## PR evidence`** section of `.agency/do.md` for the capture procedure, then post the result under `## Evidence`. For bug fixes, demonstrate the now-fixed behavior even when there's no visual diff. Skip only if that section says to (or is absent).

## Done

Report the PR URL, the outcome of each review (codex consensus/deadlock, lens-debate consensus, findings actioned), and CI status. Never merge — the human reviews the per-step commits and merges when satisfied.

ARGUMENTS: $ARGUMENTS
