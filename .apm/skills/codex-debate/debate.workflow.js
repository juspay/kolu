export const meta = {
  name: 'codex-debate',
  description: 'Run a codex<->claude review debate on the current diff until they reach consensus within a tight round backstop — unresolved is surfaced honestly, never papered over',
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
// POSIX single-quote a path for safe interpolation into a shell command. Wraps
// in single quotes (so spaces, globs, and shell metacharacters are inert) and
// escapes any embedded single quote via the '\'' idiom. Used for the one
// DESTRUCTIVE command (the ledger `rm -f` below); the benign `mkdir -p` prompts
// elsewhere can tolerate an unquoted path, but a mistargeted `rm -f` cannot.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
// The debate is recorded as one small Markdown file PER ROUND (`section-NNN.md`,
// written under the gitignored scratch dir) — the claude author reads them as its
// cross-round memory (full history, no inline blob). The PR comment is rendered
// from the SAME per-round sections in-process (see renderLedger) and returned as
// `comment`, so the published summary and the author's context are one record —
// deterministic, never re-rendered through an agent (nothing weak ever retypes a
// large blob). codex is NOT a reader: it keeps its own warm session, so re-feeding
// it the ledger would just duplicate what it already remembers.
// Commit each round's changes individually (default on). The commit message
// carries the debate context (codex's findings + claude's dispositions). Never
// pushes or merges — that stays the human's call.
const commit = a.commit !== false
// Round backstop. Tight by design: the literature on multi-agent debate shows
// gains saturate by round 2 and extra rounds amplify bias toward unanimous-WRONG
// consensus (see the review-orchestration Atlas note); kolu#1222 is the in-house
// runaway this prevents. Hitting the backstop ends the debate as `unresolved` —
// a real outcome surfaced honestly for a human (/be-review adjudicates the
// still-open findings) — never a falsely-reported consensus.
const maxRounds = a.maxRounds || 3
// Model tiers. The claude-author round does real reasoning (fixing/disputing
// codex's findings) → `model` (Opus). Everything else here is mechanical — the
// codex runner just shells out to codex-review.sh and copies the verdict, the
// committer stages files, the merge-base resolver runs one git command → `mechModel`
// (Haiku). Defaults match a direct invocation; /be-review passes both explicitly.
const model = a.model || 'opus'
const mechModel = a.mechModel || 'haiku'
// Fidelity tier (Sonnet). One "mechanical" job isn't a trivial command but a
// faithful COPY: the codex runner reads codex's verdict JSON off disk and must
// return it byte-for-byte. A paraphrase silently corrupts the debate (and schema
// validation checks the verdict's SHAPE, not its wording), and Haiku is the
// weakest tier for verbatim reproduction — so the verdict relay runs a notch up.
// Still far cheaper/faster than Opus; the real reviewing is codex's, not this
// agent's. The small per-round section writes stay on Haiku (tiny payloads).
const copyModel = a.copyModel || 'sonnet'

// The reasoning effort codex runs at, TIERED by round: `xhigh` for the round-1
// full review (where depth pays — kolu#97-class evidence says high+ is where
// codex finds real issues), `high` for follow-up rounds (which only close out
// findings already on the table — xhigh-every-round was the kolu#1222 cost
// runaway). These constants are the SINGLE home for the values: effortFor() is
// passed script-ward per round (a 4th positional arg to codex-review.sh, which
// sets `-c model_reasoning_effort`) and REASONING_EFFORT_LABEL is read by
// ledgerHeader for the published comment, so the `-c` flag and the header both
// derive from here — no literal repeated across files held together by
// "remember to update all of them".
const REASONING_EFFORT_R1 = 'xhigh'
const REASONING_EFFORT_LATER = 'high'
const effortFor = (round) => (round === 1 ? REASONING_EFFORT_R1 : REASONING_EFFORT_LATER)
const REASONING_EFFORT_LABEL = `${REASONING_EFFORT_R1} (round 1), ${REASONING_EFFORT_LATER} thereafter`

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
    // codex's cited reason when it resolves a finding by ACCEPTING the author's
    // dispute (no code change) — "" otherwise. Required in the codex-side
    // schema (codex-verdict.schema.json must keep every declared property in
    // `required` for strict structured outputs, so codex always emits it);
    // optional here so the relay tolerates shape drift between the two
    // mirrored schemas or a codex build that doesn't strictly enforce
    // --output-schema. (The lib's synthesized error verdict is unaffected
    // either way — it carries `findings: []`, so the per-item rules are
    // vacuous for it.)
    concession: { type: 'string' },
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
          concessionReason: {
            type: 'string',
            description:
              'REQUIRED when you now fix (or stop disputing) a finding you DISPUTED in a previous round: the specific code or codex argument that changed your mind. Omit when holding your position or on round 1.',
          },
        },
        required: ['findingId', 'disposition', 'detail'],
      },
    },
    filesChanged: { type: 'array', items: { type: 'string' } },
    done: { type: 'boolean' },
  },
  required: ['summary', 'actions', 'filesChanged', 'done'],
}

