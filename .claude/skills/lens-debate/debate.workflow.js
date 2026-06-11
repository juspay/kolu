// The Workflow runtime requires `export const meta` to be the FIRST statement
// and a PURE LITERAL (no variable interpolation), so the primary model is
// inlined as 'opus' in the phase entries below; commit agents within Apply run
// on mechModel (haiku). The single `const MODEL` socket lives just after meta —
// every other model reference in this script reads it lazily at
// input-resolution time, well after meta is evaluated.
export const meta = {
  name: 'lens-debate',
  description:
    'lowy + hickey review a diff independently in parallel, then debate every finding to consensus; apply the agreed fixes',
  phases: [
    { title: 'Review', detail: 'lowy and hickey (and optionally code-police) review the diff independently, in parallel', model: 'opus' },
    { title: 'Debate', detail: 'lowy and hickey cross-examine every finding until they agree per-finding', model: 'opus' },
    { title: 'Apply', detail: 'implement each agreed fix as its own commit (skipped under apply:false)', model: 'opus' },
  ],
}

// The model every lens/agent runs on. SKILL.md flags this as load-bearing
// (lenses run on Opus, overriding their `model: sonnet` frontmatter) and model
// migrations are a recurring change — keep it to one socket. Inlined into the
// phase entries above (meta must be a pure literal); the `model` input below
// defaults to it.
const MODEL = 'opus'

// ---------------------------------------------------------------------------
// Inputs (passed via the Workflow tool's `args`)
// ---------------------------------------------------------------------------
const a = args || {}
const repoPath = a.repoPath || '.'
// The diff base. Resolved to the MERGE-BASE of (rawBase, HEAD) just below, before
// DIFF is built, so the lenses review only what THIS branch changed — not commits
// the base branch gained since the branch forked (those would otherwise appear in
// `git diff base` as the base branch's drift, reviewed as ours). `let` because the
// resolution reassigns it. Idempotent when the caller already passed a merge-base
// SHA (e.g. /be-review).
let base = a.base || 'origin/master'
// Round backstop. Tight by design, not a formality: the contested set is
// monotonically non-increasing (settled findings lock), so almost all genuine
// convergence happens in the first rounds — and the multi-agent-debate
// literature shows extra rounds amplify bias and produce unanimous-WRONG
// consensus at a rate that grows with rounds (see the review-orchestration
// Atlas note). What's still contested at round 4 is a real judgment call that
// belongs to a human (`unresolved` — /be-review adjudicates), not to rounds
// 5-12 of two same-family lenses wearing each other down.
const maxRounds = a.maxRounds || 4
// Apply agreed `fix` findings as individual commits (default on). `--no-commit`
// still applies the edits to the working tree, it just leaves them uncommitted.
// No-op when `apply` is false — the apply:false path returns plans in `fixes`
// and never commits; `commit` only gates the in-workflow Apply phase.
const commit = a.commit !== false
// Run the Apply phase at all (default on). `apply: false` skips Phase 3 entirely:
// the debate still settles every finding, but the agreed `fix` plans are RETURNED
// (the `fixes` field) instead of implemented — for callers that want the agreed
// fix plans returned so they can apply them against a tree of their choosing.
const apply = a.apply !== false
// Fold in /code-police as a third, lower-weight voice: it SEEDS findings into
// the debate set but does not get a vote in consensus (only lowy ⇄ hickey do).
const withPolice = a.withPolice === true
// Optional author note on deliberate design decisions (e.g. a deliberate
// fail-open). Threaded into the DEBATE (cross-examination) prompts ONLY — never
// the independent reviews. Pre-loading reviewers with author intent measurably
// suppresses findings (the #1109 curation-bias lesson, and the 3-4x framing
// effect in the review-orchestration Atlas note): the lens should flag the
// deliberate decision cold, and the rationale then justifies a `drop`
// disposition ON THE RECORD during cross-examination — a visible adjudication,
// not a finding that was never born.
const rationale = (a.rationale || '').trim()
// Model every lens/agent runs on; defaults to MODEL (see top of file). Overridable
// via args to mirror the file's input pattern and to make a model bump a one-liner.
const model = a.model || MODEL
// Mechanical tier (Haiku). The lenses' reviews + the per-finding debate + applying
// an agreed fix all do real reasoning → `model` (Opus, load-bearing for the
// lenses). The merge-base resolver and the per-fix committer are pure git → run
// them on `mechModel`. Defaults match a direct invocation; /be-review passes it.
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
const EMPTY_RESULT = { settled: [], unresolved: [], applied: [], fixes: [], reviews: {}, history: [] }

