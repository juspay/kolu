---
name: be
description: Modern, interactive alternative to `/do` — clarify intent up front, then take a task end-to-end with an AI review gauntlet (codex debate → hickey/lowy/code-police → CI → evidence). ONLY invoke when the user explicitly types `/be` or `$be`; never auto-select from a natural-language request.
argument-hint: "<issue-url | prompt>"
---

# Be

Take a task to a shipped, reviewed PR. Unlike `/do` (autonomous start to finish), `/be` **opens with a short interview** — and is then **fully autonomous**, exactly like `/do`, from §1 onward. The interview is the *only* place `/be` asks the user anything; after it, make sensible defaults and keep moving — no further `AskUserQuestion`, no stopping between steps (the `EnterPlanMode` approval in §1, only when "plan first" was chosen, is the lone exception). Concise by design — defer mechanics to the skills it calls.

**Requires Claude Code's `Workflow` and `Skill` tools.** Under codex/opencode the review fan-out degrades to sequential subagents.

## 0. Interview (the differentiator)

Before any work, ask the user via **`AskUserQuestion`** (one call, batched):

- **Plan first?** — write an HTML plan to `docs/plans/<slug>.html` for approval *before* implementing, or implement straight. Default: straight, unless the task is large/ambiguous.
- **Task kind** — bug fix · feature/new behavior · refactor/chore. This sets the test strategy (see §2).

Add a question only when something material is genuinely unclear — don't pad. Honor anything the user already pinned in the prompt instead of re-asking. **This single `AskUserQuestion` call is your one and only chance to ask** — surface every clarification you need now, because everything after this is autonomous.

**Ultracode reminder:** if no system-reminder says ultracode is *on*, tell the user once — "`/be` runs richer with ultracode (deeper review fan-out, more verification). Enable it for max effort; otherwise I'll run the standard pass." Then proceed; don't block on it.

## 1. Set up

- `git fetch origin`; branch off `origin/<default>` (`git symbolic-ref --short refs/remotes/origin/HEAD`). Feature branches only — never commit to master.
- Read `.agency/do.md` for the project's **check / fmt / test / ci** commands. Reuse them throughout.
- **If "plan first":** write `docs/plans/<slug>.html`, present it (`EnterPlanMode`/`ExitPlanMode`), and only implement once approved.

## 2. Implement

- **Bug:** reproduce first — write a **failing e2e test** that captures the bug (via the `/test` harness), confirm it's red, *then* fix until green. No fix without a reproducing test.
- **Feature / new behavior:** write the covering test (e2e/integration/unit as fits) before or alongside the change.
- **Refactor/chore:** no test-first requirement; rely on existing coverage.

Prefer the boring, obvious, simple thing. Run **check** and **fmt**, then commit (conventional message) and push the feature branch.

## 3. Review gauntlet

Run **in order** — each surfaces different defects:

1. **`/codex-debate`** (Skill tool) on the diff. It loops codex⇄claude to consensus and commits per round. Let it finish before moving on.
2. **`/hickey` + `/lowy` + `/code-police`** as parallel subagents. Under ultracode, orchestrate them with the **`Workflow` tool** (fan-out + adversarial verify of each finding); otherwise emit the three `Agent` calls in a single turn. Brief each with the diff (`git diff origin/HEAD...HEAD`) and the change rationale only — do **not** seed findings.

**Apply every finding as its own commit** (`refactor(hickey):` / `refactor(lowy):` / `fix(police):` …). No deferrals — hickey/lowy emit only *Fix in this PR* / *No-op*; `/code-police` runs its rules → fact-check → elegance passes to clean. Re-run check/fmt after each fix.

## 4. Ship

1. **`/forge-pr`** (Skill tool) — open the PR (draft) with a real title/body. Post the codex-debate summary and the hickey/lowy/police findings as PR comments.
2. **`/ci`** — run the pipeline (background; consume `--progress json`), fix→fmt→commit→retry on real failures, confirm green on current `HEAD`.
3. **`/evidence`** — capture visual/behavioral proof and post it under `## Evidence`. For bug fixes, demonstrate the now-fixed behavior even when there's no visual diff.

## Done

Report the PR URL, the outcome of each review (codex consensus/deadlock, findings actioned), and CI status. Never merge — the human reviews the per-step commits and merges when satisfied.

ARGUMENTS: $ARGUMENTS