// Consensus = no finding left open, any severity — codex resolved every one
// (CLAUDE fixed it, or codex conceded a dispute, citing why). Findings still
// open at the round backstop end the debate as `unresolved` instead.
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
   \`cd ${repoPath} && bash ${skillDir}/scripts/codex-review.sh ${base} ${rebuttalPath} ${verdictPath} ${effortFor(round)}\``
    : `1. (No prior rebuttal this round.)

2. Run (cd into the repo root so the script's internal \`git diff\`/\`git status\` target THIS worktree — your shell cwd may be a different worktree):
   \`cd ${repoPath} && bash ${skillDir}/scripts/codex-review.sh ${base} - ${verdictPath} ${effortFor(round)}\``

  const prompt = `You are a MECHANICAL RUNNER for one round of an automated code-review debate. Do exactly the steps below and nothing else. Do NOT review the code yourself, do NOT edit any repository files, do NOT add commentary.

First ensure the scratch dir exists: \`mkdir -p ${workDir}\`.

${rebuttalStep}

   This shells out to the codex CLI as a read-only reviewer; it can take 1-3 minutes. It prints a JSON verdict as its final stdout and also writes it to the \`-o\` path.

3. Read \`${verdictPath}\` and return its exact contents as your structured output. Copy the values faithfully; do not paraphrase or "improve" them.`

  return agent(prompt, {
    label: `codex:round${round}`,
    phase: 'Debate',
    model: copyModel, // not trivial: must relay codex's verdict JSON faithfully
    schema: CODEX_VERDICT_SCHEMA,
  })
}

