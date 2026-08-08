---
name: do
description: Do a task end-to-end — implement, PR, CI loop, ship. ONLY invoke when the user explicitly types `/do` or `$do`; never auto-select from a natural-language request, even one that sounds like an end-to-end task.
argument-hint: "<issue-url | prompt> [--review] [--no-git] [--minimal] [--from <step>]"
---

# Do Workflow

Take a task top-to-bottom: research, branch, implement, pass CI, open a PR,
ship. **Mostly autonomous** — no `AskUserQuestion` except during the
`--review` planning pause; make sensible defaults and keep moving.

The workflow is **forge-aware**: the sync step classifies the forge from the
origin URL. Only GitHub has an active code path today — on other forges the
PR-related steps skip gracefully ([srid/agency#10](https://github.com/srid/agency/issues/10)).

## Arguments

- `--review`: pause after **research** for plan approval via
  `EnterPlanMode`/`ExitPlanMode` (clarify ambiguities there, high-level plan
  with an architecture section, phased for non-trivial work), then continue
  autonomously.
- `--no-git`: extend the working tree **in place** — no branch, commit, push,
  or PR. All non-git steps still run; git-mutating steps record
  `skipped`/`"--no-git"`, and review/police fixes apply to the working tree
  uncommitted.
- `--minimal`: skip **docs**, **hickey+lowy**, **police**, and **evidence**
  (each records `skipped`/`"--minimal"`). For obviously-confined diffs — a
  one-line fix, a typo — where structural review and evidence are overkill.
- `--from <step-id>`: start from an entry point (table at the end).

## Bookkeeping

Every step is bookended by `scripts/do-results step-start <name>` /
`step-end <status> "<verification>" ["<reason>"]`, with the `TaskCreate` task
list updated alongside. **Read [`RESULTS.md`](RESULTS.md) once at sync** for
the command reference and lifecycle rules. Why the workflow is ordered this
way: [`RATIONALE.md`](RATIONALE.md) — read when editing this skill, not
running it.

## Steps

### sync

Run `.../skills/do/scripts/steps/sync <noGit>`. It fetches origin, pins
`origin/HEAD`, fast-forwards when clean (preserving the tree under
`--no-git`), warns on a dirty tree, classifies the forge, initializes
do-results, and prints `forge=`, `branch=`, `defaultBranch=` for downstream
steps. **Verify**: exited 0 and printed those three lines.

### research

Research before writing code. Fetch a GitHub issue URL with `gh issue view`
(on other forges treat issue URLs as opaque context). **Never assume — read
the code.** For external libraries, clone to a scratch dir at the version the
project uses and read the source; web search only when there's no clonable
source.

**Keep the main context lean**: before your third `Read`, delegate the rest to
`Agent(subagent_type=Explore)`. Main-context reads are for files the user
named and for verifying specific file:line cites a subagent surfaced
(with `offset`/`limit`). Keep the returned file:line map and reference it in
later steps instead of re-reading.

**Verify**: can articulate what changes, where, and why, with file:line
citations. **If `--review`**: present the plan via `EnterPlanMode`/
`ExitPlanMode`; once approved, continue autonomously.

### branch

(`--no-git`: skip.) Create a descriptive feature branch from
`origin/<default>`. No commit, no push, no PR yet. **Verify**: on a feature
branch.

### implement

Test-first by change kind:

- **Bug fix**: failing test first, then the fix.
- **New behavior** — anything that fails at runtime if wrong (endpoints,
  services, config paths, env vars, migrations, auth flows): write the
  covering integration/unit test before implementing. NixOS service modules
  need a VM test. When unsure which bucket, treat as new behavior.
- **Otherwise** (docs, behavior-preserving refactors, cleanups): no
  test-first requirement.

Prefer simplicity — the boring obvious thing. Multi-path user-facing changes
get one e2e scenario per distinct path.

**Verify**: changes match the plan; behavior changes have covering tests.

### check

Run the `## Check command` from `.agency/do.md` (the cheapest gate — fail fast
before downstream steps work over broken code). No command documented → skip
with a note. **Verify**: clean, or none configured. **If failed** (max 3):
fix and re-run.

### docs

(`--minimal`: skip.) Compare the docs listed under `## Documentation` in
`.agency/do.md` against this PR's changes; fix what's stale (max 3 attempts).
None documented → skip with a note.

### fmt

Run the `## Format command` from `.agency/do.md`; none documented → skip with
a note.

### commit

(`--no-git`: skip.) Create a NEW commit (never amend) with a conventional
message and `git push -u origin <branch>`. This is the primary feature
commit — hickey+lowy and police add their own follow-up commits, keeping PR
history a readable progression. **Verify**: new commit exists and is pushed.

### hickey + lowy

(`--minimal`: skip.) Spawn `hickey` and `lowy` as two **parallel** sub-agents
(both `Agent` blocks in a single response). Invoking `/do` is authorization to
run them — don't wait for another prompt. If the harness can't honor a
reviewer's declared model, run it on the available model; if a sub-agent
invocation fails, retry once, then run that review in the main model by
loading the skill. **Fallback, never skip** — and never substitute an
informal review.

Brief each (self-contained — sub-agents inherit no context): the task prompt +
research findings, and the scope `git diff origin/HEAD...HEAD`. When the diff
**adds new files** (`git diff --diff-filter=A --name-only origin/HEAD...HEAD`
non-empty), add the **duplication-audit hint**: survey the codebase for the
canonical in-repo pattern for the same *kind* of operation and headline it if
the diff reinvents rather than extends. **Don't seed structural questions**
beyond that hint — pre-formed questions produce circular reasoning; if a
concern feels worth flagging, fix it in the diff instead (`RATIONALE.md`).

**No deferrals.** Findings have two dispositions: **Fix in this PR** and
**No-op** (narrow: the diff already deletes the code, or the finding is
subsumed verbatim by another). Anything a sub-agent phrases as deferred —
"out of scope", "follow-up", "pre-existing, separate PR" — flips to Fix in
this PR unconditionally; no follow-up issues, no outstanding-debt notes
(`RATIONALE.md`). A finding needing coordination outside the repo gets a local
workaround or interface boundary here, with the upstream dependency noted in
the PR description as strategy, not deferral.

**Cross-validate** (skip only when both reviewers returned zero findings):
each reviewer's fixes can create problems the *other* lens would catch. For
each reviewer with findings, spawn a second invocation of the *other* skill —
in parallel — with the diff plus the other reviewer's findings verbatim,
asking neutrally: "does any recommendation, if applied, create a problem your
lens would flag?" New findings are treated like first-pass findings.

**Apply each Fix finding as its own commit** (`refactor(hickey): <label>` /
`refactor(lowy): …`, finding restated in the body), staging only that fix's
files, pushing after each. (`--no-git`: apply to the working tree, no
commits.)

**Verify**: both reviews produced output; cross-validation ran or was
correctly skipped; every finding has a disposition and every Fix has a
commit; no deferrals.

### police

(`--minimal`: skip; docs-only diffs: skip with a note.) Invoke `/code-police`
(scope: current branch/PR). **Commit each violation fix individually** —
`fix(police): <rule-id> — <desc>`, `fix(police): fact-check — <desc>`,
`refactor(police): elegance — <desc>` — pushing after each; distinct elegance
refactors are separate commits. (`--no-git`: working tree only.)
**Verify**: all passes "All clear" (max 3 fix-and-re-invoke attempts).

### test

Run the `## Test command` from `.agency/do.md`, scoped to the changed code
paths (`git diff origin/HEAD...HEAD --name-only`). Purely-internal changes may
stop at unit tests; none documented → skip with a note.

**Coverage gap check**: a green run that never exercised the new behavior is a
gap, not a pass — write the missing test, then loop **fmt** → **commit** →
**test**. Refactor/docs diffs are exempt.

**If failed** (max 4): flaky → re-run; real → fix → **fmt** → retry.

### create-pr

(`--no-git` or non-GitHub forge: skip.) If no PR exists: load the `forge-pr`
skill **before** writing the title/body, then `gh pr create --draft`. Post the
hickey/lowy analysis as a PR comment — always when the step ran, even if all
No-op — with a leading findings ledger:

```md
## [Hickey/Lowy](https://kolu.dev/blog/hickey-lowy/) Analysis

| # | Lens   | Finding                                | Disposition      |
|---|--------|----------------------------------------|------------------|
| 1 | Hickey | viewportDimensions complects two roles | Fixed in this PR |
| 2 | Lowy   | clipboard.ts named after a consumer    | ⚠️ **No-op**     |

### Hickey rationale
<prose>

### Lowy rationale
<prose>
```

Dispositions mirror the sub-agents verbatim; render every No-op as
`⚠️ **No-op**` so the rows a human most needs to scrutinize stand out. Zero
findings → "No findings — analysis below". If a PR already exists (followup
runs), re-check title/body against current scope and `gh pr edit` per
`forge-pr`.

The PR opens before **ci** so checks land on it and a failed run leaves a
visible draft, not an orphaned branch.

### ci

Run the `## CI command` from `.agency/do.md` with `run_in_background: true`
(never pipe to `tail`/`head`, never append `2>&1`). Wrap background waits with
`scripts/do-results set active waiting` / `working`. CI commands are local and
forge-independent; only the verification method may be forge-specific (fall
back to exit code + output off GitHub).

**Verify** per `.agency/do.md` — and **the result must cover `HEAD`**: if a
commit landed after CI started, re-run against current HEAD.

**On failure**: flaky only if it passes on retry (max 3 retries); real bug →
fix → **fmt** → **commit** → retry (max 5; drop commit under `--no-git`).
Retries exhausted → status `"failed"`, skip to **done**; the draft PR stays
open as the record.

### evidence

(`--minimal`, `--no-git`, non-GitHub, or no `## PR evidence` section in
`.agency/do.md`: skip with the matching reason — absence of the section is the
default for projects that haven't opted in.)

Evidence is **visual** (screenshots, recordings; video when motion is the
point) *or* **behavioral** — and behavioral is easy to under-fire on:
persistence, restore, session, debounce, and reconnect fixes often have zero
visual diff, and the evidence that matters is "does the round-trip hold?".
**Bug fixes default to demonstrating the fixed behavior.** Read the trigger
broadly: the project section supplies the capture *mechanism*; fire on the
visual-or-behavioral criterion even if the section's wording leans visual.
Skip only when there is genuinely no behavior worth proving.

Spawn a `general-purpose` sub-agent with the section's literal content, the PR
context (URL, branch, base, SHA, changed files), and the instruction to return
one block of markdown (assets hosted per the section's mechanism). Post it
under `## Evidence` with `gh pr comment` using the single-quoted-heredoc
pattern from `forge-pr`. **Verify**: skipped per the rules, or the comment
exists.

### done

Summarize all steps. Retry any non-success step (max 3 from done).
`"completed"` requires all steps `passed`, except skips whose reason is
`"non-<forge> forge:"`, `"--no-git"`, `"--minimal"`, or
`"no PR evidence section in .agency/do.md"`. A `failed` step always blocks
completion — no redefining "passed". Update via
`scripts/do-results set status <completed|failed>`.

Run `scripts/steps/done` — it emits the timing table, total, slowest-step
line, and a `<<<FACTS` block. Don't compute durations yourself. From the FACTS
data, generate 2–4 optimization suggestions specific to this run (dominant
step, flaky retries, `--from` shortcuts).

Wrap-up: under `--no-git`, print the table + suggestions and list the modified
files, reminding the user the changes are uncommitted. On non-GitHub forges,
report the branch instead of a PR and post nothing. On GitHub, report the PR
URL and post the table (minus the FACTS block) as a PR comment headed
`## [\`/do\`](https://github.com/srid/agency) results`, with the suggestions.

## Entry Points

| ID               | Starts at       | Use case                          |
| ---------------- | --------------- | --------------------------------- |
| `default`        | **sync**        | Full workflow from scratch        |
| `followup`       | **implement**   | Additional changes on existing PR |
| `post-implement` | **fmt**         | Skip research/impl                |
| `polish`         | **hickey+lowy** | Structural review + quality gate  |
| `ci-only`        | **ci**          | Just run CI                       |

## Rules

- **Never skip steps** except via `--no-git` / `--minimal` / forge detection /
  the evidence opt-in. Run in order from entry point to **done**.
- **Every commit is NEW** — never amend, rebase, or force-push.
- **Feature branches only** — never commit to master/main.
- **Never stop between steps**; the task isn't done until a PR URL, pushed
  branch, or working-tree summary is reported.
- **Exhausted retries = halt**: status `"failed"`, skip to done, leave the
  draft PR untouched as the record.

ARGUMENTS: $ARGUMENTS
