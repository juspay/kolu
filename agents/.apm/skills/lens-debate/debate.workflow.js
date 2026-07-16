// The Workflow runtime requires `export const meta` to be the FIRST statement
// and a PURE LITERAL (no variable interpolation), so the primary model is
// inlined as 'opus' in the phase entries below. The only Apply-phase agent is a
// single `apply:all` on `model` (Opus) that implements and commits each agreed
// fix in-session. Those inlined 'opus' phase entries plus the `const MODEL` /
// `const MATCH_MODEL` sockets just after meta are the model bindings — every
// other model reference in this script reads its socket lazily at
// input-resolution time, well after meta is evaluated.
export const meta = {
  name: 'lens-debate',
  description:
    'lowy + hickey review a diff independently in parallel, reconcile the overlap without debate, then debate only the genuinely contested findings in parallel per-file threads; apply the agreed fixes',
  phases: [
    { title: 'Review', detail: 'lowy and hickey (and optionally code-police) review the diff independently, in parallel', model: 'opus' },
    { title: 'Reconcile', detail: 'auto-settle cross-lens agreements (matcher), auto-settle unopposed minors, extract per-finding hunks, run each lens’s batched objection check on the other’s solo findings' },
    { title: 'Debate', detail: 'contested findings debate in parallel per-file threads, each a scoped lowy ⇄ hickey exchange to per-finding consensus', model: 'opus' },
    { title: 'Apply', detail: 'implement each agreed fix as its own commit (skipped under apply:false)', model: 'opus' },
  ],
}

// The model every lens voice runs on. SKILL.md flags this as load-bearing
// (lenses run on Opus, overriding their `model: sonnet` frontmatter) and model
// migrations are a recurring change — keep it to one socket. Inlined into the
// phase entries above (meta must be a pure literal); the `model` input below
// defaults to it. The objection check is a lens VOICE making a settle decision,
// so it runs on this socket too — the speed win comes from batching + scoped
// context, never from downgrading a lens judgment.
const MODEL = 'opus'
// The reconciliation matcher's model. Matching two finding lists is semantic
// (same underlying issue?) but bounded, and the matcher is instructed to be
// conservative — an unmatched pair merely falls through to the (cheap, safe)
// objection check, while a FALSE pair would silently settle a debate that
// should have happened. Sonnet is the competence/cost point for that: Opus
// would spend more than the debate turns it deletes on small diffs; Haiku
// false-pairs. Not an input — a binding, like MODEL.
const MATCH_MODEL = 'sonnet'

// ---------------------------------------------------------------------------
// Inputs (passed via the Workflow tool's `args`)
// ---------------------------------------------------------------------------
// The harness JSON-ENCODES `args` before the workflow sees it, so it arrives as a
// STRING even when the caller passed a real object; a bare `args.repoPath` would then
// be `undefined` and every input (repoPath/base/rationale/…) silently default. That's
// the cross-repo bug: `repoPath` degrades to `.` (the cwd), the lenses review the
// WRONG repo and the apply phase commits onto it. Parse a stringified `args`
// defensively (empty string → {}; object used as-is; malformed JSON throws loudly,
// fail-fast). The cross-repo failure this guards against is documented in
// be-review/SKILL.md (Preflight → "Pin repoPath").
const a = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : args || {}
const repoPath = a.repoPath || '.'
// The diff base. Resolved to the MERGE-BASE of (rawBase, HEAD) just below, before
// DIFF is built, so the lenses review only what THIS branch changed — not commits
// the base branch gained since the branch forked (those would otherwise appear in
// `git diff base` as the base branch's drift, reviewed as ours). `let` because the
// resolution reassigns it. Idempotent when the caller already passed a merge-base
// SHA (e.g. /be-review).
let base = a.base || 'origin/master'
// Safety backstop only — NOT a deadlock cap, now applied PER THREAD. A thread
// runs until consensus; this just keeps a pathologically oscillating thread from
// running unbounded. Hitting it is reported as `unresolved` (needs human), never
// `deadlock`, and should essentially never happen between two good-faith lenses.
// Raise freely. (The escalation valve is separate and softer: a thread passing 3
// rounds keeps debating but is surfaced in `escalations` — see runThread.)
const maxRounds = a.maxRounds || 12
// Apply agreed `fix` findings as individual commits (default on). `--no-commit`
// still applies the edits to the working tree, it just leaves them uncommitted.
// No-op when `apply` is false — the apply:false path returns plans in `fixes`
// and never commits; `commit` only gates the in-workflow Apply phase.
const commit = a.commit !== false
// Run the Apply phase at all (default on). `apply: false` skips the Apply phase
// entirely: the debate still settles every finding, but the agreed `fix` plans
// are RETURNED (the `fixes` field) instead of implemented — for callers that
// want the agreed fix plans returned so they can apply them against a tree of
// their choosing.
const apply = a.apply !== false
// Fold in /code-police as a third, lower-weight voice: it SEEDS findings into
// the debate set but does not get a vote in consensus (only lowy ⇄ hickey do).
const withPolice = a.withPolice === true
// Optional author note on deliberate design decisions, so the lenses don't flag
// intentional choices (e.g. a deliberate fail-open). Threaded into every prompt.
const rationale = (a.rationale || '').trim()
// Model every lens/agent runs on; defaults to MODEL (see top of file). Overridable
// via args to mirror the file's input pattern and to make a model bump a one-liner.
const model = a.model || MODEL
// Mechanical tier (Haiku). The lenses' reviews + objection checks + the
// per-thread debate + applying an agreed fix all do real reasoning → `model`
// (Opus, load-bearing for the lenses). The merge-base resolver and the hunk
// extractor are mechanical git/text work → `mechModel`.
// Defaults match a direct invocation; /be-review passes it.
const mechModel = a.mechModel || 'haiku'
// Per-worktree scratch for commit-message files; gitignored so it never shows up
// in the diff the lenses review, and parallel debates in different worktrees
// never collide. Only the commit-message files land here.
const workDir = `${repoPath}/.lens-debate`

// Löwy's "electricity" probe — a sharper version of the SAME volatility lens, NOT
// a second voting voice (a separate lens would double-count lowy and reintroduce
// the up-front framing bias this skill avoids). It forces the abstract "where's
// the boundary?" down to the concrete "what plugs into what?", which is exactly
// the abstraction-without-grounding failure mode a lens debate is otherwise prone
// to. Earned its keep on a live run (#1111). Baked into the lowy reviewer's output.
const ELECTRICITY_PROBE = `As a REQUIRED part of your output, apply Löwy's electricity test (Righting Software / The Method) to ground the boundary question in "what plugs into what": name the **receptacle** (the stable interface every consumer plugs into), name the **volatile implementations** that receptacle encapsulates (the interchangeable generators behind it), say whether this is "electricity" (a domain-agnostic utility) or an application concern, and call out where a consumer is forced to "expose the wires" — reach past the receptacle and depend on a specific implementation. If the diff has no such boundary, say so explicitly; do not invent one.`

// The two structural lenses that debate to consensus. code-police, when enabled,
// is appended as a finding SOURCE only — it is not a debater.
const DEBATERS = ['lowy', 'hickey']
const REVIEWERS = [
  { lens: 'lowy', framework: 'volatility-based decomposition — do boundaries encapsulate axes of change? (Lowy / Parnas)', probe: ELECTRICITY_PROBE },
  { lens: 'hickey', framework: 'structural simplicity — independent concerns complected, or one thing fragmented? (Simple Made Easy)' },
]
if (withPolice) REVIEWERS.push({ lens: 'code-police', framework: 'code quality, correctness, and common-mistake review' })

