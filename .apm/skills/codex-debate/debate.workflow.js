export const meta = {
  name: 'codex-debate',
  description: 'Run a codex<->claude review debate on the current diff until they reach consensus (no round cap, no deadlock exit)',
  phases: [
    { title: 'Debate', detail: 'codex reviews -> claude responds, round after round' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs (passed via the Workflow tool's `args`)
// ---------------------------------------------------------------------------
const a = args || {}
const repoPath = a.repoPath || '.'
const base = a.base || 'origin/master'
// Where the generated skill lives, so the codex runner can find codex-review.sh.
const skillDir = a.skillDir || '.claude/skills/codex-debate'
// Per-worktree scratch dir for rebuttal/verdict files. Derived from repoPath
// (the worktree root === $PWD) so parallel debates in DIFFERENT worktrees never
// collide on shared /tmp paths, and `.codex-debate/` is gitignored so these
// files never pollute the diff codex reviews.
const workDir = `${repoPath}/.codex-debate`
// Commit each round's changes individually (default on). The commit message
// carries the debate context (codex's findings + claude's dispositions). Never
// pushes or merges — that stays the human's call.
const commit = a.commit !== false

// ---------------------------------------------------------------------------
// Schemas — the codex verdict schema mirrors scripts/codex-verdict.schema.json
// so the runner agent returns the same shape codex was constrained to.
// ---------------------------------------------------------------------------
const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
    location: { type: 'string' },
    issue: { type: 'string' },
    suggestion: { type: 'string' },
    status: { type: 'string', enum: ['open', 'resolved'] },
  },
  required: ['id', 'severity', 'location', 'issue', 'suggestion', 'status'],
}

const CODEX_VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    approved: { type: 'boolean' },
    summary: { type: 'string' },
    findings: { type: 'array', items: FINDING },
    responseToRebuttal: { type: 'string' },
  },
  required: ['approved', 'summary', 'findings', 'responseToRebuttal'],
}

const CLAUDE_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          findingId: { type: 'string' },
          disposition: { type: 'string', enum: ['fixed', 'disputed', 'partial'] },
          detail: { type: 'string' },
        },
        required: ['findingId', 'disposition', 'detail'],
      },
    },
    filesChanged: { type: 'array', items: { type: 'string' } },
    done: { type: 'boolean' },
  },
  required: ['summary', 'actions', 'filesChanged', 'done'],
}

// ---------------------------------------------------------------------------
// Consensus helper
// ---------------------------------------------------------------------------
// A finding still "counts against" consensus only if it is open AND
// blocking/major. Minor issues and nits never block agreement. Consensus is the
// ONLY terminal state — there is no round cap and no deadlock exit, so the loop
// runs until codex approves with nothing blocking/major open. The debate is
// pointless if it bails to "deadlock"; the two sides must argue it out until
// one concedes.
function blockingOpen(verdict) {
  return (verdict.findings || []).filter(
    (f) => f.status !== 'resolved' && (f.severity === 'blocking' || f.severity === 'major'),
  )
}

// ---------------------------------------------------------------------------
// The two debaters
// ---------------------------------------------------------------------------
async function codexReviews(round, rebuttalJson) {
  const verdictPath = `${workDir}/verdict-${round}.json`
  const rebuttalPath = `${workDir}/rebuttal.json`
  const rebuttalStep = rebuttalJson
    ? `1. Using the Write tool (NOT a shell heredoc — the content has special characters), create the file \`${rebuttalPath}\` with exactly this content:

${rebuttalJson}

2. Run, from the repo root \`${repoPath}\`:
   \`bash ${skillDir}/scripts/codex-review.sh ${base} ${rebuttalPath} ${verdictPath}\``
    : `1. (No prior rebuttal this round.)

2. Run, from the repo root \`${repoPath}\`:
   \`bash ${skillDir}/scripts/codex-review.sh ${base} - ${verdictPath}\``

  const prompt = `You are a MECHANICAL RUNNER for one round of an automated code-review debate. Do exactly the steps below and nothing else. Do NOT review the code yourself, do NOT edit any repository files, do NOT add commentary.

First ensure the scratch dir exists: \`mkdir -p ${workDir}\`.

${rebuttalStep}

   This shells out to the codex CLI as a read-only reviewer; it can take 1-3 minutes. It prints a JSON verdict as its final stdout and also writes it to the \`-o\` path.

3. Read \`${verdictPath}\` and return its exact contents as your structured output. Copy the values faithfully; do not paraphrase or "improve" them.`

  return agent(prompt, {
    label: `codex:round${round}`,
    phase: 'Debate',
    schema: CODEX_VERDICT_SCHEMA,
  })
}

