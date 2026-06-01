export const meta = {
  name: 'codex-debate',
  description: 'Run a codex<->claude review debate on the current diff until consensus, deadlock, or max rounds',
  phases: [
    { title: 'Debate', detail: 'codex reviews -> claude responds, round after round' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs (passed via the Workflow tool's `args`)
// ---------------------------------------------------------------------------
const a = args || {}
const repoPath = a.repoPath || '.'
const base = a.base || 'master'
const maxRounds = a.maxRounds || 5
// Where the generated skill lives, so the codex runner can find codex-review.sh.
const skillDir = a.skillDir || '.claude/skills/codex-debate'
// Per-worktree scratch dir for rebuttal/verdict/transcript files. Derived from
// repoPath (the worktree root === $PWD) so parallel debates in DIFFERENT
// worktrees never collide on shared /tmp paths, and `.codex-debate/` is
// gitignored so these files never pollute the diff codex reviews.
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
// Consensus / deadlock helpers
// ---------------------------------------------------------------------------
// A finding still "counts against" consensus only if it is open AND
// blocking/major. Minor issues and nits never block agreement.
function blockingOpen(verdict) {
  return (verdict.findings || []).filter(
    (f) => f.status !== 'resolved' && (f.severity === 'blocking' || f.severity === 'major'),
  )
}

// Signature of the blocking set, used to detect a stalled debate (codex keeps
// raising the same issues while claude keeps disputing them).
function blockingSignature(verdict) {
  return blockingOpen(verdict)
    .map((f) => `${f.location || ''}|${(f.issue || '').slice(0, 80)}`)
    .sort()
    .join('\n')
}

function claudeDisputedEverything(resp) {
  return (
    resp &&
    Array.isArray(resp.actions) &&
    resp.actions.length > 0 &&
    resp.actions.every((act) => act.disposition === 'disputed')
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

// ---------------------------------------------------------------------------
// Live HTML rendering. The transcript is re-rendered after every state change
// (each codex verdict and each claude round) so htmlOut updates in REAL TIME —
// open it to watch the debate unfold — plus a final pass stamping the terminal
// status. htmlOut defaults to a committable repo-root file (NOT the gitignored
// scratch dir), so it can be reviewed and committed. Best-effort: a render
// hiccup must never fail the debate.
// ---------------------------------------------------------------------------
const htmlOut = a.htmlOut || `${repoPath}/codex-debate-transcript.html`
const transcriptJsonPath = `${workDir}/transcript.json`

const transcript = []
let status = 'max-rounds'
let finalVerdict = null
let lastClaude = null
let prevSignature = null

async function renderTranscript(statusVal, label) {
  const fc = Array.from(new Set(transcript.flatMap((e) => (e.claude && e.claude.filesChanged) || [])))
  const snapshot = { status: statusVal, rounds: transcript.length, base, finalVerdict, filesChanged: fc, transcript }
  const prompt = `You are a MECHANICAL RENDERER. Do exactly these steps and nothing else — do not edit any repository files, do not add commentary.

1. Ensure the scratch dir exists: \`mkdir -p ${workDir}\`.
2. Using the Write tool, create \`${transcriptJsonPath}\` with EXACTLY this content (copy it verbatim):

${JSON.stringify(snapshot, null, 2)}

3. Run, from the repo root \`${repoPath}\`:
   \`node ${skillDir}/scripts/render-debate.mjs ${transcriptJsonPath} ${htmlOut}\`
   (the renderer creates the output's parent directory itself.)

Return only "rendered".`
  try {
    return await agent(prompt, { label, phase: 'Render' })
  } catch (e) {
    log(`render (${label}) failed, continuing debate: ${e}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------
phase('Debate')

for (let round = 1; round <= maxRounds; round++) {
  const verdict = await codexReviews(round, lastClaude ? JSON.stringify(lastClaude) : null)
  finalVerdict = verdict
  const entry = { round, codex: verdict, claude: null }
  transcript.push(entry) // push immediately so the live renders include this round
  const blocking = blockingOpen(verdict)
  log(`Round ${round}: codex approved=${verdict.approved}, blocking/major open=${blocking.length}`)
  await renderTranscript('in-progress', `render:r${round}-codex`) // live update: codex verdict in

  // Consensus: codex is satisfied and nothing blocking/major remains open.
  if (verdict.approved && blocking.length === 0) {
    status = 'consensus'
    break
  }

  // Deadlock: the blocking set is identical to last round AND claude disputed
  // everything last round (so nothing changed and nothing will). Stop and let
  // the human adjudicate rather than burn rounds.
  const signature = blockingSignature(verdict)
  if (prevSignature !== null && signature === prevSignature && claudeDisputedEverything(lastClaude)) {
    status = 'deadlock'
    break
  }
  prevSignature = signature

  // Last round budget spent — record codex's final verdict, don't ask claude
  // to edit with no re-review to follow.
  if (round === maxRounds) {
    status = 'max-rounds'
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

  await renderTranscript('in-progress', `render:r${round}-claude`) // live update: claude round in
}

const filesChanged = Array.from(
  new Set(transcript.flatMap((e) => (e.claude && e.claude.filesChanged) || [])),
)
log(`Debate ended: ${status} after ${transcript.length} round(s); ${filesChanged.length} file(s) changed.`)

// Final render stamps the terminal status (consensus / deadlock / max-rounds).
phase('Render')
await renderTranscript(status, 'render:final')

return { status, rounds: transcript.length, base, finalVerdict, filesChanged, transcript, htmlOut }
