# Why the workflow is shaped this way

Background for anyone *editing* `SKILL.md`. A run doesn't need this file — the
steps are self-contained.

## Why hickey + lowy run post-implement, not pre-implement

**Why post-implement, not pre-implement.** Hickey's complecting critique and Lowy's volatility lens both bite harder on a concrete diff than on a plan sketch. Reviewing a plan tends to surface generic concerns; reviewing a real diff surfaces the specific interleavings and boundary misalignments that matter. Running here also means the review covers *everything* the diff contains — including whatever the plan glossed over and whatever drifted during implementation.

## Why the reviewer prompt must not seed structural questions

**Do not seed structural questions.** The implementer's prompt must NOT include pre-formed questions like _"Is module X the right home for function Y?"_, _"Does the new field complect concerns A and B?"_, or _"Should constructor C be a sum?"_ — that framing shopping-lists the answer and produces circular reasoning at the reviewer (e.g. "primary consumer of `logPathFor` is `CommitStatus`" — true only because the implementer placed it there). Hickey and Lowy each have their own methodologies for generating findings; the reviewer reads the diff cold and surfaces what its lens shows. Anything beyond "here's the diff and the change rationale" is implementer bias bleeding into the review. If a specific concern feels worth flagging to the reviewer, that's evidence the implementer already smelled the problem — fix it in the diff before sending it to review, not by routing the question through a sub-agent for permission.

The **duplication-audit hint** above is the one allowed exception: it's a meta-process reminder (run the survey your skill describes), not a seeded finding about *this* diff. It points the reviewer at the codebase, not at a specific concern within the diff — that's the line. If the diff doesn't add new files, drop the hint and let the lens run unprimed.

## Why model selection lives in the reviewer skill

**Model selection lives in the skill, not here.** Both `hickey/SKILL.md` and `lowy/SKILL.md` declare `model: sonnet` in their frontmatter — Claude Code honors this and runs the review on Sonnet to keep the per-task cost cheap; opencode/Codex ignore the field (it isn't part of the Agent Skills standard) and fall through to the active model, which is the right behavior for harnesses that don't have Sonnet. Don't pass `model:` at the `Agent` tool level — the skill frontmatter is the single source of truth.

## Why there is no Defer disposition

**No deferrals.** The hickey and lowy skills emit two dispositions: **Fix in this PR** and **No-op**. There is no Defer. `/do` is not optimizing for minimal diff — it is optimizing for the simpler artifact landing in `master`. A PR that grows from 50 lines to 400 because hickey caught a real fragmentation bug is a *better* PR, not a worse one; the alternative is shipping the complected version and trusting a "broader refactor" follow-up that statistically never happens.
