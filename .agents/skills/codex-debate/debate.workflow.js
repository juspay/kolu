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
// Commit each round's changes individually (default on). The author commits its
// OWN round in-session — it already edits the tree, so it stages exactly what it
// changed and writes a message carrying the debate context (codex's findings +
// its dispositions). Never pushes or merges — that stays the human's call.
const commit = a.commit !== false
// Model tiers. The claude-author round does real reasoning (fixing/disputing
// codex's findings, and committing its own round) → `model` (Opus). Everything
// else here is mechanical — the codex runner just shells out to codex-review.sh
// and copies the verdict, the ledger writer dumps a section file, the merge-base
// resolver runs one git command → `mechModel`
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

// --- Context the Claude implementor INHERITS --------------------------------
// Two optional notes the CALLER threads in so the implementor (the Claude author)
// no longer reasons from the diff alone — the gap that made it re-derive the
// change's intent every round and re-litigate deliberate choices codex (rightly,
// on a bare diff) flags.
//
// `context` (#1): the MAIN-AGENT context — what this change is FOR (the task/intent
// and key decisions the orchestrator already holds). Injected into the implementor
// EVERY round: agent() is one-shot and Claude isn't headless under Max auth, so it
// can't be resumed the way codex is — re-injection is how it "inherits" at all.
// Deliberately NOT given to codex, which stays an independent reviewer of the
// actual code rather than the author's narrative.
const context = (a.context || '').trim()
// `rationale` (#2): the author's note on DELIBERATE decisions — the same note
// /lens-debate already accepts, now threaded here too. Given to BOTH sides: codex
// (its round-1 prompt, via codexReviews → codex-review.sh — so the reviewer doesn't
// raise them at the source; codex's warm session carries the note across rounds)
// AND the implementor (so it DISPUTES, rather than "fixes", a finding that
// contradicts a deliberate choice).
const rationale = (a.rationale || '').trim()
// The two notes as ready-to-interpolate implementor-prompt blocks. Empty when the
// note is absent, so the prompt stays byte-identical to the contextless form then.
const contextBlock = context
  ? `\nContext you INHERIT from the main agent — what this change is FOR (its task/intent and key decisions). Weigh codex's findings against it: a finding that contradicts this intent is a candidate to DISPUTE, not blindly fix.\n${context}\n`
  : ''
const rationaleBlock = rationale
  ? `\nAuthor's note on DELIBERATE decisions (chosen on purpose — do NOT "fix" them away; dispute the finding unless codex shows the decision itself is wrong):\n${rationale}\n`
  : ''
// codex reads the rationale from a file (it's constant across rounds, written once
// before the loop); `-` means "no rationale" to codex-review.sh.
const rationaleFileArg = rationale ? `${workDir}/rationale.md` : '-'

// The reasoning effort codex runs at, scoped to the debate. This JS constant is
// the SINGLE home for the value: it is passed script-ward (a 4th positional arg
// to codex-review.sh, which sets `-c model_reasoning_effort`) and read by
// ledgerHeader for the published comment, so the `-c` flag and the header both
// derive from here via the one-directional invocation channel — no literal
// repeated across files held together by "remember to update all of them".
const REASONING_EFFORT = 'xhigh'

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
    // The author commits its own round (it already edits the tree), so it returns
    // the resulting SHA here. "" when it changed nothing or ran under --no-commit.
    commitSha: { type: 'string' },
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
   \`cd ${repoPath} && bash ${skillDir}/scripts/codex-review.sh ${base} ${rebuttalPath} ${verdictPath} ${REASONING_EFFORT} ${rationaleFileArg}\``
    : `1. (No prior rebuttal this round.)

2. Run (cd into the repo root so the script's internal \`git diff\`/\`git status\` target THIS worktree — your shell cwd may be a different worktree):
   \`cd ${repoPath} && bash ${skillDir}/scripts/codex-review.sh ${base} - ${verdictPath} ${REASONING_EFFORT} ${rationaleFileArg}\``

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