async function claudeResponds(round, verdict) {
  // WARM AUTHOR. We can't truly resume the Claude author (agent() is one-shot,
  // and Claude isn't headless under Max auth, so there's no session to resume the
  // way `codex exec resume` carries codex's reasoning forward). The achievable
  // equivalent is context, not state: every follow-up round the author reads the
  // per-round section files — the record of every prior round's findings and its
  // OWN dispositions — and builds on them instead of re-deriving the diff. A
  // section is written after each round (see the loop), so on round N>1 the files
  // already hold rounds 1..N-1. Round 1 has none yet, so its prompt is
  // byte-identical to a cold start.
  const priorBlock =
    round > 1
      ? `This is a FOLLOW-UP round. Every prior round is recorded as a small Markdown file under the debate's scratch dir — read them FIRST for the full history (codex's past findings and YOUR own dispositions):
  \`cat ${workDir}/section-*.md\`   (or Read them individually; if none exist, fall back to the diff + the verdict below)
Build on what you already did; don't re-derive the diff from scratch, and don't re-fix or re-litigate anything already settled. For any finding you DISPUTED, check codex's \`responseToRebuttal\` in the verdict below: if codex conceded, you're done with it; if codex held firm, weigh its reasoning and either fix it or hold with a sharper argument. Spend this round on findings still \`open\` plus any new ones.

`
      : ''
  const prompt = `You authored the changes on this branch. CODEX reviewed them and returned the verdict below — what do you think? Fix what you agree with, push back (with reasons) on what you don't.

Work in the repo at \`${repoPath}\` — your shell cwd may be a different worktree, so use ABSOLUTE paths under it and \`git -C ${repoPath}\`. See the change with \`git -C ${repoPath} diff ${base}\`.

${priorBlock}CODEX's verdict (JSON):
${JSON.stringify(verdict, null, 2)}

Address EVERY finding, any severity (don't skip minors/nits):
  - agree → fix it in the working tree; disposition "fixed".
  - disagree → leave the code, dispute it with a specific technical reason (cite file:line); disposition "disputed". Concede when codex is right.
  - partly → fix the valid part, explain the rest; disposition "partial".

**Concessions must be cited.** If you now fix (or stop disputing) a finding you DISPUTED in a previous round, set \`concessionReason\` to the specific code or codex argument that changed your mind. Conceding just to end the debate is forbidden — an unconvinced "fixed" ships a change nobody believes in; hold the dispute instead and let the round backstop surface it to a human.

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
// raised and how claude dispositioned each finding. It reuses the same per-bullet
// projection as the ledger section (findingBullet/actionBullet), in `plain` chrome
// — no backticks/bold and no `status` field — so the round summary derives from a
// single rendering rather than two parallel ones.
function roundCommitMessage(round, verdict, response) {
  const findings = (verdict.findings || [])
    .map((f) => findingBullet(f, { plain: true }))
    .join('\n')
  const actions = (response.actions || [])
    .map((a) => actionBullet(a, { plain: true }))
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

// ---------------------------------------------------------------------------
// The shared ledger — rendered from the transcript, deterministically
// ---------------------------------------------------------------------------
// One codex finding as a Markdown bullet. The single projection of a finding's
// fields, shared by the ledger section and the round commit message. `plain` drops
// the ledger chrome (backticks + the `status` field) for the commit message, which
// wants plainer text; the field access stays in one place either way.
function findingBullet(f, { plain = false } = {}) {
  // A non-empty `concession` means codex resolved this finding by ACCEPTING the
  // author's dispute — the cited reason is part of the trail, in both chromes.
  const conceded = (f.concession || '').trim() ? ` — conceded: ${f.concession.trim()}` : ''
  return plain
    ? `- [${f.id} · ${f.severity}] ${f.issue} (${f.location})${conceded}`
    : `- \`${f.id}\` · ${f.severity} · ${f.status} — ${f.issue} (${f.location})${conceded}`
}

// One author disposition as a Markdown bullet. The single projection of an action's
// fields, shared by the ledger section and the round commit message. `plain` drops
// the ledger chrome (backticks + bold) for the commit message.
function actionBullet(a, { plain = false } = {}) {
  // A non-empty `concessionReason` marks a cited cross-round flip (the author
  // stopped disputing for a stated reason) — part of the trail, in both chromes.
  const conceded = (a.concessionReason || '').trim() ? ` — conceded: ${a.concessionReason.trim()}` : ''
  return plain
    ? `- ${a.findingId} ${a.disposition}: ${a.detail}${conceded}`
    : `- \`${a.findingId}\` **${a.disposition}** — ${a.detail}${conceded}`
}

// One round's findings, as a Markdown list. Shared by the section renderer below.
function renderFindings(verdict) {
  const list = (verdict.findings || []).map((f) => findingBullet(f)).join('\n')
  return list || '- _(none)_'
}

// One round's author dispositions, as a Markdown list. `null` on a terminal round
// (codex approved or errored before the author got a turn).
function renderActions(response) {
  if (!response) return '_(no author turn — the debate ended this round)_'
  const list = (response.actions || []).map((a) => actionBullet(a)).join('\n')
  return list || '- _(no actions)_'
}

// One round as a Markdown section: codex's verdict, its response to the rebuttal,
// and the author's dispositions + commit. The single per-round renderer — the
// author reads these as its memory and they compose into the posted comment.
function roundLedgerSection(entry) {
  const { round, codex, claude, commit } = entry
  const lines = [
    `### Round ${round}`,
    '',
    `**codex** — approved: \`${codex.approved}\``,
    '',
    codex.summary,
    '',
    'Findings:',
    renderFindings(codex),
  ]
  if (codex.responseToRebuttal) lines.push('', `_codex on the rebuttal:_ ${codex.responseToRebuttal}`)
  lines.push('', `**claude** — ${claude ? claude.summary : '_(no author turn this round)_'}`, '', renderActions(claude))
  if (commit) lines.push('', `commit: \`${commit}\``)
  return lines.join('\n')
}

