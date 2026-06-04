---
name: be
description: Modern, interactive alternative to `/do` — clarify intent up front, then take a task end-to-end with a serial AI review gauntlet (codex debate → lens debate (lowy ⇄ hickey) → code-police, each seeing the prior's fixes) → CI → evidence. ONLY invoke when the user explicitly types `/be` or `$be`; never auto-select from a natural-language request.
argument-hint: "<issue-url | prompt>"
---

# Be

Take a task to a shipped, reviewed PR. Unlike `/do` (autonomous start to finish), `/be` **opens with a short interview** — and is then **fully autonomous**, exactly like `/do`, from §1 onward. The interview is the *only* place `/be` asks the user anything; after it, make sensible defaults and keep moving — no further `AskUserQuestion`, no stopping between steps. The single exception is the optional plan-review pause in §1, and only when "plan first" was chosen. Concise by design — defer mechanics to the skills it calls.

**Requires Claude Code's `Skill` tool** (the debate reviewers it calls are `Workflow`-backed).

## 0. Interview (the differentiator)

Before any work, ask the user via **`AskUserQuestion`** (one call, batched):

- **Plan first?** — write the plan as an **Atlas note** (`docs/atlas/src/content/atlas/<slug>.mdx`) for review *before* implementing, or implement straight. Default: straight, unless the task is large/ambiguous. *(If the prompt already points at an existing Atlas note or legacy `docs/plans/*.html`, skip this question — that file is the plan of record; reuse it.)*
- **Task kind** — bug fix · feature/new behavior · refactor/chore. This sets the test strategy (see §2).
- **Ultracode?** — include this question *only when no system-reminder says ultracode is on*. Remind the user that `/be` runs richer with ultracode (deeper review fan-out, adversarial verification of each finding) and ask whether to proceed on the standard pass or pause so they can enable it. Options: *Proceed (standard pass)* / *I'll enable ultracode first*. If they pick the latter, stop and let them turn it on, then re-run.

Add a question only when something material is genuinely unclear — don't pad. Honor anything the user already pinned in the prompt instead of re-asking. **This single `AskUserQuestion` call is your one and only chance to ask** — surface every clarification you need now (including the ultracode check above), because everything after this is autonomous.

## 1. Set up

- `git fetch origin`; branch off `origin/<default>` (`git symbolic-ref --short refs/remotes/origin/HEAD`). Feature branches only — never commit to master.
- Read `.agency/do.md` for the project's **check / fmt / test / ci** commands and its **`## PR evidence`** section. Reuse them throughout.
- **If "plan first" (or working off an existing plan):** the plan of record is an **Atlas note** at `docs/atlas/src/content/atlas/<slug>.mdx` (authored in MDX — reuse the kit in `docs/atlas/src/components/`, e.g. `<PrLink>`/`<Cite>`/`<Callout>`). If new, write it with frontmatter — `title`, `description`, `kind:` (`bug` or `feature` to match the §0 task kind; else `analysis`/`reference`), `maturity: seedling`, `status: proposed`, optional `parents` (flat slugs) — then `just atlas::build` and stage `docs/atlas/dist/` (the `ci::atlas-sync` gate fails if the committed HTML is stale). Either way **stop and hand the rendered `docs/atlas/dist/<slug>.html` to the user to read in the Code tab and comment** — do *not* use plan mode. Wait for them to reply; incorporate feedback (rebuild each time), and resume only once they say proceed. This is the one sanctioned pause. **The plan ships in the PR** — commit the `.mdx` *and* its regenerated `dist/` onto the branch (with the §2 work or its own commit) so the merged diff carries the plan it was built from. *(A legacy `docs/plans/*.html` plan stays HTML — edit it in place.)*

## 2. Implement

- **Bug:** reproduce first — write a **failing e2e test** that captures the bug (via the `/test` harness), confirm it's red, *then* fix until green. No fix without a reproducing test.
- **Feature / new behavior:** write the covering test (e2e/integration/unit as fits) before or alongside the change.
- **Refactor/chore:** no test-first requirement; rely on existing coverage.

Run **check** and **fmt**, then commit (conventional message) and push the feature branch.

## 3. Open the PR

**Before any review** — so every reviewer's findings land as comments on a real PR. Load **`/forge-pr`** (Skill tool) and `gh pr create --draft` with a genuine title/body covering the scope so far. The PR exists for the rest of the run; later steps push commits and post comments to it.

**If there's a plan of record, finalize it now.** Once the PR URL exists, update the Atlas note to read as it will *after merge* — flip frontmatter `status: implemented` and **link the PR** with `<PrLink pr={<n>} />` (e.g. a lead line) — then `just atlas::build`, stage `docs/atlas/dist/`, commit (`docs(atlas): link PR #<n>`) and push so the finalized plan is part of this PR. This applies equally to a freshly-written plan and one the user brought in. *(A legacy `docs/plans/*.html` plan stays HTML — edit its status/PR link in place.)*

## 4. Review gauntlet

Run **`/be-review`** (Skill tool) — it runs the three reviewers **serially** on the
branch (`/codex-debate` → `/lens-debate` → `/code-police`, each seeing the prior's
committed fixes, ordered heaviest-change-first → polish-last), each leaving a PR
comment. Serial because the reviewers *edit*, and on a small change they all edit
the same code — running them at once collides; running them in order doesn't.

- Pass `base` and the change **`rationale`** (so the lenses don't flag deliberate
  decisions). Preflight is a non-empty diff and (since codex runs) `codex login
  status`.
- Each step commits its own `fix(…)` / `fix(police):` directly on the branch — no
  worktrees, no consolidation. Confirm the three PR comments landed.
- On an **unresolved** lens finding, adjudicate it yourself before moving on.

## 5. Ship — CI and evidence in parallel

`/ci` and `/evidence` are independent — one exercises the build/test pipeline, the
other captures on-screen behavior — so **run them concurrently**; don't wait for
green before capturing.

1. **Kick off `/ci` first, backgrounded** — start the pipeline (background;
   consume `--progress json`) so it churns while you capture evidence. React to
   streamed `failed`/`errored` nodes the moment they land: fix→fmt→commit→retry
   on real failures, confirm green on the final `HEAD`.
2. **Concurrently, run `/evidence`** while CI runs — follow the **`## PR
   evidence`** section of `.agency/do.md` for the capture procedure, then post the
   result under `## Evidence`. For bug fixes, demonstrate the now-fixed behavior
   even when there's no visual diff. Skip only if that section says to (or is
   absent).
3. **Join before Done** — confirm CI is green on the final `HEAD` **and** evidence
   is posted. If a CI fix-commit changed visible behavior *after* capture,
   re-capture so the evidence matches what actually merges.

## Done

Report the PR URL, the serial gauntlet outcome (codex consensus or reviewer-error, lens-debate consensus, police findings actioned), and CI status. Never merge — the human reviews the commits and merges when satisfied.

ARGUMENTS: $ARGUMENTS