async function claudeResponds(round, verdict, doCommit) {
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
${contextBlock}${rationaleBlock}
${priorBlock}CODEX's verdict (JSON):
${JSON.stringify(verdict, null, 2)}

Address EVERY finding, any severity (don't skip minors/nits):
  - agree → fix it in the working tree; disposition "fixed".
  - disagree → leave the code, dispute it with a specific technical reason (cite file:line); disposition "disputed". Concede when codex is right.
  - partly → fix the valid part, explain the rest; disposition "partial".

You may run the formatter on files you touched. ${
    doCommit
      ? `Once you've addressed every finding AND you actually changed files, COMMIT this round's work yourself — the debate records one commit per round. Stage ONLY the files you changed (never \`git add -A\` or \`git add .\`) and commit with \`git -C ${repoPath}\`, subject \`fix: codex review — debate round ${round}\` and a body that summarizes your changes plus, briefly, codex's findings and how you dispositioned each. Do NOT push. Return the resulting SHA (\`git -C ${repoPath} rev-parse HEAD\`) in \`commitSha\`. If you changed no files, don't commit and leave \`commitSha\` empty.`
      : `Edit the working tree only — do NOT git add/commit/push; leave \`commitSha\` empty.`
  }

Return: actions (one per finding — findingId, disposition, detail), filesChanged, commitSha, and done (true once you've addressed every finding this round).`

  return agent(prompt, {
    label: `claude:round${round}`,
    phase: 'Debate',
    model, // deep reasoning: the author fixing/disputing real findings
    schema: CLAUDE_RESPONSE_SCHEMA,
  })
}

// ---------------------------------------------------------------------------
// The shared ledger — rendered from the transcript, deterministically
// ---------------------------------------------------------------------------
// One codex finding as a Markdown bullet — the single projection of a finding's
// fields for the ledger section. (The per-round commit message is now written by
// the author itself, in its own session, so this no longer feeds it.)
function findingBullet(f) {
  return `- \`${f.id}\` · ${f.severity} · ${f.status} — ${f.issue} (${f.location})`
}

// One author disposition as a Markdown bullet — the single projection of an
// action's fields for the ledger section.
function actionBullet(a) {
  return `- \`${a.findingId}\` **${a.disposition}** — ${a.detail}`
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
// 'consensus' is the only NORMAL terminus. 'reviewer-error' is the one abnormal
// terminus: codex itself failed to produce a verdict (broken/unavailable). That
// is infrastructure failure, not a debate outcome, so it ends the loop too —
// distinct from the deliberate "no deadlock exit" for substantive disagreement.
let status = 'consensus'
let finalVerdict = null
let lastClaude = null
// Rounds where the author edited files (commit mode on) but returned no SHA —
// the in-session commit it was told to make didn't land. The edits aren't lost
// (they stay in the tree and the next reviewer still diffs them against base),
// but the "one commit per round" contract was broken for that round, so the run
// is NOT a clean consensus: we downgrade the terminal status below rather than
// report success over a missed commit. Not a hard abort: a transient SHA omission
// shouldn't nuke a multi-round debate whose edits are all present in the tree.
const commitGaps = []

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

// Clear any stale ledger from a PRIOR debate in this worktree. The scratch dir
// is persistent (per-worktree, not per-run) and the section files use a flat,
// stable `section-NNN.md` namespace, so a previous longer debate's high-numbered
// sections would otherwise survive into this run — the author cats `section-*.md`
// as its memory (and they compose into the `comment` renderLedger returns), so stale
// sections would pollute BOTH the author's context and the published trail. A
// thin mechanical agent (the workflow can't run shell itself). The reset is
// section/ledger-scoped: it deletes only the stale `section-*.md` files, not the
// whole scratch dir, so other artifacts in there (verdict-N.json, rebuttal.json,
// and any commit-message file the author writes) keep their own lifecycle and a
// future pre-loop writer won't be silently wiped. This script has no true resume (agent() is one-shot, the
// whole workflow re-runs from scratch), so a fresh start owns a fresh ledger.
await agent(
  `You are a MECHANICAL RUNNER. Run exactly this and nothing else: \`mkdir -p -- ${shq(workDir)} && rm -f -- ${shq(workDir)}/section-*.md\`. Do not edit any other file. Do not run git.`,
  { label: 'ledger:reset', phase: 'Debate', model: mechModel },
)

// Persist the author's rationale ONCE (it's constant across rounds) so
// codex-review.sh can inject it into codex's round-1 prompt; codex's warm session
// then carries the note across later rounds without re-injection. Only when a
// rationale was passed — otherwise rationaleFileArg is `-` and no file is needed.
// A thin mechanical writer (the workflow can't do file I/O); the payload is small.
if (rationale) {
  await agent(
    `You are a MECHANICAL WRITER. Do exactly these steps and nothing else — do not edit any other file, do not run git, do not add commentary.

1. Ensure the scratch dir exists: \`mkdir -p ${workDir}\`.
2. Using the Write tool, create \`${workDir}/rationale.md\` with EXACTLY this content, overwriting any existing file:

${rationale}`,
    { label: 'rationale:write', phase: 'Debate', model: mechModel },
  )
}

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

  // Claude responds: fixes what it agrees with (editing the tree), disputes the
  // rest. It reads the per-round section files (written at the end of each round
  // below) for its cross-round memory. `lastClaude` is kept only to feed codex's
  // rebuttal next round (see codexReviews) — it is no longer the author's memory.
  const response = await claudeResponds(round, verdict, commit)
  entry.claude = response
  lastClaude = response
  log(
    `Round ${round}: claude done=${response.done}, actions=${(response.actions || []).length}, files=${(response.filesChanged || []).length}`,
  )

  // The author commits its own round in-session (one commit per round, message
  // carrying codex's findings and its dispositions), so here we just record the
  // SHA it returned. Only when it actually changed files; flag the inconsistency
  // if it reported changes but no commit rather than silently dropping it.
  if (commit && (response.filesChanged || []).length > 0) {
    entry.commit = (response.commitSha || '').trim()
    if (entry.commit) {
      log(`Round ${round}: committed ${entry.commit}`)
    } else {
      // The author edited the tree but didn't return a SHA: its in-session commit
      // didn't land. Record the gap so the terminal status reflects it instead of
      // reporting a clean consensus over a round that broke the one-commit-per-round
      // contract. The edits themselves remain in the tree for the next reviewer.
      commitGaps.push(round)
      log(`Round ${round}: author changed ${response.filesChanged.length} file(s) but returned no commit SHA — round left uncommitted`)
    }
  }

  // Write this round's section so the NEXT round's author can read the full
  // history. Terminal rounds break above before reaching here, so they're
  // sectioned just after the loop.
  await writeSection(entry)
}

const filesChanged = Array.from(
  new Set(transcript.flatMap((e) => (e.claude && e.claude.filesChanged) || [])),
)

// Downgrade a would-be consensus when any round's in-session commit didn't land.
// The debate may have converged (codex approved, nothing open), but with the
// "one commit per round" contract broken we must NOT advertise a clean consensus:
// /be-review keys off this status (and the SKILL's status table) to decide whether
// the step settled cleanly. 'commit-incomplete' is a distinct, non-consensus
// terminus — the edits are all in the tree (the next reviewer diffs them), but a
// human/caller must reconcile the uncommitted round(s). We don't touch a status
// that's already abnormal (reviewer-error), which is strictly more severe.
if (status === 'consensus' && commitGaps.length) {
  status = 'commit-incomplete'
  log(`Round(s) ${commitGaps.join(', ')} left uncommitted despite changing files — downgrading consensus to commit-incomplete.`)
}

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
  filesChanged,
  // Rounds whose author-side commit didn't land (empty unless status is
  // 'commit-incomplete'). Lets the caller pinpoint and reconcile the gap.
  commitGaps,
  transcript,
  comment: renderLedger(transcript, { status, rounds: transcript.length, base, reasoningEffort: REASONING_EFFORT }),
}
