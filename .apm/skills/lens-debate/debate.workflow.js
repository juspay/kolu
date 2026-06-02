// The model every lens/agent runs on. SKILL.md flags this as load-bearing
// (lenses run on Opus, overriding their `model: sonnet` frontmatter) and model
// migrations are a recurring change — keep it to one socket. `meta` is evaluated
// before inputs, so this lives module-level; the `model` input below defaults to it.
const MODEL = 'opus'

export const meta = {
  name: 'lens-debate',
  description:
    'lowy + hickey review a diff independently in parallel, then debate every finding to consensus; apply the agreed fixes',
  phases: [
    { title: 'Review', detail: 'lowy and hickey (and optionally code-police) review the diff independently, in parallel', model: MODEL },
    { title: 'Debate', detail: 'lowy and hickey cross-examine every finding until they agree per-finding', model: MODEL },
    { title: 'Apply', detail: 'implement each agreed fix as its own commit', model: MODEL },
  ],
}

// ---------------------------------------------------------------------------
// Inputs (passed via the Workflow tool's `args`)
// ---------------------------------------------------------------------------
const a = args || {}
const repoPath = a.repoPath || '.'
const base = a.base || 'origin/master'
// Safety backstop only — NOT a deadlock cap. The debate runs until consensus;
// this just keeps a pathologically oscillating debate from running unbounded.
// Hitting it is reported as `unresolved` (needs human), never `deadlock`, and
// should essentially never happen between two good-faith lenses. Raise freely.
const maxRounds = a.maxRounds || 12
// Apply agreed `fix` findings as individual commits (default on). `--no-commit`
// still applies the edits to the working tree, it just leaves them uncommitted.
const commit = a.commit !== false
// Fold in /code-police as a third, lower-weight voice: it SEEDS findings into
// the debate set but does not get a vote in consensus (only lowy ⇄ hickey do).
const withPolice = a.withPolice === true
// Optional author note on deliberate design decisions, so the lenses don't flag
// intentional choices (e.g. a deliberate fail-open). Threaded into every prompt.
const rationale = (a.rationale || '').trim()
// Model every lens/agent runs on; defaults to MODEL (see top of file). Overridable
// via args to mirror the file's input pattern and to make a model bump a one-liner.
const model = a.model || MODEL
// Per-worktree scratch for commit-message files; gitignored so it never shows up
// in the diff the lenses review, and parallel debates in different worktrees
// never collide. Only the commit-message files land here.
const workDir = `${repoPath}/.lens-debate`

// The two structural lenses that debate to consensus. code-police, when enabled,
// is appended as a finding SOURCE only — it is not a debater.
const DEBATERS = ['lowy', 'hickey']
const REVIEWERS = [
  { lens: 'lowy', framework: 'volatility-based decomposition — do boundaries encapsulate axes of change? (Lowy / Parnas)' },
  { lens: 'hickey', framework: 'structural simplicity — independent concerns complected, or one thing fragmented? (Simple Made Easy)' },
]
if (withPolice) REVIEWERS.push({ lens: 'code-police', framework: 'code quality, correctness, and common-mistake review' })

// How every agent is told to inspect the change. The lenses do NOT trust a
// curated finding list — they read the source themselves (the load-bearing
// lesson from #1109: curation biases the verdict).
const DIFF = `Inspect the FULL change in the repo at \`${repoPath}\`: run \`git diff ${base}\` (committed + unstaged) and \`git status --short\` (untracked/new files do NOT appear in the diff), then Read every new/changed file plus enough surrounding code to judge it in context. Ignore the debate's own scratch dir \`.lens-debate/\` if it appears.`

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
      description: 'your INDEPENDENT findings (≤4, high-confidence; an empty list is a fine verdict for a clean diff)',
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
          reasoning: { type: 'string', description: 'argue from the code (cite file:line); concede explicitly when the other lens is right' },
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
function reviewBrief(lens, framework) {
  return `You are the **${lens}** reviewer. First Read \`.claude/skills/${lens}/SKILL.md\` for your framework, then ${DIFF}

Review the change through the **${framework}** lens, INDEPENDENTLY — you are NOT seeing any other reviewer's findings. That independence is the whole point: being handed someone else's curated finding biases the verdict.
${rationaleBlock}
Emit your own findings (≤4, high-confidence). Each: a title, a file:line location, the problem in your lens's terms, a concrete suggestion, and a disposition — \`fix\` (worth changing in THIS PR) or \`drop\` (observation only). Do not invent issues to look thorough: an empty list, or all-drop, is a fine verdict for a clean diff.`
}