// Resolve the diff base to the merge-base of (base, HEAD) BEFORE building DIFF
// (which interpolates `base` eagerly), so the lenses review only what this branch
// changed, not the base branch's drift since the fork. A thin mechanical git
// agent (the workflow can't run git itself); grouped under the Review phase.
// Idempotent when `base` is already a merge-base SHA (caller resolved it).
const rawBase = base
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
    note: `merge-base of \`${rawBase}\` and HEAD could not be resolved (missing/typoed base, stale ref, or unrelated history), so the review scope is untrustworthy. Fix the base ref (e.g. \`git fetch\`) and re-run.${err ? `\ngit error:\n${err}` : ''}`,
  }
}
base = baseRes.sha.trim()

// How every agent is told to inspect the change. The lenses do NOT trust a
// curated finding list — they read the source themselves (the load-bearing
// lesson from #1109: curation biases the verdict).
const DIFF = `Inspect the FULL change in the repo at \`${repoPath}\` — your shell cwd may be a DIFFERENT worktree, so use \`git -C ${repoPath}\` and ABSOLUTE paths under \`${repoPath}\`: run \`git -C ${repoPath} diff ${base}\` (committed + unstaged) and \`git -C ${repoPath} status --short\` (untracked/new files do NOT appear in the diff), then Read every new/changed file plus enough surrounding code to judge it in context. Ignore the debate's own scratch dir \`.lens-debate/\` if it appears.`

const rationaleBlock = rationale ? `\nAuthor's note on deliberate decisions (do not flag these as defects unless the reasoning is itself wrong):\n${rationale}\n` : ''

// ---------------------------------------------------------------------------
// Schemas — the review and the per-finding debate position
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
        required: ['title', 'location', 'problem', 'suggestion', 'disposition'],
        properties: {
          title: { type: 'string' },
          location: { type: 'string', description: 'file:line' },
          problem: { type: 'string', description: "the problem in your lens's terms" },
          suggestion: { type: 'string', description: 'a concrete, implementable change' },
          disposition: { type: 'string', enum: ['fix', 'drop'], description: 'fix = worth changing in THIS PR; drop = observation only' },
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
          concessionReason: {
            type: 'string',
            description:
              'REQUIRED whenever your disposition for this finding differs from your last cited-or-original position: the specific code (file:line) or opposing argument that changed your mind. An uncited flip does not settle the finding — holding the flipped position in later rounds does not launder it; the citation stays owed. Omit on round 1 or when holding your position.',
          },
        },
      },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'filesChanged'],
  properties: {
    summary: { type: 'string', description: 'one line: what you changed' },
    filesChanged: { type: 'array', items: { type: 'string' } },
  },
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
function reviewBrief(lens, framework, probe) {
  const probeBlock = probe ? `\n${probe}\n` : ''
  return `You are the **${lens}** reviewer. First Read \`.claude/skills/${lens}/SKILL.md\` for your framework, then ${DIFF}

Review the change through the **${framework}** lens, INDEPENDENTLY — you are NOT seeing any other reviewer's findings, and you are NOT given the author's rationale. That independence is the whole point: being handed someone else's curated finding (or the author's framing) biases the verdict. Deliberate-decision context enters later, at cross-examination.
${probeBlock}
Give ALL your findings — every structural issue you see through your lens, no cap, at every level (boundary, complecting, naming, duplication, …). Each: a title, a file:line location, the problem in your lens's terms, a concrete suggestion, and a disposition — \`fix\` (worth changing in THIS PR) or \`drop\` (observation only). Don't fabricate issues, but don't hold any back either; an empty list is fine only for a genuinely clean diff.`
}

function findingLine(f) {
  return `### ${f.id} (raised by ${f.origin}) — ${f.title}\n  at ${f.location}; raiser's disposition: ${f.disposition}\n  problem: ${f.problem}\n  suggestion: ${f.suggestion}`
}