// The comment header (small). The full comment is this header followed by the
// per-round section files (see renderLedger). The workflow renders the whole
// comment deterministically from the transcript — no agent ever retypes the blob.
//
// This header's chrome (the `## ` title, the badge, the `base.slice(0, 12)`) is
// deliberately kept STRUCTURALLY PARALLEL to lens-debate's renderComment header
// chrome. The no-module workflow runtime has no imports, so a truly shared
// renderer isn't available; the two are instead siblings that move together. A
// house-style change (badge emoji, base-slice length, a new metadata row) is a
// mechanical mirror edit — make it here and in lens-debate's renderComment. If
// the runtime ever admits a shared helper file, lift this common chrome there.
function ledgerHeader(meta) {
  const badge = meta.status === 'consensus' ? '✅ **Consensus**' : `⚠️ **${meta.status}**`
  return `## Codex ⇄ Claude debate\n\n${badge} after ${meta.rounds} round(s) · codex reviewed at \`${meta.reasoningEffort}\` reasoning effort · base \`${(meta.base || '').slice(0, 12)}\``
}

// The whole PR comment, rendered deterministically in-process from the transcript:
// the outcome header followed by each round's Markdown section. The per-round
// section files on disk remain the author's cross-round memory (see writeSection);
// this re-uses the SAME `roundLedgerSection` renderer to assemble the published
// comment, so the orchestrator posts a ready string (`gh pr comment -F`) exactly
// the way lens-debate does — no bespoke `cat` glob at the consumer, and nothing
// weak ever retypes a large blob (the workflow builds the string itself).
function renderLedger(transcript, meta) {
  return [ledgerHeader(meta), ...transcript.map(roundLedgerSection)].join('\n\n')
}

// Zero-pad the round so the section glob (`section-*.md`) sorts in round order
// (section-002 before section-010) for both the author's read and the assembly.
const sectionFile = (round) => `${workDir}/section-${String(round).padStart(3, '0')}.md`

// Write ONE round's section to its own small file — the author reads these as its
// cross-round memory, and the orchestrator cats them into the posted comment. A
// thin mechanical agent (the workflow can't do file I/O), but the payload is just
// this round, so it stays small and Haiku-safe — no whole-ledger retype, and
// rewriting a round's own file is idempotent (safe on a resume).
async function writeSection(entry) {
  const text = roundLedgerSection(entry)
  const path = sectionFile(entry.round)
  const prompt = `You are a MECHANICAL WRITER. Do exactly these steps and nothing else — do not edit any other file, do not run git, do not add commentary.

1. Ensure the scratch dir exists: \`mkdir -p ${workDir}\`.
2. Using the Write tool, create \`${path}\` with EXACTLY this content, overwriting any existing file:

${text}`
  return agent(prompt, { label: `ledger:round${entry.round}`, phase: 'Debate', model: mechModel })
}

const transcript = []
// 'consensus' is the normal terminus. 'unresolved' is the honest one: the round
// backstop was hit with findings still open — a real debate outcome, surfaced
// for a human to adjudicate, never papered over as agreement. 'reviewer-error'
// is the abnormal terminus: codex itself failed to produce a verdict
// (broken/unavailable) — infrastructure failure, not a debate outcome.
let status = 'consensus'
let finalVerdict = null
let lastClaude = null

// ---------------------------------------------------------------------------
// The loop — runs to consensus within the round backstop.
// ---------------------------------------------------------------------------
// The debate continues until codex resolves every finding (any severity) or the
// backstop is hit. The backstop is not a "deadlock surrender": quitting without
// agreement AND pretending otherwise is what defeats a debate — exiting with the
// disagreement surfaced honestly (`unresolved`, still-open findings attached) is
// the correct output of a debate that didn't converge, and strictly better than
// more rounds of two models wearing each other down (gains saturate by round 2;
// kolu#1222 is the runaway this caps).
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

