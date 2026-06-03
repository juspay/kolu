// The Workflow runtime requires `export const meta` to be the FIRST statement
// and a PURE LITERAL (no interpolation), so 'opus' is inlined per phase. The
// single MODEL socket lives just after meta; every other model reference reads
// it lazily, well after meta is evaluated.
export const meta = {
  name: 'be-review',
  description:
    'Run the /be review gauntlet in PARALLEL: codex⇄claude, lowy⇄hickey, and code-police each debate to consensus in their own worktree at once, then consolidate the per-track commits onto the branch (overlap → reconcile) and post a detailed PR comment per track',
  phases: [
    { title: 'Setup', detail: 'fan out one detached worktree per review track off the branch HEAD', model: 'opus' },
    { title: 'Tracks', detail: 'codex, lens, and police gauntlets each run to consensus, concurrently and isolated', model: 'opus' },
    { title: 'Consolidate', detail: 'cherry-pick each track’s commits onto the branch in order; reconcile the rare overlap', model: 'opus' },
    { title: 'Report', detail: 'post a detailed PR comment for each track plus the consolidation ledger', model: 'opus' },
    { title: 'Cleanup', detail: 'tear down the per-track worktrees', model: 'opus' },
  ],
}

// The model every orchestrated agent runs on. Structural review on /be runs on
// Opus (the lens debate forces it, overriding its sonnet frontmatter); keep the
// override to one socket so a model bump is a one-liner.
const MODEL = 'opus'

// ---------------------------------------------------------------------------
// Inputs (passed via the Workflow tool's `args`)
// ---------------------------------------------------------------------------
const a = args || {}
const repoPath = a.repoPath || '.'
const base = a.base || 'origin/master'
// Optional author note on deliberate design decisions, threaded into the lens
// debate so the lenses don't flag intentional choices.
const rationale = (a.rationale || '').trim()
// Commit each track's fixes (default on). Tracks always commit inside their own
// worktree — this only gates whether the lens/police APPLY steps commit; the
// per-track commits are what consolidation cherry-picks, so leaving it on is the
// norm. (`--no-commit` is for debugging a single track in isolation.)
const commit = a.commit !== false
// Post a detailed PR comment per track + the consolidation ledger (default on).
// `--no-comment` (comment:false) suppresses the outward-facing write.
const postComments = a.comment !== false
const model = a.model || MODEL
// The review tracks to run AND the order they consolidate in. codex first (it
// changes the most — bug fixes), then the structural lenses, then police, so an
// overlap surfaces as a conflict picking the later, lighter-touch track.
const TRACKS = a.tracks || ['codex', 'lens', 'police']

// SHARED-CWD NOTE. Every workflow agent inherits the SESSION cwd (the main
// worktree) — the harness offers no per-agent cwd, and `isolation:'worktree'`
// can't host a multi-round debate (each agent would get a fresh tree and lose
// the prior round's commits). So isolation here is STRUCTURAL, not behavioral:
// every path below is ABSOLUTE and every git command is `git -C <worktree>`, so
// the shared cwd is irrelevant — no agent can leak into the wrong tree by
// forgetting to `cd`. The per-track worktrees live under the repo's conventional
// `.worktrees/` (gitignored); commit-message + PR-comment scratch lives under
// the gitignored `.be-review/`. Both are absolute and per-main-worktree, so
// parallel /be-review runs in different worktrees never collide.
const WT_ROOT = `${repoPath}/.worktrees`
const wtDir = (track) => `${WT_ROOT}/be-review-${track}`
const SCRATCH = `${repoPath}/.be-review`

// Generated skill locations the child debate workflows live at.
const CODEX_SCRIPT = '.claude/skills/codex-debate/debate.workflow.js'
const LENS_SCRIPT = '.claude/skills/lens-debate/debate.workflow.js'
const CODEX_SKILLDIR = '.claude/skills/codex-debate'