function findingLine(f) {
  return `### ${f.id} (raised by ${f.origin}) — ${f.title}\n  at ${f.location}; raiser's disposition: ${f.disposition}\n  problem: ${f.problem}\n  suggestion: ${f.suggestion}`
}

function debateBrief(lens, opp, activeFindings, oppPos, settledList, roundNum) {
  const settledNote = settledList.length
    ? `\nALREADY SETTLED (you both agreed — do NOT relitigate, shown for context only):\n${settledList.map((s) => `- ${s.id}: ${s.disposition}`).join('\n')}\n`
    : ''
  const oppBlock = oppPos
    ? `**${opp}'s positions to rebut or concede, point by point:**\n${JSON.stringify(oppPos, null, 2)}`
    : `Round 1 — give your initial disposition on every contested finding below, including ${opp}'s and any from other reviewers.`
  return `You are **${lens}**, cross-examining **${opp}** to reach agreement. First Read \`.claude/skills/${lens}/SKILL.md\` for your framework, then ${DIFF} Ground every call in the source.
${rationaleBlock}
CONTESTED findings — disposition EVERY one (yours, ${opp}'s, and any from other reviewers):
${activeFindings.map(findingLine).join('\n\n')}
${settledNote}
${oppBlock}

Round ${roundNum}. For EVERY contested finding id above, output a disposition (\`fix\` = worth changing in THIS PR / \`drop\` = leave as-is, observation only), a concrete implementable plan if \`fix\`, and reasoning grounded in the code. **The goal is the correct answer for THIS PR, not winning** — concede explicitly ("conceding: …") when ${opp}'s code-grounded argument is right. A \`fix\` is worth it only if it genuinely improves the PR.`
}

function implementBrief(fix) {
  return `You are implementing ONE change that two structural-review lenses (lowy and hickey) independently agreed should be fixed in THIS PR. Work in the repo at \`${repoPath}\`.

Finding ${fix.id} (raised by ${fix.origin}) — ${fix.title}
  at ${fix.location}
  problem: ${fix.problem}
  agreed plan: ${fix.plan || '(implement the agreed fix described above)'}

Make ONLY this change in the working tree. Keep it tightly scoped to the finding; read the surrounding code first so the edit fits the existing style. Do NOT git add / commit / push. You may run the project's formatter on files you touched. Return a one-line summary and the exact list of files you changed.`
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
  const message = `refactor: lens-debate — ${fix.title}

${summary}

Agreed by the lowy ⇄ hickey lens debate (finding ${fix.id}, raised by ${fix.origin}). Not pushed or merged.`
  const prompt = `You are a MECHANICAL COMMITTER. Do exactly these steps and nothing else — do not edit files, do not push, do not stage anything beyond the listed files.

1. Ensure the scratch dir exists: \`mkdir -p ${workDir}\`.
2. Using the Write tool, create \`${msgPath}\` with EXACTLY this content:

${message}

3. Run, from the repo root \`${repoPath}\`:
   \`git add -- ${fileArgs} && git commit -F ${msgPath}\`
   Stage ONLY those files. Do NOT use \`git add -A\` or \`git add .\`.
4. Return the new commit SHA from \`git rev-parse HEAD\`. Do NOT push.`
  return agent(prompt, { label: `commit:${fix.id}`, phase: 'Apply' })
}

