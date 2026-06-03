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
// The diff base. Resolved to the MERGE-BASE of (rawBase, HEAD) just before the
// debate (see phase 'Debate') so commits rawBase gained since the branch forked
// aren't reviewed as if this change made them. `let` because that resolution
// reassigns it; every prompt reads the resolved value. (Idempotent when the
// caller already passed a merge-base SHA, e.g. /be-review.)
let base = a.base || 'origin/master'
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
// Model tiers. The claude-author round does real reasoning (fixing/disputing
// codex's findings) → `model` (Opus). Everything else here is mechanical — the
// codex runner just shells out to codex-review.sh and copies the verdict, the
// committer stages files, the merge-base resolver runs one git command → `mechModel`
// (Haiku). Defaults match a direct invocation; /be-review passes both explicitly.
const model = a.model || 'opus'
const mechModel = a.mechModel || 'haiku'

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
    // Set by scripts/codex-review.sh ONLY when codex itself failed to produce a
    // verdict (broken/unavailable reviewer). It is the machine-detectable fatal
    // signal the loop aborts on — infrastructure failure, not a debate outcome.
    reviewerError: { type: 'boolean' },
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

// Consensus = no finding left open, any severity. The loop runs until codex
// resolves every one (CLAUDE fixed it, or codex conceded a dispute). No cap.
function openFindings(verdict) {
  return (verdict.findings || []).filter((f) => f.status !== 'resolved')
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

2. Run (cd into the repo root so the script's internal \`git diff\`/\`git status\` target THIS worktree — your shell cwd may be a different worktree):
   \`cd ${repoPath} && bash ${skillDir}/scripts/codex-review.sh ${base} ${rebuttalPath} ${verdictPath}\``
    : `1. (No prior rebuttal this round.)

2. Run (cd into the repo root so the script's internal \`git diff\`/\`git status\` target THIS worktree — your shell cwd may be a different worktree):
   \`cd ${repoPath} && bash ${skillDir}/scripts/codex-review.sh ${base} - ${verdictPath}\``

  const prompt = `You are a MECHANICAL RUNNER for one round of an automated code-review debate. Do exactly the steps below and nothing else. Do NOT review the code yourself, do NOT edit any repository files, do NOT add commentary.

First ensure the scratch dir exists: \`mkdir -p ${workDir}\`.

${rebuttalStep}

   This shells out to the codex CLI as a read-only reviewer; it can take 1-3 minutes. It prints a JSON verdict as its final stdout and also writes it to the \`-o\` path.

3. Read \`${verdictPath}\` and return its exact contents as your structured output. Copy the values faithfully; do not paraphrase or "improve" them.`

  return agent(prompt, {
    label: `codex:round${round}`,
    phase: 'Debate',
    model: mechModel, // mechanical: runs codex-review.sh + copies the verdict
    schema: CODEX_VERDICT_SCHEMA,
  })
}

async function claudeResponds(round, verdict) {
  const prompt = `You authored the changes on this branch. CODEX reviewed them and returned the verdict below — what do you think? Fix what you agree with, push back (with reasons) on what you don't.

Work in the repo at \`${repoPath}\` — your shell cwd may be a different worktree, so use ABSOLUTE paths under it and \`git -C ${repoPath}\`. See the change with \`git -C ${repoPath} diff ${base}\`.

CODEX's verdict (JSON):
${JSON.stringify(verdict, null, 2)}

Address EVERY finding, any severity (don't skip minors/nits):
  - agree → fix it in the working tree; disposition "fixed".
  - disagree → leave the code, dispute it with a specific technical reason (cite file:line); disposition "disputed". Concede when codex is right.
  - partly → fix the valid part, explain the rest; disposition "partial".

Edit the working tree only — do NOT git add/commit/push. You may run the formatter on files you touched.

Return: actions (one per finding — findingId, disposition, detail), filesChanged, and done (true once you've addressed every finding this round).`

  return agent(prompt, {
    label: `claude:round${round}`,
    phase: 'Debate',
    model, // deep reasoning: the author fixing/disputing real findings
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

3. Run (every git command uses \`git -C ${repoPath}\`, so it targets THIS worktree regardless of your shell cwd):
   \`git -C ${repoPath} add -- ${fileArgs} && git -C ${repoPath} commit -F ${msgPath}\`
   Stage ONLY those files. Do NOT use \`git add -A\` or \`git add .\`.
4. Return the new commit SHA from \`git -C ${repoPath} rev-parse HEAD\`. Do NOT push.`
  return agent(prompt, { label: `commit:round${round}`, phase: 'Debate', model: mechModel })
}

const transcript = []
// 'consensus' is the only NORMAL terminus. 'reviewer-error' is the one abnormal
// terminus: codex itself failed to produce a verdict (broken/unavailable). That
// is infrastructure failure, not a debate outcome, so it ends the loop too —
// distinct from the deliberate "no deadlock exit" for substantive disagreement.
let status = 'consensus'
let finalVerdict = null
let lastClaude = null

// ---------------------------------------------------------------------------
// The loop — runs until consensus. No round cap, no deadlock exit.
// ---------------------------------------------------------------------------
// The debate continues, round after round, until codex resolves every finding
// (any severity). No upper bound, no "deadlock" surrender: the two sides argue
// every point until one concedes. (The harness's per-workflow agent backstop is
// the only hard ceiling; interrupt via /workflows or TaskStop by hand.)
phase('Debate')

// Resolve the diff base to the merge-base of (base, HEAD) so codex reviews only
// what THIS branch changed, not commits the base branch gained since the branch
// forked (those would otherwise show up in `git diff base` — master's drift
// reviewed as ours). A thin mechanical git agent; the workflow can't run git
// itself. Idempotent when `base` is already a merge-base SHA (caller resolved it).
const rawBase = base
const baseRes = await agent(
  `You are a MECHANICAL RUNNER. Run \`git -C ${repoPath} merge-base ${base} HEAD\` and return ONLY the resulting commit SHA (hex) in \`sha\`. If the command FAILS (missing/typoed base, stale ref, unrelated history), return \`sha\`: "" and put the verbatim git error in \`error\` — do NOT fall back to the raw base ref. Do nothing else.`,
  { label: 'resolve:merge-base', phase: 'Debate', model: mechModel, schema: { type: 'object', additionalProperties: false, required: ['sha'], properties: { sha: { type: 'string', description: 'the merge-base SHA, or "" on failure' }, error: { type: 'string', description: 'the git error when sha is empty' } } } },
)
// Fail loud on a bad base. Falling back to the raw `${base}` tip would review the
// base branch's drift since the fork as if this change made it — the exact noise
// the merge-base removes — so a missing/typoed/stale base must abort, not degrade.
if (!baseRes?.sha?.trim()) {
  const err = (baseRes?.error || '').trim()
  log(`Aborting: \`git merge-base ${rawBase} HEAD\` failed; the diff scope can't be trusted. Not falling back to the raw ${rawBase} tip.`)
  return {
    status: 'merge-base-error',
    base: rawBase,
    rounds: 0,
    transcript: [],
    finalVerdict: null,
    note: `merge-base of \`${rawBase}\` and HEAD could not be resolved (missing/typoed base, stale ref, or unrelated history), so the review scope is untrustworthy. Fix the base ref (e.g. \`git fetch\`) and re-run.${err ? `\ngit error:\n${err}` : ''}`,
  }
}
base = baseRes.sha.trim()
log(`Diffing against ${base.slice(0, 12)} (merge-base of ${rawBase} and HEAD), so the base branch's drift since the fork isn't reviewed.`)

for (let round = 1; ; round++) {
  const verdict = await codexReviews(round, lastClaude ? JSON.stringify(lastClaude) : null)
  finalVerdict = verdict
  const entry = { round, codex: verdict, claude: null }
  transcript.push(entry) // record this round (mutated in place as it progresses)
  // Reviewer error — terminal failure path. The runner could not get a verdict
  // out of codex (broken/unavailable CLI), so codex-review.sh synthesized an
  // error verdict carrying reviewerError:true. There are no findings to route to
  // Claude, and retrying a broken reviewer just spins forever, so abort the
  // debate and surface the failure. This is deliberately separate from the
  // "no deadlock exit" rule, which only governs substantive disagreement.
  if (verdict.reviewerError) {
    status = 'reviewer-error'
    log(`Round ${round}: reviewer error — aborting debate. ${verdict.summary}`)
    break
  }

  const open = openFindings(verdict)
  log(`Round ${round}: codex approved=${verdict.approved}, findings open=${open.length}`)

  // Consensus requires BOTH no open finding AND codex's explicit approval. An
  // inconsistent verdict — `approved:false` with nothing open — is not consensus:
  // codex declined to approve while leaving us nothing to route to Claude, so
  // treating it as agreement would ship an unapproved change. There's no finding
  // to debate, so re-running codex would just replay the same inconsistency;
  // surface it as a reviewer error (the terminal abnormal path) instead of
  // looping forever or falsely converging.
  if (open.length === 0 && verdict.approved !== true) {
    status = 'reviewer-error'
    log(`Round ${round}: inconsistent verdict — approved=false with no open findings; aborting as reviewer-error.`)
    break
  }

  // Consensus: codex approved AND every finding resolved (any severity).
  if (open.length === 0) {
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