// The diff base reviewers actually use is the MERGE-BASE (resolved by Setup),
// not the raw `${base}` tip — see SETUP_SCHEMA.mergeBase. DIFF is an arrow, so it
// reads `mergeBase` lazily at call time (Tracks phase, after Setup has set it).
const DIFF = (wt) =>
  `Inspect the FULL change in the worktree at \`${wt}\`: run \`git -C ${wt} diff ${mergeBase}\` (committed + unstaged) and \`git -C ${wt} status --short\` (untracked/new files do NOT appear in the diff), then Read every new/changed file (use ABSOLUTE paths under \`${wt}\`) plus enough surrounding code to judge it in context. Ignore the gitignored \`.worktrees/\` and \`.be-review/\` scratch dirs if they appear.`

const rationaleBlock = rationale
  ? `\nAuthor's note on deliberate decisions (do not flag these as defects unless the reasoning is itself wrong):\n${rationale}\n`
  : ''

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const SETUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['branchHead', 'mergeBase', 'cleanTree', 'worktrees'],
  properties: {
    branchHead: { type: 'string', description: 'SHA of the branch HEAD every track was forked from' },
    mergeBase: { type: 'string', description: 'SHA of `git merge-base <base> HEAD` — the diff base reviewers actually use, so master’s drift past the fork point is NOT reviewed' },
    cleanTree: {
      type: 'boolean',
      description: 'true iff the main worktree had NO uncommitted changes (outside the scratch dirs) when checked',
    },
    dirtyStatus: {
      type: 'string',
      description: 'the offending `git status --short` lines when cleanTree is false; empty otherwise',
    },
    worktrees: {
      type: 'array',
      description: 'one entry per track worktree created',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['track', 'path', 'ok'],
        properties: {
          track: { type: 'string' },
          path: { type: 'string' },
          ok: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
  },
}

// code-police review pass output (mirrors /code-police's finding shape).
const POLICE_FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      description: 'high-confidence findings from this pass (≤6; empty is a fine verdict)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'location', 'problem', 'fix', 'severity'],
        properties: {
          title: { type: 'string' },
          location: { type: 'string', description: 'file:line' },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'a concrete, implementable change' },
          severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
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

const CONSOLIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: {
    finalHead: { type: 'string', description: 'branch HEAD SHA after all picks' },
    picks: {
      type: 'array',
      description: 'one entry per source commit you processed, in the order you processed it',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['track', 'sourceCommit', 'outcome'],
        properties: {
          track: { type: 'string' },
          sourceCommit: { type: 'string', description: 'the short SHA from the track worktree' },
          newCommit: { type: 'string', description: 'the resulting SHA on the branch' },
          outcome: { type: 'string', enum: ['clean', 'reconciled', 'dropped'] },
          files: { type: 'array', items: { type: 'string' }, description: 'for reconciled/dropped: the overlapping files' },
          note: { type: 'string', description: 'for reconciled/dropped: how you resolved it and why' },
        },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Phase 1 — fan out one detached worktree per track off the branch HEAD
// ---------------------------------------------------------------------------
phase('Setup')

const setupPrompt = `You are a MECHANICAL SETUP RUNNER preparing isolated worktrees for a parallel code-review gauntlet. Do exactly these steps (every path here is ABSOLUTE; use \`git -C\` and never rely on the current directory); do not edit any source files.

1. Record the branch HEAD: \`git -C ${repoPath} rev-parse HEAD\` — this is \`branchHead\`, the commit every track forks from.
1b. Record the MERGE-BASE: \`git -C ${repoPath} merge-base ${base} HEAD\` — this is \`mergeBase\`, the point the branch diverged from its base. Reviewers diff against THIS (not the raw \`${base}\` tip) so that commits \`${base}\` gained since the branch forked are NOT reviewed as if this PR made them. If the command fails, fall back to \`mergeBase\` = the resolved \`${base}\` and say so in a worktree \`note\`.
2. CLEAN-TREE PREFLIGHT. The tracks fork detached worktrees from \`branchHead\`, so anything NOT committed to HEAD is invisible to every reviewer. Run \`git -C ${repoPath} status --short\` and ignore only lines under the gitignored scratch dirs (\`.worktrees/\` and \`.be-review/\`). If ANY other staged, unstaged, or untracked entry remains, the working tree is dirty: set \`cleanTree\`: false, put those offending lines in \`dirtyStatus\`, SKIP worktree creation entirely (return an empty \`worktrees\` array), and stop. Otherwise set \`cleanTree\`: true and \`dirtyStatus\`: "".
3. Only if \`cleanTree\` is true — ensure the scratch dirs exist: \`mkdir -p ${WT_ROOT} ${SCRATCH}\`.
4. Only if \`cleanTree\` is true — for EACH track in [${TRACKS.join(', ')}], create a fresh detached worktree at \`branchHead\`:
   - Path: \`${WT_ROOT}/be-review-<track>\` (absolute).
   - If that path already exists from a prior run, remove it first: \`git -C ${repoPath} worktree remove --force ${WT_ROOT}/be-review-<track>\` (ignore errors if it's not registered), then \`rm -rf ${WT_ROOT}/be-review-<track>\`.
   - Then: \`git -C ${repoPath} worktree add --detach ${WT_ROOT}/be-review-<track> <branchHead>\`.
5. Run \`git -C ${repoPath} worktree prune\` to clear any stale entries.

Return \`branchHead\`, \`mergeBase\`, \`cleanTree\`, \`dirtyStatus\`, and, for each track, its absolute worktree \`path\` and whether creation succeeded (\`ok\`). If a worktree failed, set \`ok\`: false and put the git error in \`note\` — do NOT invent success.`

const setup = await agent(setupPrompt, { label: 'setup:worktrees', phase: 'Setup', model, schema: SETUP_SCHEMA })
const branchHead = (setup?.branchHead || '').trim()
// The diff base every reviewer uses: the merge-base of the branch and `${base}`,
// so commits `${base}` gained since the branch forked aren't reviewed as ours.
// Falls back to the raw base if Setup couldn't resolve it.
const mergeBase = (setup?.mergeBase || base).trim()

// Clean-tree gate. The tracks fork from HEAD, so uncommitted work in the main
// worktree would be invisible to every reviewer — a /be-review run could then
// approve an INCOMPLETE change set. Bail loudly instead (the caller commits or
// stashes, then re-runs) rather than silently reviewing a subset.
if (setup?.cleanTree === false) {
  const dirty = (setup?.dirtyStatus || '').trim()
  log(`Setup: ABORT — the main worktree at ${repoPath} has uncommitted changes; tracks fork from HEAD and would not see them.`)
  return {
    status: 'setup-failed',
    branchHead,
    base,
    tracks: {},
    consolidation: null,
    note: `dirty working tree: the tracks fork from HEAD \`${branchHead.slice(0, 9)}\`, so staged/unstaged/untracked changes (outside the scratch dirs) would be invisible to every reviewer. Commit or stash them, then re-run.${dirty ? `\nOffending entries:\n${dirty}` : ''}`,
  }
}

// Seed every requested track with an explicit `track-error` for setup failures, so
// a dropped reviewer is a STRUCTURED signal the caller (/be §4 falls back per
// track) — not just a log line that silently shrinks the set while status='done'.
const tracks = {}
const wts = setup?.worktrees ?? []
const liveTracks = TRACKS.filter((t) => wts.find((w) => w.track === t && w.ok))
const failedTracks = TRACKS.filter((t) => !liveTracks.includes(t))
for (const t of failedTracks) {
  const note = wts.find((w) => w.track === t)?.note || 'worktree creation failed'
  tracks[t] = { track: t, status: 'track-error', error: `setup: ${note}` }
}
if (failedTracks.length) log(`Setup: worktree creation FAILED for ${failedTracks.join(', ')} — recorded as track-error so the caller falls back for those.`)
log(`Setup: branchHead ${branchHead.slice(0, 9)}; diffing against merge-base ${mergeBase.slice(0, 9)} (not the raw ${base} tip); tracks live: ${liveTracks.join(', ') || '(none)'}`)

if (!branchHead || liveTracks.length === 0) {
  return { status: 'setup-failed', branchHead, base, tracks, consolidation: null, note: 'no track worktrees could be created' }
}

// ---------------------------------------------------------------------------
// Phase 2 — run every track's gauntlet to consensus, concurrently & isolated
// ---------------------------------------------------------------------------
phase('Tracks')

// The police track. /code-police is a skill, not a workflow, so its cold passes
// (rules / fact-check / elegance) are fanned out here as parallel agents — but
// each pass's *definition* stays single-sourced to code-police's SKILL.md (the
// agents Read it; the briefs only name which section/pass to apply), and the
// elegance pass honors the skill's tiny-diff skip. Each agreed fix is then
// applied as its own commit — matching /be §4.3's "each finding is its own
// commit". Per-finding `just check` is deferred to the post-consolidation check
// + §5 CI rather than run 3× concurrently across the parallel worktrees (it
// would thrash the toolchain); fmt-on-touched-files still runs in each apply.
async function policeTrack(wt) {
  // Pass *definitions* are single-sourced to code-police's SKILL.md: each brief
  // names that pass's section so the agent (which Reads the skill below) reviews
  // it exactly as written there — no inline checklist to drift. The elegance pass
  // is gated on the tiny-diff heuristic the skill mandates (skip when the worktree
  // diff against base is <10 lines).
  const tinyDiff = await agent(
    `Run \`git -C ${wt} diff ${mergeBase} --shortstat\` and report whether the changed-line total (insertions + deletions) is **under 10**. Return only that boolean.`,
    { label: 'police:diff-size', phase: 'Tracks', model, schema: { type: 'object', properties: { tiny: { type: 'boolean' } }, required: ['tiny'] } },
  )
  const passes = [
    { key: 'rules', brief: 'the **Rule checklist** pass exactly as defined in that skill\'s "Running the passes" section (Pass 1) — every built-in rule plus any project rules' },
    { key: 'fact-check', brief: 'the **Fact-check** correctness audit exactly as defined in that skill\'s "Running the passes" section (Pass 2)' },
    { key: 'elegance', brief: 'the **Elegance** pass exactly as defined in that skill\'s "Running the passes" section (Pass 3) — simplicity and idiom' },
  ].filter((p) => p.key !== 'elegance' || !tinyDiff?.tiny)
  if (tinyDiff?.tiny) log('police: skipping elegance pass (tiny diff <10 lines, per code-police SKILL.md)')
  const reviews = await parallel(
    passes.map((p) => () =>
      agent(
        `You are the **code-police ${p.key}** reviewer on a fresh, cold context — the implementer is biased to rationalize their own diff, so you start from "assume the code is wrong until proven right" and NEVER talk yourself out of a finding. First Read \`${wt}/.claude/skills/code-police/SKILL.md\` (and \`${wt}/.agency/code-police.md\` if it exists) for the rules and reviewing principles, then ${DIFF(wt)}\n${rationaleBlock}\nReview through ${p.brief}. Emit high-confidence findings only; an empty list is a fine verdict for a clean diff. Each finding: a title, a file:line location, the problem, a concrete implementable fix, and a severity.`,
        { label: `police:${p.key}`, phase: 'Tracks', model, schema: POLICE_FINDINGS_SCHEMA },
      ),
    ),
  )
  const findings = []
  passes.forEach((p, i) => (reviews[i]?.findings ?? []).forEach((f, j) => findings.push({ id: `police-${p.key}-${j + 1}`, pass: p.key, ...f })))
  log(`police: ${findings.length} finding(s) across ${passes.length} passes`)

  // Apply each finding as its own commit, sequentially (same-file edits can't be
  // parallel-applied). Every edit and git command targets the absolute worktree.
  const applied = []
  for (const f of findings) {
    const impl = await agent(
      `You are implementing ONE code-police finding in the worktree at \`${wt}\`. Work ONLY inside that worktree — every file you Read or Edit MUST be an ABSOLUTE path under \`${wt}\` (your shell cwd is a DIFFERENT worktree, so a relative path would edit the wrong tree). Read the surrounding code first so the edit fits the existing style; keep it tightly scoped.\n\nFinding ${f.id} [${f.severity}] — ${f.title}\n  at ${f.location}\n  problem: ${f.problem}\n  fix: ${f.fix}\n\nMake ONLY this change. Do NOT git add / commit / push. You MAY run the project's formatter on files you touched (\`cd ${wt} && <formatter>\`). Return a one-line summary and the exact list of files you changed (absolute paths).`,
      { label: `police-apply:${f.id}`, phase: 'Tracks', model, schema: IMPL_SCHEMA },
    )
    const files = impl?.filesChanged ?? []
    let sha = null
    if (commit && files.length) {
      sha = (await commitFix(wt, f.id, `fix(police): ${f.title}`, `${impl.summary}\n\ncode-police ${f.pass} finding ${f.id} [${f.severity}]. Applied by the /be parallel gauntlet; not pushed or merged.`, files))?.sha?.trim() || null
    }
    applied.push({ id: f.id, title: f.title, severity: f.severity, problem: f.problem, files, commit: sha })
    log(`police: applied ${f.id}${sha ? ` (${sha.slice(0, 9)})` : ' (uncommitted)'}`)
  }
  return { status: findings.length ? 'consensus' : 'clean', findings: findings.length, passes: passes.map((p) => p.key), applied }
}

// Mechanical committer shared by the police track: stages EXACTLY the listed
// files in worktree `wt` and commits with the given message — all via `git -C`
// so it never depends on the shell cwd. The workflow can't run git itself, so a
// thin agent does. (codex/lens commit via their own workflows.)
async function commitFix(wt, id, subject, body, files) {
  // Files may arrive as absolute worktree paths; git -C wants them relative to wt.
  const rel = files.map((f) => f.replace(`${wt}/`, '').replace(/^\/+/, ''))
  const fileArgs = rel.map((f) => `'${f.replace(/'/g, `'\\''`)}'`).join(' ')
  const msgPath = `${SCRATCH}/commit-msg-${id}.txt`
  const message = `${subject}\n\n${body}`
  const prompt = `You are a MECHANICAL COMMITTER. Do exactly these steps and nothing else — do not edit files, do not push, do not stage anything beyond the listed files. Every path is absolute / \`git -C\`; do not rely on the current directory.

1. Ensure the scratch dir exists: \`mkdir -p ${SCRATCH}\`.
2. Using the Write tool, create \`${msgPath}\` with EXACTLY this content:

${message}

3. Run: \`git -C ${wt} add -- ${fileArgs} && git -C ${wt} commit -F ${msgPath}\`. Stage ONLY those files; do NOT use \`git add -A\`/\`git add .\`.
4. Return the new commit SHA from \`git -C ${wt} rev-parse HEAD\`. Do NOT push.`
  return agent(prompt, {
    label: `police-commit:${id}`,
    phase: 'Tracks',
    model,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['sha'],
      properties: { sha: { type: 'string', description: 'the new HEAD commit SHA, hex only' } },
    },
  })
}

// One thunk per live track. codex and lens are existing repoPath-parameterized
// workflows (built to run in separate worktrees), invoked as child workflows —
// one level of nesting, which the runtime allows. They get the ABSOLUTE worktree
// path as repoPath. police is inline (it's a skill, not a workflow). Each thunk
// catches so one track's failure can't sink the rest — consolidation just picks
// up whatever each track committed.
const trackThunk = {
  codex: () =>
    workflow({ scriptPath: CODEX_SCRIPT }, { repoPath: wtDir('codex'), base: mergeBase, skillDir: CODEX_SKILLDIR, commit })
      .then((r) => ({ track: 'codex', ...r }))
      .catch((e) => ({ track: 'codex', status: 'track-error', error: String(e) })),
  lens: () =>
    workflow({ scriptPath: LENS_SCRIPT }, { repoPath: wtDir('lens'), base: mergeBase, rationale, model, commit })
      .then((r) => ({ track: 'lens', ...r }))
      .catch((e) => ({ track: 'lens', status: 'track-error', error: String(e) })),
  police: () =>
    policeTrack(wtDir('police'))
      .then((r) => ({ track: 'police', ...r }))
      .catch((e) => ({ track: 'police', status: 'track-error', error: String(e) })),
}

const trackResults = await parallel(liveTracks.map((t) => trackThunk[t]))
// `tracks` already carries a `track-error` entry for every setup failure; the live
// tracks fill in alongside them, so the returned map covers EVERY requested track.
liveTracks.forEach((t, i) => (tracks[t] = trackResults[i] || { track: t, status: 'track-error', error: 'no result' }))
for (const t of liveTracks) log(`Track ${t}: ${tracks[t].status || 'unknown'}`)

// ---------------------------------------------------------------------------
// PR-comment builders + poster (used by the Report phase). Bodies are built
// deterministically in JS from the structured track results; a thin mechanical
// agent just writes each body to a scratch file and posts it with `gh pr comment`.
// ---------------------------------------------------------------------------
// Plain (NOT code-fenced) short SHA so GitHub auto-links it to the commit — a
// backtick-wrapped SHA renders as code and is NOT linkified.
const sha9 = (s) => (s ? String(s).slice(0, 9) : '—')
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()

const SEV = { blocking: '🔴 blocking', major: '🟠 major', minor: '🟡 minor', nit: '⚪ nit' }

// Full per-round detail: every codex finding (severity, id, issue, location,
// suggestion, status) and Claude's disposition of each — the complete debate
// transcript, not a count table.
function codexRound(r) {
  const v = r.codex || {}
  const open = (v.findings || []).filter((f) => f.status !== 'resolved').length
  const findings = (v.findings || []).length
    ? v.findings
        .map(
          (f) =>
            `- **${SEV[f.severity] || f.severity} · ${f.id}** — ${esc(f.issue)}\n  at \`${esc(f.location)}\` · status: **${f.status}**\n  suggestion: ${esc(f.suggestion)}`,
        )
        .join('\n')
    : '_no findings_'
  const actions = (r.claude?.actions || []).length
    ? r.claude.actions.map((act) => `- **${act.findingId}** → _${act.disposition}_: ${esc(act.detail)}`).join('\n')
    : ''
  return [
    `### Round ${r.round} — codex approved ${v.approved ? '✅' : '❌'} · ${open} open${r.commit ? ` · ${sha9(r.commit)}` : ''}`,
    v.summary ? esc(v.summary) : '',
    v.responseToRebuttal ? `**Codex on Claude's rebuttal:** ${esc(v.responseToRebuttal)}` : '',
    `**Codex findings:**\n${findings}`,
    actions ? `**Claude's response:**\n${actions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function codexComment(t) {
  if (!t || t.status === 'track-error') return `## 🤖 Codex ⇄ Claude debate\n\n**Track error:** ${esc(t?.error) || 'did not run'}.`
  const rounds = (t.transcript || []).map(codexRound).join('\n\n---\n\n')
  return `## 🤖 Codex ⇄ Claude debate

**Outcome:** \`${t.status}\` after ${t.rounds} round(s) · codex reviewed at \`xhigh\` reasoning effort.

${esc(t.finalVerdict?.summary)}

${rounds}`
}

function lensComment(t) {
  if (!t || t.status === 'track-error') return `## ⚖️ Lowy ⇄ Hickey lens debate\n\n**Track error:** ${esc(t?.error) || 'did not run'}.`
  const appliedFor = (id) => (t.applied || []).find((x) => x.id === id)?.commit
  const rows = (t.settled || [])
    .map((s) => `| ${esc(s.origin)} | ${esc(s.title)} | ${esc(s.location)} | ${esc(s.disposition)} | ${s.disposition === 'fix' ? sha9(appliedFor(s.id)) : '—'} |`)
    .join('\n')
  const un = (t.unresolved || []).length
    ? `\n\n**⚠️ ${t.unresolved.length} unresolved finding(s)** — needs a human:\n` + t.unresolved.map((u) => `- ${esc(u.title)} (${esc(u.location)})`).join('\n')
    : ''
  return `## ⚖️ Lowy ⇄ Hickey lens debate

**Outcome:** \`${t.status}\` after ${t.rounds || 0} round(s). Independent review: ${Object.entries(t.reviews || {}).map(([k, v]) => `${k}=${(v || []).length}`).join(', ') || 'n/a'}.

| origin | finding | location | disposition | commit |
|---|---|---|---|---|
${rows || '| — | — | — | — | — |'}${un}`
}

function policeComment(t) {
  if (!t || t.status === 'track-error') return `## 👮 Code-police\n\n**Track error:** ${esc(t?.error) || 'did not run'}.`
  const rows = (t.applied || [])
    .map((x) => `| ${esc(x.severity)} | ${esc(x.title)} | ${esc((x.files || []).join(', '))} | ${sha9(x.commit)} |`)
    .join('\n')
  return `## 👮 Code-police

**${t.findings || 0} finding(s)** across the ${(t.passes || []).join(' / ') || 'code-police'} passes${t.status === 'clean' ? ' — clean diff' : ''}.

| severity | finding | files | commit |
|---|---|---|---|
${rows || '| — | — | — | — |'}`
}

function consolidationSection(c, order) {
  const rows = (c?.picks || [])
    .map((p) => `| ${esc(p.track)} | ${sha9(p.sourceCommit)} | \`${esc(p.outcome)}\` | ${sha9(p.newCommit)} | ${esc(p.note) || ''} |`)
    .join('\n')
  return `### Consolidation onto the branch (order: ${order.join(' → ')})

| track | source | outcome | new commit | note |
|---|---|---|---|---|
${rows || '| — | — | — | — | — |'}`
}

// Post one comment via a mechanical agent. Resolves the PR from the branch in the
// MAIN worktree (gh uses cwd's repo; the agent runs `gh -C`-equivalent by cd-ing).
async function postComment(slug, body) {
  const file = `${SCRATCH}/comment-${slug}.md`
  const prompt = `You are a MECHANICAL PR COMMENTER. Do exactly these steps and nothing else.

1. \`mkdir -p ${SCRATCH}\`.
2. Using the Write tool, create \`${file}\` with EXACTLY this markdown content:

${body}

3. Post it to THIS branch's PR: \`cd ${repoPath} && gh pr comment --body-file ${file}\`. (\`gh\` resolves the PR from the current branch.) If there is NO open PR for the branch, do nothing and report "no PR".
4. Return the comment URL gh prints, or "no PR".`
  return agent(prompt, { label: `comment:${slug}`, phase: 'Report', model })
}

// ---------------------------------------------------------------------------
// `--no-commit` short-circuit. With commit=false the tracks deliberately leave
// their fixes UNCOMMITTED in their own worktrees. Consolidation replays commits
// (rev-list ${branchHead}..HEAD) and cleanup's `worktree remove --force` tears the
// worktrees down — so running them now would silently discard every reviewer's edits.
// Instead, stop here and hand the live worktrees to the user to inspect; nothing is
// consolidated and nothing is cleaned up. (This is the documented single-track-debugging mode.)
// ---------------------------------------------------------------------------
if (!commit) {
  log(`--no-commit: skipping Consolidate + Cleanup. Per-track fixes are UNCOMMITTED in their worktrees; inspect them there (\`git -C ${WT_ROOT}/be-review-<track> diff\`).`)
  return {
    status: 'no-commit',
    branchHead,
    finalHead: branchHead,
    base,
    order: [],
    tracks,
    consolidation: null,
    conflicts: [],
    note: 'commit=false: each track left its fixes uncommitted in its worktree and nothing was consolidated. The worktrees are PRESERVED for inspection — review each `.worktrees/be-review-<track>` and re-run with commit enabled to consolidate.',
    worktrees: liveTracks.map((t) => ({ track: t, path: wtDir(t) })),
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — consolidate: cherry-pick each track's commits onto the branch in
// TRACKS order. The common case is no overlap (clean picks); the rare overlap
// surfaces as a cherry-pick conflict the agent reconciles by honoring BOTH
// changes (it has both commit messages = both debates' rationale).
// ---------------------------------------------------------------------------
phase('Consolidate')

// Skip tracks that errored or made no commits — the agent only picks real work.
const consolidateOrder = liveTracks.filter((t) => tracks[t]?.status !== 'track-error')
const consolidatePrompt = `You are CONSOLIDATING the results of a parallel code-review gauntlet onto the branch in the MAIN worktree at \`${repoPath}\`. Every command below is \`git -C\` against an ABSOLUTE path — do not rely on the current directory. ${consolidateOrder.length} review track(s) (${consolidateOrder.join(', ')}) each ran to consensus in their own detached worktree, all forked from branch HEAD \`${branchHead}\`, each committing its agreed fixes on top. Your job: replay every track's commits onto the branch, in the given order, reconciling the rare overlap.

The branch in \`${repoPath}\` is currently AT \`${branchHead}\` (the tracks' shared fork point). Process tracks in THIS order: ${consolidateOrder.join(' → ')}.

For each track, its worktree is \`${WT_ROOT}/be-review-<track>\`. Get that track's new commits oldest-first:
  \`git -C ${WT_ROOT}/be-review-<track> rev-list --reverse ${branchHead}..HEAD\`
(An empty list means the track found nothing to change — skip it.)

Then cherry-pick each of those commits onto the branch IN THAT ORDER:
  \`git -C ${repoPath} cherry-pick <sha>\`

- **Clean pick** → record outcome \`clean\` with the new SHA (\`git -C ${repoPath} rev-parse HEAD\`).
- **Conflict** (\`git -C ${repoPath} status\` shows unmerged paths) → this is an OVERLAP: an earlier track already changed the same lines. Resolve by Reading both sides (ABSOLUTE paths under \`${repoPath}\`) and producing a result that HONORS BOTH fixes (they each came from a review debate — neither is noise). Edit the conflicted files to the merged result, \`git -C ${repoPath} add\` them, then \`git -C ${repoPath} cherry-pick --continue\` (keep the original commit message). Record outcome \`reconciled\`, list the conflicted files in \`files\`, and explain the merge in \`note\`. Only \`drop\` a commit (\`git -C ${repoPath} cherry-pick --abort\`) if the earlier track's change already FULLY subsumes this one — record outcome \`dropped\` with the overlapping \`files\` and say so in \`note\`; never drop to avoid the work of merging.

Do NOT push and do NOT merge — leave the consolidated commits on the local branch for the human. Return the final branch HEAD and the per-commit \`picks\` ledger (in processing order); the overlaps you reconciled are just the picks whose outcome isn't \`clean\`.`

const consolidation = await agent(consolidatePrompt, { label: 'consolidate:cherry-pick', phase: 'Consolidate', model, schema: CONSOLIDATE_SCHEMA })
const conflicts = (consolidation?.picks ?? []).filter((p) => p.outcome !== 'clean')
log(`Consolidate: ${(consolidation?.picks ?? []).length} commit(s) replayed, ${conflicts.length} overlap(s) reconciled. HEAD ${(consolidation?.finalHead || '').slice(0, 9)}`)

// ---------------------------------------------------------------------------
// Phase 4 — post a detailed PR comment for EVERY track + the consolidation
// ledger. This is the review trail the whole gauntlet exists to leave; it runs
// here (not in the caller) so it ALWAYS happens. `--no-comment` suppresses it.
// ---------------------------------------------------------------------------
phase('Report')

const comments = {}
if (postComments) {
  // Data-drive Report over the SAME track set as every other phase: a per-track
  // comment builder keyed by track name, iterated in the canonical
  // `consolidateOrder`/`liveTracks` order. Adding/removing a reviewer costs Report
  // nothing — no hardcoded track literal to keep in sync.
  const builder = { codex: codexComment, lens: lensComment, police: policeComment }
  // The consolidation ledger is a WORKFLOW-level artifact, not a track artifact, so
  // it posts as its own comment — surviving any track subset instead of being
  // string-stapled onto whichever track happens to be present.
  const bodies = [
    ['consolidation', consolidationSection(consolidation, consolidateOrder)],
    ...liveTracks.filter((t) => builder[t]).map((t) => [t, builder[t](tracks[t])]),
  ]
  // Post sequentially so the comments land in a stable order (consolidation, then
  // the tracks in canonical order).
  for (const [slug, body] of bodies) {
    const url = await postComment(slug, body)
    comments[slug] = (url || '').trim()
    log(`Report: posted ${slug} comment${comments[slug] ? ` → ${comments[slug]}` : ''}`)
  }
} else {
  log('Report: --no-comment — skipping PR comments.')
}

// ---------------------------------------------------------------------------
// Phase 5 — tear down the per-track worktrees
// ---------------------------------------------------------------------------
phase('Cleanup')

await agent(
  `You are a MECHANICAL CLEANUP RUNNER. Every path is absolute / \`git -C\`; do not rely on the current directory. For each track in [${liveTracks.join(', ')}] run \`git -C ${repoPath} worktree remove --force ${WT_ROOT}/be-review-<track>\` (ignore errors if already gone), then \`git -C ${repoPath} worktree prune\`. Leave the gitignored \`${SCRATCH}\` directory (it holds commit-message + comment scratch); do not delete the branch's commits. Return "done".`,
  { label: 'cleanup:worktrees', phase: 'Cleanup', model },
)

return {
  status: 'done',
  branchHead,
  finalHead: consolidation?.finalHead || null,
  base,
  order: consolidateOrder,
  tracks,
  consolidation,
  conflicts,
  comments,
}
