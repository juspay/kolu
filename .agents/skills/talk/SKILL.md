---
name: talk
description: Enter talk mode — conversation and research, no repo changes. ONLY invoke when the user explicitly types `/talk` or `$talk`; never auto-select from a natural-language question or design discussion.
argument-hint: "[--no-laconic] [--html] <topic or question>"
---

# Probe (Talk Mode)

Have a conversation — discuss ideas, answer questions, explore approaches,
debate trade-offs. Be direct, opinionated, and concise. Talk mode ends when
the user invokes an action skill (e.g. `do`); if asked to implement, discuss
the approach and point at `do` — after doing the research that grounds the
discussion.

## Rules

- **No repo mutation.** No `Edit`/`Write`/`NotebookEdit` on workspace files,
  no file-mutating Bash, no `git commit`/`push`/`add`/`rm`. (Sole exception:
  the single artifact `--html` mode writes.)
- Reading, read-only shell, web search, and Explore subagents are all fair
  game. Scratch clones of *external* repos in `/tmp/<name>` are allowed for
  research — ephemeral, never a venue for user-requested changes.
- `AskUserQuestion` is for genuine ambiguity or design collaboration — never
  to ask permission to research ("want me to check X?"). If tempted to ask,
  do the research and report. The symmetric vice: closing with "you should
  grep for other X" — if a follow-up is worth surfacing, do it before
  responding.

## Research before answering — MANDATORY

Talk mode is research-first. Before any technical opinion, recommendation, or
claim about how something works — even one you think you know — investigate
the relevant code, configs, and (for external libraries) their actual source
at the installed version. Confident-sounding hallucination is the worst
failure of this mode.

- **First-turn gate**: the first substantive response contains no
  recommendations, fixes, or library-behavior claims unless the **main
  agent** read the relevant source this session. Otherwise the first response
  *is* the research — typically one `Explore` call, then main-agent `Read`s of
  the surfaced paths.
- **Explore output is a lead, not ground truth.** Subagents hallucinate
  file:line references; their job is to *find* candidates, the main agent's
  job is to *open* them. A claim resting on a path you didn't open is marked
  `[unverified, per subagent]` — never laundered into a confident statement.
- **Citation requirement**: every non-trivial claim carries a `file:line` the
  main agent opened this session. Claims about third-party behavior need
  citations **inside that library's source** (installed package or a scratch
  clone at the right version) — a cite in your own project proves nothing
  about what the library call does. No citation → go read, or label the claim
  a guess. If the user challenges provenance ("did you actually read this?"),
  re-emit prior claims tagged ✓verified-this-turn / ✗unverified before
  continuing.
- **Hedge words are a stop signal.** "Probably", "I suspect", "should be",
  "my #1 suspect" about a technical claim mean the work isn't done: replace
  the hedge with a citation, or label the whole claim "Guess, haven't
  verified".

## Phased delivery for feature work

For user-visible feature work large enough that an unphased PR would pain a
reviewer, propose phases where **each phase is independently useful when
merged** — any prefix is shippable; if phase 1 alone delivers no real value,
the split is wrong. The trigger is reviewer pain, not abstract complexity.
Refactors, scaffolding, and bug fixes don't get phased. Use `AskUserQuestion`
to collaborate on the cut (what does phase 1 give? what does deferring phase 3
cost?) before the user invokes `do`.

## Auto-review (Lowy + Hickey)

Whenever the conversation produces a concrete code plan, diff proposal, or
implementable design sketch, invoke `lowy` and `hickey` as **parallel
sub-agents** (`Agent(subagent_type=…)`, not the Skill tool) before presenting —
unprompted. **The deliverable is the post-review proposal**: revise the design
where findings land (don't append critique to an unchanged sketch), and say
briefly why rejected findings didn't land. In hickey's prompt, instruct it to
land specific complecting/fragmentation risks in *this* sketch or say there's
nothing to bite into — generic principles are not findings.

**Duplication audit**: when the sketch proposes a new top-level abstraction,
tell each reviewer to first survey for the canonical in-repo pattern solving
the same *kind* of operation — reinvention is the headline finding. Skip the
audit for refactors/fixes introducing no new abstraction.

Skip both passes only for pure Q&A with no proposed change; when in doubt,
run them. `do` re-runs the pair post-implement on the real diff — this is the
design-level rehearsal. Model selection lives in the reviewer skills'
frontmatter; pass no `model:` override.

## Laconic mode (default)

On unless `--no-laconic` leads the arguments. One or two sentences when they
do; a single word when *that* does. No preamble, recaps, or closing offers; no
bullet lists unless the answer is a list; code blocks only when code is the
answer. Keep file:line citations — laconic trims the *output*, never the
*investigation*.

## HTML artifact mode (`--html`)

Respond by writing one self-contained `.html` file and print only its path —
the HTML is the response. Built to pair with a runner that renders the file
and lets the user select text to queue comments ([kolu#922](https://github.com/juspay/kolu/pull/922)).

- **Location**: `docs/plans/` if it already exists (never create it), else the
  repo root. **Filename**: stable per session — `talk-<slug>.html` (or
  `talk.html`); follow-up turns update the **same** file.
- **Contents**: self-contained — embedded `<style>`, no external assets, no
  JS. Same citation rules as text mode. For UI topics, embed *rendered*
  HTML/CSS prototypes of the proposed components (not ASCII art, not prose) —
  representative layout and hierarchy the user can react to.
- Writing that one file is the only mutation `--html` permits.
- **Follow-up loop**: when the user replies with comments, re-emit the full
  revised HTML and print the path again — the artifact is the reply, don't
  narrate the diff in chat.
- Reviewer findings (lowy/hickey) fold into the HTML **before** printing the
  path; laconic trims its prose the same as text mode (`--html` picks the
  medium, `--no-laconic` the verbosity — prototype markup is substance, not
  filler).

ARGUMENTS: $ARGUMENTS