function debateBrief(lens, opp, activeFindings, oppPos, settledList, roundNum, owedIds) {
  const settledNote = settledList.length
    ? `\nALREADY SETTLED (you both agreed — do NOT relitigate, shown for context only):\n${settledList.map((s) => `- ${s.id}: ${s.disposition}`).join('\n')}\n`
    : ''
  const owedNote = owedIds && owedIds.length
    ? `\nCITATION OWED on: ${owedIds.join(', ')} — in an earlier round you changed your disposition on these WITHOUT citing what convinced you, so they cannot settle. This round either supply \`concessionReason\` (the specific code file:line or the opposing argument that changed your mind) or revert to your original disposition.\n`
    : ''
  const oppBlock = oppPos
    ? `**${opp}'s positions to rebut or concede, point by point:**\n${JSON.stringify(oppPos, null, 2)}\n\nFor each finding you also call \`fix\`, set \`agreesWithPlan\`: true only if you endorse ${opp}'s \`plan\` as-is. If false, your \`plan\` field is the amended plan that must still converge — the finding stays open another round until the plans agree, just like the disposition.`
    : `Round 1 — give your initial disposition on every contested finding below, including ${opp}'s and any from other reviewers.`
  return `You are **${lens}**, cross-examining **${opp}** to reach agreement. First Read \`.claude/skills/${lens}/SKILL.md\` for your framework, then ${DIFF} Ground every call in the source.
${rationaleBlock}${owedNote}
CONTESTED findings — disposition EVERY one (yours, ${opp}'s, and any from other reviewers):
${activeFindings.map(findingLine).join('\n\n')}
${settledNote}
${oppBlock}

Round ${roundNum}. For EVERY contested finding id above, output a disposition (\`fix\` = worth changing in THIS PR / \`drop\` = leave as-is, observation only), a concrete implementable plan if \`fix\`, and reasoning grounded in the code. **The goal is the correct answer for THIS PR, not winning** — concede explicitly ("conceding: …") when ${opp}'s code-grounded argument is right. A \`fix\` is worth it only if it genuinely improves the PR.

**Concessions must be cited.** If your disposition for a finding differs from your last cited-or-original position, set \`concessionReason\` to the specific code (file:line) or the opposing argument that changed your mind. An uncited flip does NOT settle the finding — and holding the flipped position in a later round does not clear the debt (see any CITATION OWED note above). Capitulating to end the debate is worse than leaving the finding unresolved for a human.`
}