// The result shape's empty collections, shared by the two EARLY returns
// (merge-base-error, clean) so adding a result field is one edit, not a mirror
// edit per return site. The final return carries real values and stays literal.
const EMPTY_RESULT = { settled: [], unresolved: [], applied: [], applyGaps: [], fixes: [], reviews: {}, history: [], escalations: [] }

// Per-stage agent-call counts, returned as `turns` — the benchmarkable measure
// of how much work a run spent (the old engine's cost was 2 × rounds full-diff
// debate turns; the point of the reconcile/thread shape is to shrink exactly
// this). Incremented at each agent() call site.
const turns = { mech: 0, review: 0, match: 0, objection: 0, debate: 0, apply: 0 }

// Resolve the diff base to the merge-base of (base, HEAD) BEFORE building DIFF
// (which interpolates `base` eagerly), so the lenses review only what this branch
// changed, not the base branch's drift since the fork. A thin mechanical git
// agent (the workflow can't run git itself); grouped under the Review phase.
// Idempotent when `base` is already a merge-base SHA (caller resolved it).
const rawBase = base
turns.mech++
const baseRes = await agent(
  `You are a MECHANICAL RUNNER. Run \`git -C ${repoPath} merge-base ${base} HEAD\` and return ONLY the resulting commit SHA (hex) in \`sha\`. If the command FAILS (missing/typoed base, stale ref, unrelated history), return \`sha\`: "" and put the verbatim git error in \`error\` — do NOT fall back to the raw base ref. Do nothing else.`,
  { label: 'resolve:merge-base', phase: 'Review', model: mechModel, schema: { type: 'object', additionalProperties: false, required: ['sha'], properties: { sha: { type: 'string', description: 'the merge-base SHA, or "" on failure' }, error: { type: 'string', description: 'the git error when sha is empty' } } } },
)
// Fail loud on a bad base. Falling back to the raw `${base}` tip would make the
// lenses review the base branch's drift since the fork as if this change made it —
// the exact noise the merge-base removes — so a missing/typoed/stale base aborts.
if (!baseRes?.sha?.trim()) {
  const err = (baseRes?.error || '').trim()
  log(`Aborting: \`git merge-base ${rawBase} HEAD\` failed; the diff scope can't be trusted. Not falling back to the raw ${rawBase} tip.`)
  return {
    ...EMPTY_RESULT,
    status: 'merge-base-error',
    base: rawBase,
    rounds: 0,
    withPolice,
    turns,
    note: `merge-base of \`${rawBase}\` and HEAD could not be resolved (missing/typoed base, stale ref, or unrelated history), so the review scope is untrustworthy. Fix the base ref (e.g. \`git fetch\`) and re-run.${err ? `\ngit error:\n${err}` : ''}`,
  }
}
base = baseRes.sha.trim()

// How every REVIEW agent is told to inspect the change. The lenses do NOT trust
// a curated finding list — they read the source themselves (the load-bearing
// lesson from #1109: curation biases the verdict). This full-diff read is
// load-bearing HERE, in the independent reviews, and only here: reconcile-phase
// and debate-phase turns receive pre-extracted hunks instead (scoped context),
// because by then both lenses have already read the whole change once.
const DIFF = `Inspect the FULL change in the repo at \`${repoPath}\` — your shell cwd may be a DIFFERENT worktree, so use \`git -C ${repoPath}\` and ABSOLUTE paths under \`${repoPath}\`: run \`git -C ${repoPath} diff ${base}\` (committed + unstaged) and \`git -C ${repoPath} status --short\` (untracked/new files do NOT appear in the diff), then Read every new/changed file plus enough surrounding code to judge it in context. Ignore the debate's own scratch dir \`.lens-debate/\` if it appears.`

// How every SCOPED agent (objection check, thread debate turn) gets its code
// context: the pre-extracted hunks are inlined in the prompt, and the agent may
// Read specific files for surroundings — but must NOT re-read the full diff.
const scopedContextNote = `This is a SCOPED turn: the relevant diff hunks are inlined below. Do NOT re-read the full diff (the independent reviews already did that once each — repeating it here is pure cost); when the inlined context is insufficient, Read the SPECIFIC file(s) involved, as ABSOLUTE paths under \`${repoPath}\`.`

const rationaleBlock = rationale ? `\nAuthor's note on deliberate decisions (do not flag these as defects unless the reasoning is itself wrong):\n${rationale}\n` : ''

// ---------------------------------------------------------------------------
// Schemas — review, match, hunk-extraction, objection, debate position, apply
// ---------------------------------------------------------------------------
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      description: 'ALL your independent structural findings — every issue worth raising through your lens, no cap. An empty list is fine only for a genuinely clean diff.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'location', 'problem', 'suggestion', 'disposition', 'severity'],
        properties: {
          title: { type: 'string' },
          location: { type: 'string', description: 'file:line' },
          problem: { type: 'string', description: "the problem in your lens's terms" },
          suggestion: { type: 'string', description: 'a concrete, implementable change — precise enough to be applied verbatim if the other lens simply agrees' },
          disposition: { type: 'string', enum: ['fix', 'drop'], description: 'fix = worth changing in THIS PR; drop = observation only' },
          severity: { type: 'string', enum: ['minor', 'major'], description: 'minor = local polish whose worst-case cost is small (a name, a comment, a small duplication); major = structural, correctness-adjacent, or anything whose wrongness would spread' },
        },
      },
    },
  },
}

const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      description: 'pairs of findings (one lowy id, one hickey id) that describe the SAME underlying issue. Output ONLY genuine pairs; never force a match.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['a', 'b', 'compatible', 'reason'],
        properties: {
          a: { type: 'string', description: 'the lowy finding id' },
          b: { type: 'string', description: 'the hickey finding id' },
          compatible: { type: 'boolean', description: 'true only if the dispositions are equal AND, for fix/fix, the two suggestions are the same change in substance' },
          plan: { type: 'string', description: 'REQUIRED when compatible fix/fix: the canonical plan — copy the more concrete suggestion verbatim; merge only when each has a detail the other lacks' },
          reason: { type: 'string', description: 'why these are the same issue, and why compatible/incompatible' },
        },
      },
    },
  },
}

const HUNKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hunks'],
  properties: {
    hunks: {
      type: 'array',
      description: 'one entry for EVERY finding id you were given, in the same order',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'excerpt'],
        properties: {
          id: { type: 'string' },
          excerpt: { type: 'string', description: 'the relevant diff hunk(s) plus ~20 surrounding lines of the current file; "" only when the location matches nothing' },
        },
      },
    },
  },
}

const OBJECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['checks'],
  properties: {
    checks: {
      type: 'array',
      description: 'one entry for EVERY finding id you were given',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'objects', 'reasoning'],
        properties: {
          id: { type: 'string' },
          objects: { type: 'boolean', description: 'false = settle it exactly as raised; true = this needs a debate' },
          disposition: { type: 'string', enum: ['fix', 'drop'], description: 'when objecting: YOUR disposition' },
          plan: { type: 'string', description: 'when objecting with fix: your concrete, implementable change' },
          reasoning: { type: 'string', description: 'argue from the code (cite file:line)' },
        },
      },
    },
  },
}

const POSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['positions'],
  properties: {
    positions: {
      type: 'array',
      description: 'one entry for EVERY contested finding id you were given',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'disposition', 'reasoning'],
        properties: {
          id: { type: 'string' },
          disposition: { type: 'string', enum: ['fix', 'drop'] },
          plan: { type: 'string', description: 'if fix: the exact change, implementable' },
          agreesWithPlan: {
            type: 'boolean',
            description:
              "when disposition===fix, true only if you endorse the other lens's plan as-is; if false, your `plan` field is the amendment that must still converge",
          },
          reasoning: { type: 'string', description: 'argue from the code (cite file:line); concede explicitly when the other lens is right' },
        },
      },
    },
  },
}