// ---------------------------------------------------------------------------
// Phase 1 — independent parallel review
// ---------------------------------------------------------------------------
phase('Review')

const reviews = await parallel(
  REVIEWERS.map((r) => () =>
    agent(reviewBrief(r.lens, r.framework), { label: `review:${r.lens}`, phase: 'Review', model, schema: FINDINGS_SCHEMA }),
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
  return { status: 'clean', rounds: 0, base, withPolice, note: 'every lens found nothing worth raising', settled: [], unresolved: [], applied: [], reviews: reviewByLens, history: [] }
}

// ---------------------------------------------------------------------------
// Phase 2 — debate to consensus. NO deadlock exit: the loop runs until every
// finding is agreed. Agreed findings LOCK (leave the active set), so the
// contested set is monotonically non-increasing — the debate can only shrink.
// Sequential reveal (lowy posts, hickey answers lowy's CURRENT positions) lets
// the two land together rather than chase each other's stale positions.
// ---------------------------------------------------------------------------
phase('Debate')

const settled = {} // id -> { disposition, plan, lowy, hickey }
let activeIds = combined.map((f) => f.id)
let lowyPrev = null
let hickeyPrev = null
const history = []
let status = 'unresolved'
let rounds = 0

for (let r = 1; r <= maxRounds && activeIds.length > 0; r++) {
  rounds = r
  const activeFindings = combined.filter((f) => activeIds.includes(f.id))
  const settledList = Object.entries(settled).map(([id, s]) => ({ id, disposition: s.disposition }))

  const lowyRes = await agent(debateBrief('lowy', 'hickey', activeFindings, hickeyPrev, settledList, r), {
    label: `lowy:round${r}`,
    phase: 'Debate',
    model,
    schema: POSITION_SCHEMA,
  })
  const lowyPos = posMap(lowyRes)

  const hickeyRes = await agent(debateBrief('hickey', 'lowy', activeFindings, lowyPos, settledList, r), {
    label: `hickey:round${r}`,
    phase: 'Debate',
    model,
    schema: POSITION_SCHEMA,
  })
  const hickeyPos = posMap(hickeyRes)
  lowyPrev = lowyPos
  hickeyPrev = hickeyPos

  const per = []
  for (const id of [...activeIds]) {
    const l = lowyPos[id]
    const h = hickeyPos[id]
    const agreed = !!(l && h && l.disposition === h.disposition)
    per.push({ id, lowy: l?.disposition ?? '?', hickey: h?.disposition ?? '?', agreed })
    if (agreed) {
      settled[id] = { disposition: l.disposition, plan: l.disposition === 'fix' ? l.plan || h.plan : undefined, lowy: l, hickey: h }
      activeIds = activeIds.filter((x) => x !== id)
    }
  }
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
    return { id: f.id, origin: f.origin, title: f.title, location: f.location, problem: f.problem, agreed: true, disposition: s.disposition, plan: s.plan, lowy: s.lowy, hickey: s.hickey }
  }
  return { id: f.id, origin: f.origin, title: f.title, location: f.location, problem: f.problem, agreed: false, disposition: 'unresolved', plan: undefined, lowy: lowyPrev?.[f.id], hickey: hickeyPrev?.[f.id] }
})
const unresolved = settledOut.filter((s) => !s.agreed)
log(`Debate ended: ${status} after ${rounds} round(s); ${settledOut.length - unresolved.length}/${settledOut.length} settled, ${unresolved.length} unresolved.`)

// ---------------------------------------------------------------------------
// Phase 3 — apply the agreed `fix` findings, each as its own commit
// ---------------------------------------------------------------------------
phase('Apply')

const fixes = settledOut.filter((s) => s.agreed && s.disposition === 'fix')
const applied = []
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

return { status, rounds, base, withPolice, settled: settledOut, unresolved, applied, reviews: reviewByLens, history }