// Clear any stale ledger from a PRIOR debate in this worktree. The scratch dir
// is persistent (per-worktree, not per-run) and the section files use a flat,
// stable `section-NNN.md` namespace, so a previous longer debate's high-numbered
// sections would otherwise survive into this run — the author cats `section-*.md`
// as its memory (and they compose into the `comment` renderLedger returns), so stale
// sections would pollute BOTH the author's context and the published trail. A
// thin mechanical agent (the workflow can't run shell itself). The reset is
// section/ledger-scoped: it deletes only the stale `section-*.md` files, not the
// whole scratch dir, so other artifacts in there (verdict-N.json, rebuttal.json,
// commit-msg-N.txt) keep their own lifecycle and a future pre-loop writer won't
// be silently wiped. This script has no true resume (agent() is one-shot, the
// whole workflow re-runs from scratch), so a fresh start owns a fresh ledger.
await agent(
  `You are a MECHANICAL RUNNER. Run exactly this and nothing else: \`mkdir -p -- ${shq(workDir)} && rm -f -- ${shq(workDir)}/section-*.md\`. Do not edit any other file. Do not run git.`,
  { label: 'ledger:reset', phase: 'Debate', model: mechModel },
)

for (let round = 1; round <= maxRounds; round++) {
  const verdict = await codexReviews(round, lastClaude ? JSON.stringify(lastClaude) : null)
  finalVerdict = verdict
  const entry = { round, codex: verdict, claude: null }
  transcript.push(entry) // record this round (mutated in place as it progresses)
  // Reviewer error — terminal failure path. The runner could not get a verdict
  // out of codex (broken/unavailable CLI), so codex-review.sh synthesized an
  // error verdict carrying reviewerError:true. There are no findings to route to
  // Claude, and retrying a broken reviewer just spins forever, so abort the
  // debate and surface the failure. This is deliberately separate from the
  // `unresolved` backstop exit, which only governs substantive disagreement.
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

  // Final-round guard: findings still open at the backstop end the debate
  // HERE, before the author turn. Pre-cap, every author turn was verified by
  // the next codex round; an author turn on the last round would fix-and-commit
  // edits nobody ever reviews, and the `unresolved` worklist would then list
  // findings the author had just addressed. Exiting before the turn keeps
  // `unresolved` = codex's actual open findings, each a genuine disagreement.
  if (round === maxRounds) {
    status = 'unresolved'
    log(`Round backstop (${maxRounds}) hit with ${open.length} finding(s) still open — ending as unresolved for human adjudication (no author turn this round).`)
    break
  }

  // Claude responds: fixes what it agrees with (editing the tree), disputes the
  // rest. It reads the per-round section files (written at the end of each round
  // below) for its cross-round memory. `lastClaude` is kept only to feed codex's
  // rebuttal next round (see codexReviews) — it is no longer the author's memory.
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

  // Write this round's section so the NEXT round's author can read the full
  // history. Terminal rounds break above before reaching here, so they're
  // sectioned just after the loop.
  await writeSection(entry)
}

const filesChanged = Array.from(
  new Set(transcript.flatMap((e) => (e.claude && e.claude.filesChanged) || [])),
)
log(`Debate ended: ${status} after ${transcript.length} round(s); ${filesChanged.length} file(s) changed.`)

// Section the terminal round — it broke out of the loop before the in-loop
// writeSection, so without this its section (a consensus approval, or an error
// reached before the author got a turn) would be missing from the disk record
// the orchestrator reads for the chat summary (cat section-*.md) and the
// author would read as memory if the debate somehow continued.
if (transcript.length > 0) await writeSection(transcript[transcript.length - 1])

// Hand the orchestrator the ready-to-post comment, rendered deterministically
// in-process (header + per-round sections) — it just writes the string to a file
// and posts it (`gh pr comment -F`), the same shape lens-debate uses. The section
// files on disk stay the author's cross-round memory; this is the published view
// of that same record, so no agent ever retypes the whole ledger. See SKILL step 3.
return {
  status,
  rounds: transcript.length,
  base,
  finalVerdict,
  // The still-open findings on an `unresolved` exit — the caller's adjudication
  // worklist. Empty on consensus and on reviewer-error (no trustworthy verdict).
  unresolved: status === 'unresolved' ? openFindings(finalVerdict) : [],
  filesChanged,
  transcript,
  comment: renderLedger(transcript, { status, rounds: transcript.length, base, reasoningEffort: REASONING_EFFORT_LABEL }),
}