// One Apply agent implements every agreed fix and commits each in a single
// session, so it returns the full per-fix outcome (not one impl per agent). One
// entry per fix it was handed; `commit` is "" under `--no-commit` or when a fix
// turned out to need no change.
const APPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['applied'],
  properties: {
    applied: {
      type: 'array',
      description: 'one entry for EVERY agreed fix you were given, in the same order',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'summary', 'filesChanged'],
        properties: {
          id: { type: 'string' },
          summary: { type: 'string', description: 'one line: what you changed for this fix' },
          filesChanged: { type: 'array', items: { type: 'string' } },
          commit: { type: 'string', description: 'this fix\'s commit SHA, or "" if nothing was committed' },
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
function reviewBrief(lens, framework, probe) {
  const probeBlock = probe ? `\n${probe}\n` : ''
  return `You are the **${lens}** reviewer. First Read \`.claude/skills/${lens}/SKILL.md\` for your framework, then ${DIFF}

Review the change through the **${framework}** lens, INDEPENDENTLY — you are NOT seeing any other reviewer's findings. That independence is the whole point: being handed someone else's curated finding biases the verdict.
${rationaleBlock}${probeBlock}
Give ALL your findings — every structural issue you see through your lens, no cap, at every level (boundary, complecting, naming, duplication, …). Each: a title, a file:line location, the problem in your lens's terms, a concrete suggestion, a disposition — \`fix\` (worth changing in THIS PR) or \`drop\` (observation only) — and a severity — \`minor\` (local polish whose worst-case cost is small) or \`major\` (structural, correctness-adjacent, or anything whose wrongness would spread). Write the suggestion precisely enough to be applied verbatim: if the other lens independently agrees, it becomes the plan with no further debate. Don't fabricate issues, but don't hold any back either; an empty list is fine only for a genuinely clean diff.`
}

function findingLine(f) {
  return `### ${f.id} (raised by ${f.origin}) — ${f.title}\n  at ${f.location}; raiser's disposition: ${f.disposition} (severity: ${f.severity})\n  problem: ${f.problem}\n  suggestion: ${f.suggestion}`
}

function matchBrief(lowyFindings, hickeyFindings) {
  return `You are a conservative MATCHER reconciling two independent structural reviews of the same diff. Below are lowy's findings and hickey's findings (JSON). Identify every pair — one lowy finding, one hickey finding — that describes the SAME underlying issue: the same root concern at the same code location, not merely the same file or theme.

For each pair, judge compatibility: \`compatible\` is true only if the two dispositions are EQUAL and, when both are \`fix\`, the two suggestions are the same change in substance (modulo wording). For a compatible fix/fix pair you MUST output \`plan\`: copy the more concrete suggestion verbatim; merge only when each has a detail the other lacks. A pair with differing dispositions, or fix/fix with genuinely different changes, is still a valid pair — output it with \`compatible\`: false (it will be debated).

**When unsure whether two findings are the same issue, do NOT pair them.** An unmatched finding merely gets a cheap objection check — safe. A FALSE pair silently settles a debate that should have happened — not safe. Use each id at most once.

lowy's findings:
${JSON.stringify(lowyFindings, null, 2)}

hickey's findings:
${JSON.stringify(hickeyFindings, null, 2)}`
}

function hunksBrief(items) {
  const list = items.map((it) => `- ${it.id}: ${it.location}`).join('\n')
  return `You are a MECHANICAL EXTRACTOR. For each finding below, extract the code context a reviewer needs: run \`git -C ${repoPath} diff ${base} -- <file>\` and take the hunk(s) overlapping the finding's location, then append ~20 surrounding lines of the CURRENT file around the cited line(s) (use \`git -C ${repoPath} show\` or Read with absolute paths under \`${repoPath}\`). Keep each excerpt under ~150 lines — the hunks plus immediate surroundings, no whole files. If a location matches nothing in the diff (e.g. a new untracked file), excerpt the current file around the cited lines instead; return "" only when the location matches nothing at all.

Findings:
${list}

Return one \`hunks\` entry per finding id, same order. Do nothing else — no review, no opinions.`
}

function objectionBrief(lens, opp, items) {
  const blocks = items
    .map((it) => `${findingLine(it.f)}\n\nRelevant hunks:\n\`\`\`\n${it.excerpt}\n\`\`\``)
    .join('\n\n')
  return `You are **${lens}**, running a fast OBJECTION CHECK on findings **${opp}** raised that you did not independently raise. First Read \`.claude/skills/${lens}/SKILL.md\` for your framework. ${scopedContextNote}
${rationaleBlock}
For each finding below: if, through your framework, you have NO substantive objection to settling it exactly as raised (its disposition, and for a fix its suggestion as the plan), return \`objects\`: false — silence is agreement here, and the finding settles with zero debate. Object (\`objects\`: true) ONLY when the disposition or the plan is wrong enough to be worth a full cross-examination — an objection reopens the finding into a debate thread, so don't object to relitigate taste. When objecting, give YOUR disposition (and a concrete plan if \`fix\`) and reasoning grounded in the code.

${blocks}

Return one \`checks\` entry per finding id.`
}

function contestedLine(item) {
  const pairNote = item.pairId ? ` (≡ ${item.pairId} — both lenses raised this issue independently)` : ''
  return `### ${item.id}${pairNote} — ${item.f.title}\n  at ${item.f.location}; raised by ${item.f.origin} as ${item.f.disposition} (severity: ${item.f.severity})\n  problem: ${item.f.problem}\n  suggestion: ${item.f.suggestion}${item.pairF ? `\n  ${item.pairF.origin}'s framing — ${item.pairF.title}: ${item.pairF.problem}\n  ${item.pairF.origin}'s suggestion: ${item.pairF.suggestion}` : ''}\n\nRelevant hunks:\n\`\`\`\n${item.excerpt}\n\`\`\``
}

function threadTurnBrief(lens, opp, file, activeItems, oppPos, settledList, roundNum) {
  const settledNote = settledList.length
    ? `\nALREADY SETTLED in this thread (you both agreed — do NOT relitigate, shown for context only):\n${settledList.map((s) => `- ${s.id}: ${s.disposition}`).join('\n')}\n`
    : ''
  const oppBlock = oppPos
    ? `**${opp}'s positions to rebut or concede, point by point:**\n${JSON.stringify(oppPos, null, 2)}\n\nFor each finding you also call \`fix\`, set \`agreesWithPlan\`: true only if you endorse ${opp}'s \`plan\` as-is. If false, your \`plan\` field is the amended plan that must still converge — the finding stays open another round until the plans agree, just like the disposition.`
    : `Round 1 — give your initial disposition on every contested finding below.`
  return `You are **${lens}**, cross-examining **${opp}** to reach agreement on the contested findings below, all in \`${file}\`. First Read \`.claude/skills/${lens}/SKILL.md\` for your framework. ${scopedContextNote} Ground every call in the source.
${rationaleBlock}
CONTESTED findings — disposition EVERY one:
${activeItems.map(contestedLine).join('\n\n')}
${settledNote}
${oppBlock}

Round ${roundNum}. For EVERY contested finding id above, output a disposition (\`fix\` = worth changing in THIS PR / \`drop\` = leave as-is, observation only), a concrete implementable plan if \`fix\`, and reasoning grounded in the code. **The goal is the correct answer for THIS PR, not winning** — concede explicitly ("conceding: …") when ${opp}'s code-grounded argument is right. A \`fix\` is worth it only if it genuinely improves the PR.`
}

// ONE brief for ALL agreed fixes — implemented and committed in a single Apply
// session, so the agent orients on the repo once instead of paying that cost per
// fix (the old form spawned an implement agent AND a commit agent per finding,
// serially). The fixes are independent and their plans already converged in the
// debate, so there's no cross-fix reasoning to isolate; what we keep is one
// commit PER finding so the history still reads finding-by-finding.
function applyAllBrief(fixes, doCommit) {
  const list = fixes
    .map(
      (f) => `### ${f.id} (raised by ${f.origin}) — ${f.title}
  at ${f.location}
  problem: ${f.problem}
  original suggestion (context, not the agreed plan): ${f.suggestion}
  agreed plan: ${f.plan}`,
    )
    .join('\n\n')
  const commitStep = doCommit
    ? `After a fix's edits are done, COMMIT that fix on its own before moving to the next, so each finding maps to one commit and the history reads finding-by-finding. Stage ONLY the files you changed for that fix — never \`git add -A\` or \`git add .\`. Write the message to a file under \`${workDir}\` (run \`mkdir -p ${workDir}\` first) and commit with \`git -C ${repoPath} add -- <files> && git -C ${repoPath} commit -F <msgfile>\`, using EXACTLY this message shape:

  fix(lens): <the fix's title>

  <your one-line summary of the change>

  Agreed by the lowy ⇄ hickey lens debate (finding <id>, raised by <origin>). Not pushed or merged.

Do NOT push. Record each fix's resulting commit SHA (\`git -C ${repoPath} rev-parse HEAD\`) in its \`commit\` field. If a fix turns out to need no change, leave its \`filesChanged\` empty and its \`commit\` "".`
    : `Do NOT git add / commit / push — leave every change in the working tree and set each fix's \`commit\` to "".`
  return `You are implementing the changes that two structural-review lenses (lowy and hickey) independently agreed should be fixed in THIS PR. Work in the repo at \`${repoPath}\` — your shell cwd may be a DIFFERENT worktree, so every file you Read/Edit MUST be an ABSOLUTE path under \`${repoPath}\` and every git command MUST use \`git -C ${repoPath}\`.

Apply each agreed fix below, IN ORDER. The fixes are independent — keep each one tightly scoped to its finding and don't let one bleed into another. Read the surrounding code first so each edit fits the existing style. You may run the project's formatter on files you touched.

${list}

${commitStep}

Return one \`applied\` entry per fix (same order): its id, a one-line summary, the exact files you changed, and the commit SHA (or "").`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const posMap = (res) => Object.fromEntries((res?.positions ?? []).map((p) => [p.id, p]))
// The file a finding anchors to — the grouping key for threads and for the
// real-only rule. Region = file: deterministic, and matches how reviewers cite
// locations ("file:line"). A vaguer location ("multiple files") groups under its
// own raw string, which is correct — nothing else shares that region.
const fileOf = (location) => (location || '').split(':')[0].trim()

// Render the PR comment deterministically from the debate outcome, returned as a
// string so the ORCHESTRATOR posts it verbatim (`gh pr comment -F`) — no agent
// re-improvises a table. Unlike codex-debate there are NO per-round files to
// assemble: the lenses don't read a ledger (feeding them prior reasoning would
// invite entrenchment against conceding), so the comment is the only artifact.
//
// The header chrome (the `## ` title, the badge, the `base.slice(0, 12)`) is
// deliberately kept STRUCTURALLY PARALLEL to codex-debate's ledgerHeader chrome.
// The no-module workflow runtime has no imports, so a truly shared renderer isn't
// available; the two are instead siblings that move together. A house-style change
// (badge emoji, base-slice length, a new metadata row) is a mechanical mirror edit
// — make it here and in codex-debate's ledgerHeader. If the runtime ever admits a
// shared helper file, lift this common chrome there.
// `outcome` is the single mode bit for what happened to the agreed fixes:
// { kind: 'applied', items } when this run implemented them, or
// { kind: 'handed-off', items } when apply:false returned the plans to the
// caller — one param, so "at most one of applied/handed-off" holds by
// construction instead of by convention.
// `applyGaps` (agreed fixes the Apply phase did not cleanly land) is rendered
// HERE, not just in the machine `status`: the SKILL posts this comment verbatim,
// so an apply-incomplete run must surface a warning badge and a dedicated gap
// section instead of advertising `✅ Consensus` and listing the gapped fix as
// `Applied`. Keep this consistent with the status downgrade in the Apply phase.
function renderComment({ rounds, settledOut, unresolved, outcome, reviewByLens, withPolice, base, clean, applyGaps = [], escalations = [] }) {
  const gapIds = new Set(applyGaps.map((g) => g.id))
  const badge = applyGaps.length
    ? `⚠️ **Apply incomplete** — ${applyGaps.length} agreed fix(es) not cleanly applied`
    : clean
      ? '✅ **Clean** — every lens found nothing worth raising'
      : unresolved.length === 0
        ? '✅ **Consensus**'
        : `⚠️ **${unresolved.length} unresolved**`
  const counts = Object.entries(reviewByLens)
    .map(([lens, fs]) => `${lens}=${fs.length}`)
    .join(', ')
  // A clean diff never debated, so the rounds clause is omitted; the base, the
  // lens roster, and the (all-zero) per-lens counts still ride along so the
  // comment carries the same audit metadata as a debated run. A debated run says
  // how deep the deepest thread went — 0 means everything settled at
  // reconciliation, with zero debate turns.
  const meta = `lowy + hickey${withPolice ? ' + code-police' : ''} · base \`${(base || '').slice(0, 12)}\``
  const roundsClause = rounds === 0 ? 'with zero debate turns' : `after ${rounds} thread-round(s)`
  const lines = [
    '## [⚖️ Lowy ⇄ Hickey lens debate](https://kolu.dev/blog/hickey-lowy/)',
    '',
    clean ? `${badge} · ${meta}` : `${badge} ${roundsClause} · ${meta}`,
    '',
    `Independent findings: ${counts}`,
  ]
  if (!clean) {
    // How each finding settled — the audit line for the reconcile shape. Pairs
    // count once (they settle as one issue).
    const nonDup = settledOut.filter((s) => !s.duplicateOf)
    const viaCount = (via) => nonDup.filter((s) => s.agreed && s.via === via).length
    const parts = []
    const reconciled = viaCount('reconciled')
    const autoMinor = viaCount('auto-minor')
    const unopposed = viaCount('no-objection') + viaCount('objection-agreed')
    const debated = viaCount('debated')
    if (reconciled) parts.push(`${reconciled} reconciled (raised by both lenses)`)
    if (autoMinor) parts.push(`${autoMinor} auto-settled minor`)
    if (unopposed) parts.push(`${unopposed} unopposed`)
    if (debated) parts.push(`${debated} debated`)
    if (parts.length) lines.push(`Settled: ${parts.join(' · ')}`)
  }
  const pairTag = (s) => (s.pairedWith ? ` ≡ \`${s.pairedWith}\`` : '')
  const drops = settledOut.filter((s) => s.agreed && s.disposition === 'drop' && !s.duplicateOf)
  if (outcome.kind === 'applied') {
    // Only CLEANLY-landed fixes go under `Applied`; a fix in `applyGaps` (missing
    // from the apply output, or changed-but-uncommitted) is NOT applied work and
    // must not be advertised as such under what would otherwise be a consensus
    // badge — it gets its own gap section below.
    const cleanlyApplied = outcome.items.filter((a) => !gapIds.has(a.id))
    if (cleanlyApplied.length) {
      lines.push('', `### Applied (${cleanlyApplied.length})`)
      cleanlyApplied.forEach((a) => lines.push(`- \`${a.id}\`${a.pairedWith ? ` ≡ \`${a.pairedWith}\`` : ''} ${a.title}${a.commit ? ` — commit \`${a.commit.slice(0, 9)}\`` : ' — (uncommitted)'}`))
    }
    if (applyGaps.length) {
      lines.push('', `### Apply incomplete — needs reconcile (${applyGaps.length})`)
      const reasonText = { 'missing-from-output': 'not confirmed applied (absent from apply output)', uncommitted: 'changed but not committed (per-fix commit missing)' }
      applyGaps.forEach((g) => {
        const item = outcome.items.find((a) => a.id === g.id)
        const title = item?.title ? ` ${item.title}` : ''
        lines.push(`- \`${g.id}\`${title} — ${reasonText[g.reason] ?? g.reason}`)
      })
    }
  }
  // apply:false runs hand the agreed plans to the caller instead of implementing
  // them; the comment records the handoff so the trail still shows what was agreed
  // (the caller appends its own apply outcomes when it posts this).
  if (outcome.kind === 'handed-off' && outcome.items.length) {
    lines.push('', `### Agreed fixes — handed off to the caller (${outcome.items.length})`)
    outcome.items.forEach((f) => lines.push(`- \`${f.id}\`${pairTag(f)} ${f.title} (${f.location})`))
  }
  if (drops.length) {
    lines.push('', `### Agreed — no change (${drops.length})`)
    drops.forEach((d) => lines.push(`- \`${d.id}\`${pairTag(d)} ${d.title} (${d.location})`))
  }
  if (escalations.length) {
    lines.push('', `### Escalated threads — ran past 3 rounds (${escalations.length})`)
    escalations.forEach((e) => lines.push(`- \`${e.file}\` (${e.findingIds.map((i) => `\`${i}\``).join(', ')}) — ${e.rounds} rounds, ${e.resolved ? 'self-resolved' : 'UNRESOLVED'}`))
  }
  if (unresolved.length) {
    lines.push('', `### Unresolved — needs human (${unresolved.length})`)
    // Surface BOTH lenses' full final positions (disposition + reasoning + any
    // plan), not just the bare verdict — a human adjudicating needs the actual
    // disagreement, which lives in each side's reasoning/plan text.
    unresolved.forEach((u) => {
      lines.push('', `- \`${u.id}\`${pairTag(u)} ${u.title} (${u.location})`)
      for (const lens of ['lowy', 'hickey']) {
        const p = u[lens]
        const verdict = p?.disposition ?? '?'
        const reasoning = p?.reasoning ? ` — ${p.reasoning}` : ''
        lines.push(`  - **${lens}**: ${verdict}${reasoning}`)
        if (p?.plan?.trim()) lines.push(`    - plan: ${p.plan}`)
      }
    })
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Phase 1 — independent parallel review. UNCHANGED shape, load-bearing: lowy
// and hickey read the FULL diff simultaneously and independently (the #1109
// framing-bias lesson), on Opus, with lowy running the electricity probe.
// Everything downstream is allowed to be scoped precisely BECAUSE this phase
// was not.
// ---------------------------------------------------------------------------
phase('Review')

const reviews = await parallel(
  REVIEWERS.map((r) => () => {
    turns.review++
    return agent(reviewBrief(r.lens, r.framework, r.probe), { label: `review:${r.lens}`, phase: 'Review', model, schema: FINDINGS_SCHEMA })
  }),
)

const reviewByLens = {}
const combined = []
REVIEWERS.forEach((r, idx) => {
  const findings = reviews[idx]?.findings ?? []
  reviewByLens[r.lens] = findings
  findings.forEach((f, i) => combined.push({ id: `${r.lens}-${i + 1}`, origin: r.lens, severity: f.severity || 'major', ...f }))
})
log(`Independent findings: ${REVIEWERS.map((r) => `${r.lens}=${reviewByLens[r.lens].length}`).join(', ')}`)

if (combined.length === 0) {
  // Route the clean outcome through the SAME renderer as a debated run so the
  // comment carries the same audit metadata (base, lens roster, per-lens counts,
  // whether code-police ran) instead of a bare one-liner.
  const comment = renderComment({ rounds: 0, settledOut: [], unresolved: [], outcome: { kind: apply ? 'applied' : 'handed-off', items: [] }, reviewByLens, withPolice, base, clean: true })
  return { ...EMPTY_RESULT, status: 'clean', rounds: 0, base, withPolice, turns, note: 'every lens found nothing worth raising', reviews: reviewByLens, comment }
}

// ---------------------------------------------------------------------------
// Phase 2 — reconcile. Runs only AFTER both independent reviews exist (matching
// earlier would be the curation bias again). Three settle-without-debate paths,
// in order, each strictly narrowing what the Debate phase must handle:
//   1. matcher — findings BOTH lenses independently raised, with compatible
//      dispositions (and, for fixes, compatible plans) settle immediately: two
//      independent Opus lenses arriving at the same conclusion IS consensus,
//      no cross-examination adds information.
//   2. real-only rule — a MINOR solo finding in a file the other lens didn't
//      flag at all auto-settles as raised: the other lens read the same diff
//      and said nothing about that region, so forcing a cross-exam manufactures
//      an opinion it chose not to have.
//   3. objection check — every remaining solo finding gets ONE batched
//      opportunity per opposing lens to object; silence settles it as raised,
//      an objection promotes it to a debate thread.
// ---------------------------------------------------------------------------
phase('Reconcile')

const byId = Object.fromEntries(combined.map((f) => [f.id, f]))
const settled = {} // id -> { disposition, plan, via, lowy?, hickey?, duplicateOf? }
const pairOf = {} // secondary (hickey) id -> primary (lowy) id, for matched pairs
const mateOf = {} // both directions of a matched pair, for rendering
const contested = [] // [{ id, findingIds, f, pairF?, pairId?, openLowy?, openHickey?, excerpt }]

const settleAsRaised = (f, via) => {
  settled[f.id] = { disposition: f.disposition, plan: f.disposition === 'fix' ? f.suggestion : undefined, via }
}

// -- 2.1 matcher: cross-lens duplicate reconciliation ------------------------
const lowyFindings = combined.filter((f) => f.origin === 'lowy')
const hickeyFindings = combined.filter((f) => f.origin === 'hickey')
const matchedIds = new Set()
// Skip the matcher outright when either lens raised nothing — there is nothing
// cross-lens to match, and "at most one cheap matcher agent" includes zero.
if (lowyFindings.length && hickeyFindings.length) {
  turns.match++
  const matchRes = await agent(matchBrief(lowyFindings, hickeyFindings), {
    label: 'reconcile:match',
    phase: 'Reconcile',
    model: MATCH_MODEL,
    schema: MATCH_SCHEMA,
  })
  for (const m of matchRes?.matches ?? []) {
    const fa = byId[m.a]
    const fb = byId[m.b]
    // Validate hard: real ids, correct origins, each id used at most once. An
    // invalid pair is DROPPED (the findings fall through to the objection check
    // — safe), never repaired into something the matcher didn't say.
    if (!fa || !fb || fa.origin !== 'lowy' || fb.origin !== 'hickey' || matchedIds.has(m.a) || matchedIds.has(m.b)) {
      log(`Matcher pair rejected (${m.a} / ${m.b}): unknown id, wrong origin, or id reused — findings fall through to the objection check.`)
      continue
    }
    // A compatible fix/fix pair MUST carry the canonical plan; settling a fix on
    // an absent plan would hand Apply an arbitrary edit as "agreed" (the same
    // invariant the debate loop enforces via agreesWithPlan + lowyHasPlan).
    const bothFix = fa.disposition === 'fix' && fb.disposition === 'fix'
    const planOk = !bothFix || !!(typeof m.plan === 'string' && m.plan.trim())
    const compatible = m.compatible === true && fa.disposition === fb.disposition && planOk
    if (m.compatible === true && !compatible) log(`Matcher pair ${m.a} ≡ ${m.b} claimed compatible but ${planOk ? 'dispositions differ' : 'carries no canonical plan'} — demoted to contested.`)
    matchedIds.add(m.a)
    matchedIds.add(m.b)
    pairOf[m.b] = m.a
    mateOf[m.a] = m.b
    mateOf[m.b] = m.a
    if (compatible) {
      settled[m.a] = { disposition: fa.disposition, plan: bothFix ? m.plan.trim() : undefined, via: 'reconciled', pairedWith: m.b }
      settled[m.b] = { disposition: fb.disposition, plan: undefined, via: 'reconciled', duplicateOf: m.a, pairedWith: m.a }
      log(`Reconciled ${m.a} ≡ ${m.b} (${fa.disposition}) — settled with zero debate turns.`)
    } else {
      // Both raised it, but they genuinely disagree (disposition or plan) —
      // this is the real cross-examination case. Seed the thread with each
      // side's independent review stance.
      contested.push({
        id: m.a,
        findingIds: [m.a, m.b],
        f: fa,
        pairF: fb,
        pairId: m.b,
        openLowy: { id: m.a, disposition: fa.disposition, plan: fa.disposition === 'fix' ? fa.suggestion : undefined, reasoning: fa.problem },
        openHickey: { id: m.a, disposition: fb.disposition, plan: fb.disposition === 'fix' ? fb.suggestion : undefined, reasoning: fb.problem },
      })
      log(`Pair ${m.a} ≡ ${m.b} raised by both but ${fa.disposition === fb.disposition ? 'plans differ' : `dispositions differ (${fa.disposition}/${fb.disposition})`} — contested.`)
    }
  }
}

// -- 2.2 real-only rule + objection-check queueing ---------------------------
// Files each debater lens flagged in its INDEPENDENT review — the "region" of
// the real-only rule. Built from the full review output (matched or not): the
// question is "did this lens have anything to say about that file?".
const flaggedFiles = { lowy: new Set(lowyFindings.map((f) => fileOf(f.location))), hickey: new Set(hickeyFindings.map((f) => fileOf(f.location))) }
const otherDebater = (lens) => (lens === 'lowy' ? 'hickey' : 'lowy')
// Solo findings queued for the objection check, keyed by the lens that must
// answer. A police finding needs BOTH debaters' silence to settle (police has
// no vote, so a debater must ratify each police finding it didn't raise).
const objectionQueue = { lowy: [], hickey: [] }
for (const f of combined) {
  if (settled[f.id] || matchedIds.has(f.id)) continue
  if (f.origin === 'code-police') {
    objectionQueue.lowy.push(f.id)
    objectionQueue.hickey.push(f.id)
    continue
  }
  const opp = otherDebater(f.origin)
  if (f.severity === 'minor' && !flaggedFiles[opp].has(fileOf(f.location))) {
    settleAsRaised(f, 'auto-minor')
    log(`Auto-settled ${f.id} (minor, ${fileOf(f.location)} untouched by ${opp}) as ${f.disposition}.`)
  } else {
    objectionQueue[opp].push(f.id)
  }
}

// -- 2.3 hunk extraction — the scoped context every later turn runs on -------
// One mechanical agent extracts each still-open finding's relevant hunks ONCE;
// objection checks and debate turns then receive text instead of a full-diff
// read instruction. Requested per contested/queued finding (pairs under their
// primary id, covering both locations).
const needHunks = []
const seenHunkIds = new Set()
const queueHunk = (id, location) => {
  if (seenHunkIds.has(id)) return
  seenHunkIds.add(id)
  needHunks.push({ id, location })
}
for (const c of contested) queueHunk(c.id, c.pairF && c.pairF.location !== c.f.location ? `${c.f.location}; ${c.pairF.location}` : c.f.location)
for (const lens of DEBATERS) for (const id of objectionQueue[lens]) queueHunk(id, byId[id].location)

const excerpts = {}
if (needHunks.length) {
  turns.mech++
  const hunkRes = await agent(hunksBrief(needHunks), { label: 'reconcile:hunks', phase: 'Reconcile', model: mechModel, schema: HUNKS_SCHEMA })
  for (const h of hunkRes?.hunks ?? []) {
    if (seenHunkIds.has(h.id) && typeof h.excerpt === 'string' && h.excerpt.trim()) excerpts[h.id] = h.excerpt
  }
  // A finding the extractor missed (or returned empty for) still debates — but
  // LOUDLY, with the turn told to read the file itself. Surfaced, not silently
  // degraded: the turn agents see exactly why the hunk block is a pointer.
  for (const it of needHunks) {
    if (!excerpts[it.id]) {
      log(`Hunk extraction returned nothing for ${it.id} (${it.location}) — its turns must Read the file directly.`)
      excerpts[it.id] = `(hunk extraction returned nothing for this finding — Read the file(s) at ${it.location} under ${repoPath} yourself)`
    }
  }
}

// -- 2.4 batched objection check ---------------------------------------------
// ONE call per lens covering ALL of the opponent's queued solo findings, in
// parallel (the two batches are disjoint — no reveal ordering applies; the
// sequential reveal matters inside debate threads, where positions iterate).
const objectionRes = { lowy: null, hickey: null }
if (objectionQueue.lowy.length || objectionQueue.hickey.length) {
  const [lowyObj, hickeyObj] = await parallel(
    DEBATERS.map((lens) => () => {
      const ids = objectionQueue[lens]
      if (!ids.length) return Promise.resolve(null)
      turns.objection++
      const items = ids.map((id) => ({ f: byId[id], excerpt: excerpts[id] }))
      return agent(objectionBrief(lens, otherDebater(lens), items), {
        label: `objection:${lens}`,
        phase: 'Reconcile',
        model,
        schema: OBJECTION_SCHEMA,
      })
    }),
  )
  objectionRes.lowy = lowyObj
  objectionRes.hickey = hickeyObj
}
const checksBy = (lens) => Object.fromEntries((objectionRes[lens]?.checks ?? []).map((c) => [c.id, c]))
const lowyChecks = checksBy('lowy')
const hickeyChecks = checksBy('hickey')

const objectionPosition = (f, check) =>
  check ? { id: f.id, disposition: check.disposition || undefined, plan: check.plan, reasoning: check.reasoning } : undefined

for (const f of combined) {
  if (settled[f.id] || matchedIds.has(f.id)) continue
  if (f.origin === 'code-police') {
    const lc = lowyChecks[f.id]
    const hc = hickeyChecks[f.id]
    const lObj = lc?.objects === true
    const hObj = hc?.objects === true
    // A check the lens dropped from its output is NOT silence — treat it as an
    // objection so the finding debates rather than settling unratified.
    const lMissing = !lc
    const hMissing = !hc
    if (!lObj && !hObj && !lMissing && !hMissing) {
      settleAsRaised(f, 'no-objection')
      log(`Settled ${f.id} (police, neither debater objected) as ${f.disposition}.`)
    } else if (lObj && hObj && lc.disposition && lc.disposition === hc.disposition && lc.disposition !== 'fix') {
      // Both debaters object the same non-fix way — that IS lowy ⇄ hickey
      // consensus (two fix objections still debate: their plans never met).
      settled[f.id] = { disposition: lc.disposition, plan: undefined, via: 'objection-agreed', lowy: objectionPosition(f, lc), hickey: objectionPosition(f, hc) }
      log(`Settled ${f.id} (police, both debaters object → ${lc.disposition}).`)
    } else {
      contested.push({
        id: f.id,
        findingIds: [f.id],
        f,
        openLowy: lObj || lMissing ? objectionPosition(f, lc) : { id: f.id, disposition: f.disposition, plan: f.disposition === 'fix' ? f.suggestion : undefined, reasoning: `no objection to ${f.origin}'s finding as raised` },
        openHickey: hObj || hMissing ? objectionPosition(f, hc) : { id: f.id, disposition: f.disposition, plan: f.disposition === 'fix' ? f.suggestion : undefined, reasoning: `no objection to ${f.origin}'s finding as raised` },
      })
      log(`Contested ${f.id} (police, ${[lMissing && 'lowy check missing', lObj && 'lowy objects', hMissing && 'hickey check missing', hObj && 'hickey objects'].filter(Boolean).join(', ')}).`)
    }
    continue
  }
  const opp = otherDebater(f.origin)
  const check = (opp === 'lowy' ? lowyChecks : hickeyChecks)[f.id]
  if (check && check.objects === false) {
    settleAsRaised(f, 'no-objection')
    log(`Settled ${f.id} (${opp} has no objection) as ${f.disposition}.`)
  } else {
    // Objection — or a check the lens dropped from its batch, which must NOT
    // silently settle (absence of an answer is not agreement).
    if (!check) log(`Objection check for ${f.id} missing from ${opp}'s batch — contested, not settled.`)
    const raiserPos = { id: f.id, disposition: f.disposition, plan: f.disposition === 'fix' ? f.suggestion : undefined, reasoning: f.problem }
    contested.push({
      id: f.id,
      findingIds: [f.id],
      f,
      openLowy: f.origin === 'lowy' ? raiserPos : objectionPosition(f, check),
      openHickey: f.origin === 'hickey' ? raiserPos : objectionPosition(f, check),
    })
    if (check) log(`Contested ${f.id}: ${opp} objects (${check.disposition || 'no disposition given'}).`)
  }
}
contested.forEach((c) => {
  c.excerpt = excerpts[c.id] || `(no hunk excerpt — Read the file(s) at ${c.f.location} under ${repoPath} yourself)`
})
log(`Reconcile done: ${Object.keys(settled).length}/${combined.length} finding(s) settled without debate; ${contested.length} contested item(s) go to threads.`)

// ---------------------------------------------------------------------------
// Phase 3 — debate, in PARALLEL per-file threads. Only genuinely contested
// findings reach here. Each thread is its own lowy ⇄ hickey exchange over the
// findings in ONE file, with the three convergence mechanics intact per thread:
// independent review already happened; settled findings LOCK (the active set is
// monotonically non-increasing); and the reveal is sequential INSIDE the thread
// (lowy posts, hickey answers lowy's CURRENT positions). Threads share no state,
// so wall clock = the deepest single disagreement, not rounds × 2 × turn-time
// across every finding. NO deadlock exit: a thread runs until every finding is
// agreed (maxRounds stays the pathology backstop). The escalation valve is
// softer than either: a thread passing 3 rounds KEEPS DEBATING but is recorded
// in `escalations` so the caller can hand that one thread to a warmer venue.
// ---------------------------------------------------------------------------
const escalations = []
const history = []
const finalPos = {} // primary id -> { lowy, hickey } latest positions (for unresolved reporting)
let rounds = 0

async function runThread(thread) {
  const { file, items } = thread
  // Seed the final-position map from the openers gathered at reconcile (review
  // stances / objection positions) so a thread whose agent dies before
  // completing a round still surfaces both lenses' ON-RECORD positions in the
  // unresolved report, instead of disposition '?' with no reasoning. The
  // per-round update below overwrites these with real turn positions.
  for (const it of items) finalPos[it.id] = { lowy: it.openLowy, hickey: it.openHickey }
  let active = [...items]
  let hickeyPrev = null
  // Seed round 1 with the openers gathered at reconcile (review stances /
  // objection positions), so the first exchange starts from real positions
  // instead of re-eliciting them.
  const seed = Object.fromEntries(items.filter((it) => it.openHickey).map((it) => [it.id, it.openHickey]))
  if (Object.keys(seed).length) hickeyPrev = seed
  let threadRounds = 0
  for (let r = 1; r <= maxRounds && active.length > 0; r++) {
    threadRounds = r
    const settledList = items.filter((it) => settled[it.id]).map((it) => ({ id: it.id, disposition: settled[it.id].disposition }))
    turns.debate++
    const lowyRes = await agent(threadTurnBrief('lowy', 'hickey', file, active, hickeyPrev, settledList, r), {
      label: `lowy:${file}:r${r}`,
      phase: 'Debate',
      model,
      schema: POSITION_SCHEMA,
    })
    const lowyPos = posMap(lowyRes)
    turns.debate++
    const hickeyRes = await agent(threadTurnBrief('hickey', 'lowy', file, active, lowyPos, settledList, r), {
      label: `hickey:${file}:r${r}`,
      phase: 'Debate',
      model,
      schema: POSITION_SCHEMA,
    })
    const hickeyPos = posMap(hickeyRes)
    hickeyPrev = hickeyPos

    const per = []
    for (const item of [...active]) {
      const id = item.id
      const l = lowyPos[id]
      const h = hickeyPos[id]
      finalPos[id] = { lowy: l ?? finalPos[id]?.lowy, hickey: h ?? finalPos[id]?.hickey }
      // For a `fix`, agreement requires the second poster (hickey, who has seen
      // lowy's positions) to endorse lowy's plan as-is — otherwise the finding
      // stays active so the plan converges the same way the disposition does.
      // `plan` is optional in the schema, so a `fix` can only settle once lowy has
      // actually supplied a non-empty plan: endorsing an absent plan is not
      // consensus, and Apply must never run on a `plan: undefined` (it would fall
      // back to a vague placeholder and commit an arbitrary edit as "agreed").
      const lowyHasPlan = !!(l && typeof l.plan === 'string' && l.plan.trim())
      const agreed = !!(
        l &&
        h &&
        l.disposition === h.disposition &&
        (l.disposition !== 'fix' || (h.agreesWithPlan === true && lowyHasPlan))
      )
      per.push({ id, lowy: l?.disposition ?? '?', hickey: h?.disposition ?? '?', agreed })
      if (agreed) {
        // Endorsement guarantees l.plan is the converged text; no arbitrary fallback.
        settled[id] = { disposition: l.disposition, plan: l.disposition === 'fix' ? l.plan : undefined, via: 'debated', lowy: l, hickey: h, pairedWith: item.pairId }
        if (item.pairId) settled[item.pairId] = { disposition: l.disposition, plan: undefined, via: 'debated', duplicateOf: id, pairedWith: id }
        active = active.filter((x) => x.id !== id)
      }
    }
    history.push({ thread: file, round: r, per })
    log(`Thread ${file} round ${r}: ${per.map((p) => `${p.id} ${p.lowy}/${p.hickey}${p.agreed ? '✓' : '✗'}`).join('  ')} | ${items.length - active.length}/${items.length} settled`)
  }
  // The escalation valve: >3 rounds is NOT ground to stop (the thread above
  // kept debating to consensus or the backstop) — it IS ground to tell the
  // caller, who can hand this one thread to warm /debate terminals next time.
  if (threadRounds > 3) {
    escalations.push({ file, findingIds: items.flatMap((it) => it.findingIds), rounds: threadRounds, resolved: active.length === 0 })
  }
  rounds = Math.max(rounds, threadRounds)
  return { file, rounds: threadRounds, unsettled: active.map((it) => it.id) }
}

let status = 'consensus'
if (contested.length) {
  phase('Debate')
  const threadMap = {}
  for (const item of contested) {
    const file = fileOf(item.f.location)
    ;(threadMap[file] ??= { file, items: [] }).items.push(item)
  }
  const threads = Object.values(threadMap)
  log(`Debating ${contested.length} contested item(s) in ${threads.length} parallel thread(s): ${threads.map((t) => `${t.file} (${t.items.length})`).join(', ')}`)
  // One stage per thread — each thunk runs its whole sequential exchange, so
  // concurrency is across threads (deepest-disagreement wall clock) with no
  // cross-thread round barrier. A thread whose agent dies resolves null; its
  // findings simply stay unsettled and surface as unresolved below.
  await parallel(threads.map((t) => () => runThread(t)))
}

// Final per-finding verdict: agreed ones carry the consensus disposition;
// any still-contested ones are surfaced (unresolved → human), never silently dropped.
const settledOut = combined.map((f) => {
  const s = settled[f.id]
  const common = { id: f.id, origin: f.origin, title: f.title, location: f.location, problem: f.problem, suggestion: f.suggestion, severity: f.severity }
  if (s) {
    return { ...common, agreed: true, disposition: s.disposition, plan: s.plan, via: s.via, duplicateOf: s.duplicateOf, pairedWith: s.pairedWith, lowy: s.lowy, hickey: s.hickey }
  }
  const primary = pairOf[f.id]
  const pos = finalPos[primary ?? f.id]
  return { ...common, agreed: false, disposition: 'unresolved', plan: undefined, via: undefined, duplicateOf: primary, pairedWith: mateOf[f.id], lowy: pos?.lowy, hickey: pos?.hickey }
})
// Pairs count once everywhere a human reads (unresolved list, fixes) — the
// secondary id carries duplicateOf and is skipped.
const unresolved = settledOut.filter((s) => !s.agreed && !s.duplicateOf)
if (unresolved.length) status = 'unresolved'
log(`Debate ended: ${status}; deepest thread ${rounds} round(s); ${combined.length - settledOut.filter((s) => !s.agreed).length}/${combined.length} settled, ${unresolved.length} unresolved${escalations.length ? `; ${escalations.length} escalated thread(s)` : ''}.`)

// ---------------------------------------------------------------------------
// Phase 4 — apply every agreed `fix` finding in a SINGLE session, one commit
// per finding. One agent orients on the repo once and applies all the fixes,
// rather than paying a fresh implement+commit agent (and its re-orientation
// cost) per finding; the fixes are independent and their plans already
// converged, so there's no cross-fix reasoning to isolate. Skipped wholesale
// under `apply: false`: the agreed plans are returned in `fixes` for the caller
// to implement against whatever tree it chooses.
// ---------------------------------------------------------------------------
const fixes = settledOut.filter((s) => s.agreed && s.disposition === 'fix' && !s.duplicateOf)
let applied = []
// Agreed fixes the Apply phase did not cleanly land. Two failure shapes, both of
// which would otherwise be rendered as "applied" and reported under a consensus:
//  - missing: the agent dropped the fix from its output entirely (no entry, no
//    files) — we can't tell if it was applied, so it must not be reported as done.
//  - uncommitted: in commit mode the agent changed files for the fix but returned
//    no SHA — its per-fix commit didn't land, breaking "one commit per fix".
// The edits (when present) stay in the tree, so this is a status downgrade, not a
// hard abort: the caller reconciles the gap rather than losing a converged debate.
const applyGaps = []
if (apply && fixes.length) {
  phase('Apply')
  turns.apply++
  const res = await agent(applyAllBrief(fixes, commit), { label: 'apply:all', phase: 'Apply', model, schema: APPLY_SCHEMA })
  const applyById = Object.fromEntries((res?.applied ?? []).map((x) => [x.id, x]))
  // Re-key off the agreed `fixes` (not the agent's array) so a fix the agent
  // dropped from its output still surfaces — as 0 files / uncommitted — instead
  // of vanishing from `applied` and the PR comment.
  applied = fixes.map((f) => {
    const entry = applyById[f.id]
    const x = entry || {}
    const sha = (x.commit || '').trim()
    const files = x.filesChanged ?? []
    if (!entry) {
      // The agent never reported this agreed fix. We can't confirm it was applied,
      // so flag it rather than render a phantom 0-file "applied" row as success.
      applyGaps.push({ id: f.id, reason: 'missing-from-output' })
      log(`Apply ${f.id}: agreed fix absent from apply-agent output — not confirmed applied`)
    } else if (commit && !sha && files.length > 0) {
      // Reported changed-but-uncommitted in commit mode: the per-fix commit the
      // agent was told to make didn't land. Surface it as a gap, not a clean apply.
      applyGaps.push({ id: f.id, reason: 'uncommitted' })
      log(`Apply ${f.id}: agent changed ${files.length} file(s) but returned no commit SHA`)
    }
    return { id: f.id, title: f.title, pairedWith: f.pairedWith, files, commit: sha || null }
  })
  applied.forEach((x) => log(`Applied ${x.id}: ${x.files.length} file(s)${x.commit ? `, committed ${x.commit.slice(0, 9)}` : ' (uncommitted)'}`))
  // A converged debate whose fixes didn't cleanly land is NOT a clean consensus:
  // downgrade so /be-review (which keys off this status) and the comment don't
  // advertise success over an unconfirmed/uncommitted fix. Only touch a status
  // that was otherwise clean ('consensus'); 'unresolved' already signals the
  // human must act.
  if (applyGaps.length && status === 'consensus') {
    status = 'apply-incomplete'
    log(`Apply incomplete: ${applyGaps.map((g) => `${g.id} (${g.reason})`).join(', ')} — downgrading consensus to apply-incomplete.`)
  }
} else if (fixes.length) {
  log(`Apply skipped (apply: false) — returning ${fixes.length} agreed fix plan(s) to the caller.`)
}

return {
  status,
  // Depth of the DEEPEST thread (0 = everything settled at reconciliation) —
  // the honest wall-clock analog of the old global round count.
  rounds,
  base,
  withPolice,
  settled: settledOut,
  unresolved,
  applied,
  // Agreed fixes that didn't cleanly land (missing from the apply output, or
  // changed-but-uncommitted). Empty unless status is 'apply-incomplete'; lets the
  // caller pinpoint which fix to reconcile.
  applyGaps,
  // The agreed `fix` findings with their converged plans — the caller's
  // change-request payload under `apply: false` (redundant with `settled` when
  // the Apply phase ran, but always present so consumers need not re-filter).
  // Matched pairs appear ONCE (under the primary id, `pairedWith` set).
  fixes,
  reviews: reviewByLens,
  history,
  // Threads that ran past 3 rounds (kept debating — this is a valve, not an
  // exit). The caller/coordinator can hand an escalated thread's findings to
  // warm /debate terminals instead of another cold engine run — see SKILL.md.
  escalations,
  // Per-stage agent-call counts — the benchmarkable cost measure.
  turns,
  comment: renderComment({ rounds, settledOut, unresolved, outcome: apply ? { kind: 'applied', items: applied } : { kind: 'handed-off', items: fixes }, reviewByLens, withPolice, base, applyGaps, escalations }),
}