function implementBrief(fix) {
  return `You are implementing ONE change that two structural-review lenses (lowy and hickey) independently agreed should be fixed in THIS PR. Work in the repo at \`${repoPath}\` — your shell cwd may be a DIFFERENT worktree, so every file you Read/Edit MUST be an ABSOLUTE path under \`${repoPath}\`.

Finding ${fix.id} (raised by ${fix.origin}) — ${fix.title}
  at ${fix.location}
  problem: ${fix.problem}
  original suggestion (context, not the agreed plan): ${fix.suggestion}
  agreed plan: ${fix.plan}

Make ONLY this change in the working tree, following the agreed plan above. Keep it tightly scoped to the finding; read the surrounding code first so the edit fits the existing style. Do NOT git add / commit / push. You may run the project's formatter on files you touched. Return a one-line summary and the exact list of files you changed.`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const posMap = (res) => Object.fromEntries((res?.positions ?? []).map((p) => [p.id, p]))

// Commit exactly the files one fix changed, with a message carrying the debate
// context. A thin mechanical agent: the workflow can't run git itself.
async function commitFix(fix, files, summary) {
  const fileArgs = files.map((f) => `'${f.replace(/'/g, `'\\''`)}'`).join(' ')
  const msgPath = `${workDir}/commit-msg-${fix.id}.txt`
  // `fix(lens):` — the conventional prefix for lens-originated commits.
  const message = `fix(lens): ${fix.title}

${summary}

Agreed by the lowy ⇄ hickey lens debate (finding ${fix.id}, raised by ${fix.origin}). Not pushed or merged.`
  const prompt = `You are a MECHANICAL COMMITTER. Do exactly these steps and nothing else — do not edit files, do not push, do not stage anything beyond the listed files.

1. Ensure the scratch dir exists: \`mkdir -p ${workDir}\`.
2. Using the Write tool, create \`${msgPath}\` with EXACTLY this content:

${message}

3. Run (every git command uses \`git -C ${repoPath}\`, so it targets THIS worktree regardless of your shell cwd):
   \`git -C ${repoPath} add -- ${fileArgs} && git -C ${repoPath} commit -F ${msgPath}\`
   Stage ONLY those files. Do NOT use \`git add -A\` or \`git add .\`.
4. Return the new commit SHA from \`git -C ${repoPath} rev-parse HEAD\`. Do NOT push.`
  return agent(prompt, { label: `commit:${fix.id}`, phase: 'Apply', model: mechModel })
}

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
function renderComment({ rounds, settledOut, unresolved, outcome, reviewByLens, withPolice, base, clean }) {
  const badge = clean
    ? '✅ **Clean** — every lens found nothing worth raising'
    : unresolved.length === 0
      ? '✅ **Consensus**'
      : `⚠️ **${unresolved.length} unresolved**`
  const counts = Object.entries(reviewByLens)
    .map(([lens, fs]) => `${lens}=${fs.length}`)
    .join(', ')
  // A clean diff never debated, so the "after N round(s)" clause is omitted; the
  // base, the lens roster, and the (all-zero) per-lens counts still ride along so
  // the comment carries the same audit metadata as a debated run.
  const meta = `lowy + hickey${withPolice ? ' + code-police' : ''} · base \`${(base || '').slice(0, 12)}\``
  const lines = [
    '## [⚖️ Lowy ⇄ Hickey lens debate](https://kolu.dev/blog/hickey-lowy/)',
    '',
    clean ? `${badge} · ${meta}` : `${badge} after ${rounds} round(s) · ${meta}`,
    '',
    `Independent findings: ${counts}`,
  ]
  const drops = settledOut.filter((s) => s.agreed && s.disposition === 'drop')
  if (outcome.kind === 'applied' && outcome.items.length) {
    lines.push('', `### Applied (${outcome.items.length})`)
    outcome.items.forEach((a) => lines.push(`- \`${a.id}\` ${a.title}${a.commit ? ` — commit \`${a.commit.slice(0, 9)}\`` : ' — (uncommitted)'}`))
  }
  // apply:false runs hand the agreed plans to the caller instead of implementing
  // them; the comment records the handoff so the trail still shows what was agreed
  // (the caller appends its own apply outcomes when it posts this).
  if (outcome.kind === 'handed-off' && outcome.items.length) {
    lines.push('', `### Agreed fixes — handed off to the caller (${outcome.items.length})`)
    outcome.items.forEach((f) => lines.push(`- \`${f.id}\` ${f.title} (${f.location})`))
  }
  if (drops.length) {
    lines.push('', `### Agreed — no change (${drops.length})`)
    drops.forEach((d) => lines.push(`- \`${d.id}\` ${d.title} (${d.location})`))
  }
  if (unresolved.length) {
    lines.push('', `### Unresolved — needs human (${unresolved.length})`)
    // Surface BOTH lenses' full final positions (disposition + reasoning + any
    // plan), not just the bare verdict — a human adjudicating needs the actual
    // disagreement, which lives in each side's reasoning/plan text.
    unresolved.forEach((u) => {
      lines.push('', `- \`${u.id}\` ${u.title} (${u.location})`)
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
// Phase 1 — independent parallel review
// ---------------------------------------------------------------------------
phase('Review')

const reviews = await parallel(
  REVIEWERS.map((r) => () =>
    agent(reviewBrief(r.lens, r.framework, r.probe), { label: `review:${r.lens}`, phase: 'Review', model, schema: FINDINGS_SCHEMA }),
  ),
)

const reviewByLens = {}
const combined = []
REVIEWERS.forEach((r, idx) => {
  const findings = reviews[idx]?.findings ?? []
  reviewByLens[r.lens] = findings
  findings.forEach((f, i) => combined.push({ id: `${r.lens}-${i + 1}`, origin: r.lens, ...f }))
})
log(`Independent findings: ${REVIEWERS.map((r) => `${r.lens}=${reviewByLens[r.lens].length}`).join(', ')}`)

if (combined.length === 0) {
  // Route the clean outcome through the SAME renderer as a debated run so the
  // comment carries the same audit metadata (base, lens roster, per-lens counts,
  // whether code-police ran) instead of a bare one-liner.
  const comment = renderComment({ rounds: 0, settledOut: [], unresolved: [], outcome: { kind: apply ? 'applied' : 'handed-off', items: [] }, reviewByLens, withPolice, base, clean: true })
  return { ...EMPTY_RESULT, status: 'clean', rounds: 0, base, withPolice, note: 'every lens found nothing worth raising', reviews: reviewByLens, comment }
}

// ---------------------------------------------------------------------------
// Phase 2 — debate to per-finding consensus within the round backstop. Agreed
// findings LOCK (leave the active set), so the contested set is monotonically
// non-increasing — the debate can only shrink. Whatever is still contested at
// the backstop ends `unresolved` for a human. Sequential reveal (lowy posts,
// hickey answers lowy's CURRENT positions) lets the two land together rather
// than chase each other's stale positions.
// ---------------------------------------------------------------------------
phase('Debate')

const settled = {} // id -> { disposition, plan, lowy, hickey }
let activeIds = combined.map((f) => f.id)
let lowyPrev = null
let hickeyPrev = null
const history = []
let status = 'unresolved'
let rounds = 0

// Cited-concession gate state. `baseline[lens][id]` is the lens's last
// ACCEPTED disposition for the finding — its first stated position, advanced
// only by a hold or by a CITED flip. Flips are measured against this baseline,
// not merely the previous round, so holding a capitulated position for a round
// never launders it: the finding stays contested until the lens either cites
// what convinced it (`concessionReason`) or reverts to its baseline. `owed`
// tracks the findings where a citation is outstanding, and is surfaced into
// that lens's next-round brief so the lens knows the debt (a gate the debater
// can't see is a gate it can't satisfy).
const baseline = { lowy: {}, hickey: {} }
const owed = { lowy: new Set(), hickey: new Set() }
// Returns true when the lens's current position is an UNCITED flip vs its
// baseline (blocking settlement this round); advances the baseline and clears
// any owed mark on a hold, revert, or cited flip.
function uncitedFlip(lens, id, cur) {
  if (!cur) return false
  const base = baseline[lens][id]
  if (base === undefined || cur.disposition === base) {
    if (base === undefined) baseline[lens][id] = cur.disposition
    owed[lens].delete(id)
    return false
  }
  if ((cur.concessionReason || '').trim()) {
    baseline[lens][id] = cur.disposition
    owed[lens].delete(id)
    return false
  }
  owed[lens].add(id)
  return true
}

for (let r = 1; r <= maxRounds && activeIds.length > 0; r++) {
  rounds = r
  const activeFindings = combined.filter((f) => activeIds.includes(f.id))
  const settledList = Object.entries(settled).map(([id, s]) => ({ id, disposition: s.disposition }))

  const lowyRes = await agent(debateBrief('lowy', 'hickey', activeFindings, hickeyPrev, settledList, r, [...owed.lowy].filter((id) => activeIds.includes(id))), {
    label: `lowy:round${r}`,
    phase: 'Debate',
    model,
    schema: POSITION_SCHEMA,
  })
  const lowyPos = posMap(lowyRes)

  const hickeyRes = await agent(debateBrief('hickey', 'lowy', activeFindings, lowyPos, settledList, r, [...owed.hickey].filter((id) => activeIds.includes(id))), {
    label: `hickey:round${r}`,
    phase: 'Debate',
    model,
    schema: POSITION_SCHEMA,
  })
  const hickeyPos = posMap(hickeyRes)

  // Cited-concession gate (see uncitedFlip above). A lens that flips its
  // baseline disposition without citing what convinced it is the measured
  // harmful pattern — conformity flips are predominantly wrong, and an
  // agreement reached through one cannot be trusted (see the
  // review-orchestration Atlas note). An uncited flip does NOT settle the
  // finding — this round or any later round it merely holds the uncited
  // position — and if the citation never arrives the finding ends
  // `unresolved` for a human, strictly better than recording a capitulation
  // as consensus.
  const per = []
  for (const id of [...activeIds]) {
    const l = lowyPos[id]
    const h = hickeyPos[id]
    // For a `fix`, agreement requires the second poster (hickey, who has seen
    // lowy's positions) to endorse lowy's plan as-is — otherwise the finding
    // stays active so the plan converges the same way the disposition does.
    // `plan` is optional in the schema, so a `fix` can only settle once lowy has
    // actually supplied a non-empty plan: endorsing an absent plan is not
    // consensus, and Apply must never run on a `plan: undefined` (it would fall
    // back to a vague placeholder and commit an arbitrary edit as "agreed").
    const lowyHasPlan = !!(l && typeof l.plan === 'string' && l.plan.trim())
    // Evaluate BOTH gates unconditionally (no short-circuit) so each lens's
    // baseline/owed state advances every round regardless of the other's.
    const lUncited = uncitedFlip('lowy', id, l)
    const hUncited = uncitedFlip('hickey', id, h)
    const uncited = lUncited || hUncited
    const agreed = !!(
      l &&
      h &&
      !uncited &&
      l.disposition === h.disposition &&
      (l.disposition !== 'fix' || (h.agreesWithPlan === true && lowyHasPlan))
    )
    if (uncited) log(`Round ${r}: ${id} flipped without a cited concessionReason — not settling it this round.`)
    per.push({ id, lowy: l?.disposition ?? '?', hickey: h?.disposition ?? '?', agreed, uncitedFlip: uncited })
    if (agreed) {
      // Endorsement guarantees l.plan is the converged text; no arbitrary fallback.
      settled[id] = { disposition: l.disposition, plan: l.disposition === 'fix' ? l.plan : undefined, lowy: l, hickey: h }
      activeIds = activeIds.filter((x) => x !== id)
    }
  }
  lowyPrev = lowyPos
  hickeyPrev = hickeyPos
  history.push({ round: r, per })
  log(`Round ${r}: ${per.map((p) => `${p.id} ${p.lowy}/${p.hickey}${p.agreed ? '✓' : '✗'}`).join('  ')} | settled ${Object.keys(settled).length}/${combined.length}`)

  if (activeIds.length === 0) {
    status = 'consensus'
    break
  }
}

// Final per-finding verdict: agreed ones carry the consensus disposition;
// any still-contested ones are surfaced (unresolved → human), never silently dropped.
const settledOut = combined.map((f) => {
  const s = settled[f.id]
  if (s) {
    return { id: f.id, origin: f.origin, title: f.title, location: f.location, problem: f.problem, suggestion: f.suggestion, agreed: true, disposition: s.disposition, plan: s.plan, lowy: s.lowy, hickey: s.hickey }
  }
  return { id: f.id, origin: f.origin, title: f.title, location: f.location, problem: f.problem, suggestion: f.suggestion, agreed: false, disposition: 'unresolved', plan: undefined, lowy: lowyPrev?.[f.id], hickey: hickeyPrev?.[f.id] }
})
const unresolved = settledOut.filter((s) => !s.agreed)
log(`Debate ended: ${status} after ${rounds} round(s); ${settledOut.length - unresolved.length}/${settledOut.length} settled, ${unresolved.length} unresolved.`)

// ---------------------------------------------------------------------------
// Phase 3 — apply the agreed `fix` findings, each as its own commit. Skipped
// wholesale under `apply: false`: the agreed plans are returned in `fixes` for
// the caller to implement against whatever tree it chooses.
// ---------------------------------------------------------------------------
const fixes = settledOut.filter((s) => s.agreed && s.disposition === 'fix')
const applied = []
if (apply) {
  phase('Apply')
  for (const fix of fixes) {
    const impl = await agent(implementBrief(fix), { label: `apply:${fix.id}`, phase: 'Apply', model, schema: IMPL_SCHEMA })
    const files = impl?.filesChanged ?? []
    let sha = null
    if (commit && files.length > 0) {
      const out = await commitFix(fix, files, impl.summary)
      sha = (out || '').trim()
    }
    applied.push({ id: fix.id, title: fix.title, files, commit: sha })
    log(`Applied ${fix.id}: ${files.length} file(s)${sha ? `, committed ${sha.slice(0, 9)}` : ' (uncommitted)'}`)
  }
} else if (fixes.length) {
  log(`Apply skipped (apply: false) — returning ${fixes.length} agreed fix plan(s) to the caller.`)
}

return {
  status,
  rounds,
  base,
  withPolice,
  settled: settledOut,
  unresolved,
  applied,
  // The agreed `fix` findings with their converged plans — the caller's
  // change-request payload under `apply: false` (redundant with `settled` when
  // the Apply phase ran, but always present so consumers need not re-filter).
  fixes,
  reviews: reviewByLens,
  history,
  comment: renderComment({ rounds, settledOut, unresolved, outcome: apply ? { kind: 'applied', items: applied } : { kind: 'handed-off', items: fixes }, reviewByLens, withPolice, base }),
}