async function claudeResponds(round, verdict) {
  const prompt = `You are CLAUDE, the engineer who authored the changes now under review, in an automated review debate with CODEX (a rigorous senior reviewer). Work in the repository at \`${repoPath}\`. The change under review is the working-tree diff against \`${base}\` — inspect it with \`git diff ${base}\` and read surrounding code as needed.

CODEX's latest verdict (JSON):
${JSON.stringify(verdict, null, 2)}

For EACH finding:
  - If you AGREE: fix it now by editing the code in the working tree (use your editing tools). Record disposition "fixed".
  - If you DISAGREE: do NOT change the code. Record disposition "disputed" with a specific, technical reason citing file:line or the actual behavior. Concede when codex is right — do not dispute merely to win.
  - If PARTIALLY right: fix the valid part, explain the rest. Record "partial".

Constraints:
  - Edit the WORKING TREE only. Do NOT git add / commit / push, and do NOT create or modify a PR.
  - You may run a trivial formatter on files you changed if the project has one.
  - Keep fixes tightly scoped to the findings.

Then return your structured response:
  - actions: one per finding you addressed (findingId, disposition, detail).
  - filesChanged: every working-tree file you edited this round.
  - done: true ONLY if nothing further should change — i.e. everything valid is fixed and you stand by any remaining disputes. If you fixed things and want codex to re-check, that is still done=true (codex re-reviews next round regardless).`

  return agent(prompt, {
    label: `claude:round${round}`,
    phase: 'Debate',
    schema: CLAUDE_RESPONSE_SCHEMA,
  })
}

// Commit message for one debate round, carrying the debate context: what codex
// raised and how claude dispositioned each finding.
function roundCommitMessage(round, verdict, response) {
  const findings = (verdict.findings || [])
    .map((f) => `- [${f.id} · ${f.severity}] ${f.issue} (${f.location})`)
    .join('\n')
  const actions = (response.actions || [])
    .map((act) => `- ${act.findingId} ${act.disposition}: ${act.detail}`)
    .join('\n')
  return `fix: codex review — debate round ${round}

${response.summary}

codex (round ${round}) findings:
${findings || '- (none)'}

claude:
${actions || '- (no actions)'}

Committed by the codex<->claude debate (round ${round}); not pushed or merged.`
}

// Commit exactly the files claude changed this round, with the debate-context
// message. A thin mechanical agent: the workflow can't run git itself.
async function commitRound(round, files, message) {
  const fileArgs = files.map((f) => `'${f.replace(/'/g, `'\\''`)}'`).join(' ')
  const msgPath = `${workDir}/commit-msg-${round}.txt`
  const prompt = `You are a MECHANICAL COMMITTER. Do exactly these steps and nothing else — do not edit files, do not push, do not stage anything beyond the listed files.

1. Ensure the scratch dir exists: \`mkdir -p ${workDir}\`.
2. Using the Write tool, create \`${msgPath}\` with EXACTLY this content:

${message}

3. Run, from the repo root \`${repoPath}\`:
   \`git add -- ${fileArgs} && git commit -F ${msgPath}\`
   Stage ONLY those files. Do NOT use \`git add -A\` or \`git add .\`.
4. Return the new commit SHA from \`git rev-parse HEAD\`. Do NOT push.`
  return agent(prompt, { label: `commit:round${round}`, phase: 'Debate' })
}

const transcript = []
const status = 'consensus' // the ONLY way this loop ends
let finalVerdict = null
let lastClaude = null

// ---------------------------------------------------------------------------
// The loop — runs until consensus. No round cap, no deadlock exit.
// ---------------------------------------------------------------------------
// The debate continues, round after round, until codex approves with nothing
// blocking/major open. There is deliberately no upper bound and no early
// "deadlock" surrender: a debate that quits without agreement defeats the
// purpose, so the two sides keep arguing until one concedes. (The harness's own
// per-workflow agent backstop is the only hard ceiling; interrupt via
// /workflows or TaskStop if you ever need to stop one by hand.)
phase('Debate')

for (let round = 1; ; round++) {
  const verdict = await codexReviews(round, lastClaude ? JSON.stringify(lastClaude) : null)
  finalVerdict = verdict
  const entry = { round, codex: verdict, claude: null }
  transcript.push(entry) // record this round (mutated in place as it progresses)
  const blocking = blockingOpen(verdict)
  log(`Round ${round}: codex approved=${verdict.approved}, blocking/major open=${blocking.length}`)

  // Consensus — the only exit: codex is satisfied and nothing blocking/major
  // remains open.
  if (verdict.approved && blocking.length === 0) {
    break
  }

  // Claude responds: fixes what it agrees with (editing the tree), disputes the rest.
  const response = await claudeResponds(round, verdict)
  entry.claude = response
  lastClaude = response
  log(
    `Round ${round}: claude done=${response.done}, actions=${(response.actions || []).length}, files=${(response.filesChanged || []).length}`,
  )

  // Commit this round individually so the PR history reads as the debate
  // itself — one commit per round, message carrying codex's findings and
  // claude's dispositions. Only when claude actually changed files.
  if (commit && (response.filesChanged || []).length > 0) {
    const sha = await commitRound(round, response.filesChanged, roundCommitMessage(round, verdict, response))
    entry.commit = (sha || '').trim()
    log(`Round ${round}: committed ${entry.commit}`)
  }
}

const filesChanged = Array.from(
  new Set(transcript.flatMap((e) => (e.claude && e.claude.filesChanged) || [])),
)
log(`Debate ended: ${status} after ${transcript.length} round(s); ${filesChanged.length} file(s) changed.`)

return { status, rounds: transcript.length, base, finalVerdict, filesChanged, transcript }
