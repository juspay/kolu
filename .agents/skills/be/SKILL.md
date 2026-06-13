---
name: be
description: Modern, interactive alternative to `/do` — clarify intent up front, then take a task end-to-end with a serial AI review gauntlet (lens debate (lowy ⇄ hickey) → codex debate → simplify → code-police, each editing the branch in turn) → CI → evidence. ONLY invoke when the user explicitly types `/be` or `$be`; never auto-select from a natural-language request.
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
- **If "plan first" (or working off an existing plan):** the plan of record is an **Atlas note** (`docs/atlas/src/content/atlas/<slug>.mdx`). **Load `/atlas` (Skill tool)** for the note mechanics — frontmatter, the component kit, `just atlas::build` + staging `dist/`, and the Code-tab + htmlpreview share links. Set `kind:` to match the §0 task (`bug`/`feature`; else `analysis`/`reference`) and `status: proposed`. The plan itself must: **(a)** stay **high-level** — user- and architecture-focused (what changes + the *shape*: seam, data flow, trade-offs and alternatives), with **no implementation dump** (no line-level code, file-by-file lists, or signatures; the *how* is §2's job); **(b)** carry a **UI prototype** (`<AtlasMockup>` or inline JSX) if the change has any on-screen surface, so the user judges look-and-feel before code. **Self-check before presenting** — rework until all hold; don't make the user be the linter: high-level ✓, prototype-if-visual ✓, renders clean ✓. Then **push the branch** and **hand it over** for review via the Code tab *and* the htmlpreview link — do *not* use plan mode; wait for the user's reply, incorporate feedback (rebuild + push each round), and resume only on their go. This is the one sanctioned pause. **The plan ships in the PR.** *(A legacy `docs/plans/*.html` plan stays HTML — edit it in place.)*

## 2. Implement

- **Bug:** reproduce *before* you theorize or fix — start from facts, not a story about the bug. **(1)** Get ground truth from the running system; observe the real symptom, don't trust a description of it. **(2)** Pin the one hard, observable fact the bug produces — a wrong value, an error, a state that can't legally happen (e.g. "the client SHA stays `7deb397` across reloads"). **(3)** Build a reproduction that exhibits *that exact fact* and is **red on the current code** — a **failing e2e test** via the `/test` harness when it can express the bug, otherwise a scripted repro. A repro that *passes / converges / "works"* is **not** a reproduction: if it doesn't show the symptom the **repro** is wrong — fix the repro, never conclude "no bug" from it. **(4)** Only now fix, until that same repro flips green. No fix without a reproduction that was first red for the real reason.
- **Feature / new behavior:** write the covering test (e2e/integration/unit as fits) before or alongside the change.
- **Refactor/chore:** no test-first requirement; rely on existing coverage.

**Sync the docs.** Read `.agency/do.md` for its **`## Documentation`** section — the list of files to keep in lockstep with code (README and the like). Compare each against this change and update any that the diff makes stale, so the docs commit rides the same review gauntlet as the code. Skip only when that section is absent or the change is genuinely doc-neutral.

**Add a changelog entry.** For any **user-facing** change, append one line to `website/src/content/changelog/unreleased.mdx` under the right `###` heading — `Added` / `Fixed` / `Changed` / `Heads-up` (the editorial home for disruptive changes: a removed feature, a changed default, a migration). Create the heading if a freshly-reset section doesn't have it yet. Write it as prose a *user* reads, not a commit subject — no PR link yet (the PR doesn't exist until §3; you backfill the link there). Skip only when the change has no user-visible effect (pure refactor/chore/internal). The file is `merge=union`, so a plain append (or a new heading) never conflicts.

Run **check** and **fmt**, then commit (conventional message) and push the feature branch.

## 3. Open the PR

**Before any review** — so every reviewer's findings land as comments on a real PR. Load **`/forge-pr`** (Skill tool) and `gh pr create --draft` with a genuine title/body covering the scope so far. The PR exists for the rest of the run; later steps push commits and post comments to it.

**Backfill the changelog PR link.** If §2 added a changelog entry, fill in its PR now that the number exists — set the **`pr={<n>}`** prop on the entry's `<Change title="…" pr={<n>}>…</Change>` (auto-injected into changelog MDX, so no import; it renders the GitHub-style PR chip). Then commit and push so the link rides this PR. Skip if §2 added no entry.

**If there's a plan of record, finalize it now.** Once the PR URL exists, **finalize the Atlas note via `/atlas`**: set `status: implemented`, link the PR with `<PrLink pr={<n>} />`, rebuild + stage `dist/`, commit (`docs(atlas): link PR #<n>`) and push so it's part of this PR. *(A legacy `docs/plans/*.html` plan stays HTML — edit its status/PR link in place.)*

## 4. Review gauntlet

Run **`/be-review`** (Skill tool) — it runs four reviewers **serially**, each the
sole editor while it runs: `/lens-debate` applying the agreed fixes, then
`/codex-debate` (its per-round commits are the debate), then `/simplify`, then
code-police. Each step reads a clean tree (the previous step has committed) and
applies its own fixes directly — no snapshot, no apply pass. be-review pushes once
at the end and *then* posts the PR comments (lens, codex, and a code-police
summary), so no comment advertises a local-only commit.

- Pass `base` and the change **`rationale`** (so the lenses don't flag deliberate
  decisions). Preflight is a non-empty diff and (since codex runs) `codex login
  status`.
- Lens-debate commits its agreed fixes; codex's rounds commit `fix(…)`; simplify
  and code-police commit `refactor:` / `fix(police):`. Confirm the post-push PR
  comments landed: lens, codex, and — when the police track ran — the code-police
  summary.
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

Report the PR URL, the gauntlet outcome (lens-debate consensus + fixes applied, codex consensus or reviewer-error, police findings actioned), and CI status. Never merge — the human reviews the commits and merges when satisfied.

ARGUMENTS: $ARGUMENTS
