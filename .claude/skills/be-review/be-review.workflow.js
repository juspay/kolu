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
// repoPath is the worktree root and the spine of EVERY path below (`git -C`,
// child `repoPath`s, scratch + worktree dirs). It MUST be absolute: the whole
// "isolation is structural, not behavioral" guarantee rests on every git command
// and file path being absolute, and the codex child `cd`s into its repoPath while
// reading a scratch path derived from it — a relative repoPath would `cd` once and
// then resolve that scratch path against the new cwd, writing the verdict to a
// nested path and reading it back from a different one. Rather than silently
// canonicalize against an unknowable session cwd, reject a non-absolute repoPath
// loudly. (/be always passes an absolute root; the default `.` is rejected here.)
const repoPath = (a.repoPath || '').trim()
if (!repoPath.startsWith('/')) {
  return {
    status: 'setup-failed',
    branchHead: '',
    base: a.base || 'origin/master',
    tracks: {},
    consolidation: null,
    note: `repoPath must be an ABSOLUTE path (got ${repoPath ? `\`${repoPath}\`` : 'empty'}). Every git command and scratch/worktree path in this orchestrator is absolute and cwd-independent; a relative repoPath would break the codex child's cd-then-read-scratch step and let agents leak into the wrong tree. Pass the absolute worktree root.`,
  }
}
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
// Author each comment with a per-track REPORTER AGENT (rich narrative + tables +
// reasoning) rather than the terse deterministic string builders (issue #1151).
// Default on. The deterministic builders remain the baseline the agent improves
// and the fallback on empty output, and a trivial track (track-error / clean /
// empty) skips the agent so a no-op debate costs nothing. `richComment: false`
// forces the deterministic comments.
const richComment = a.richComment !== false
const model = a.model || MODEL
// The review tracks to run AND the order they consolidate in. codex first (it
// changes the most — bug fixes), then the structural lenses, then police, so an
// overlap surfaces as a conflict picking the later, lighter-touch track.
const TRACKS = a.tracks || ['codex', 'lens', 'police']
// Whitelist the track names. Each is woven into worktree paths and the agents'
// shell snippets (just like RUN_ID above), and each must map to a registered
// thunk. Reject an unknown track or a duplicate up front rather than building a
// worktree at an unexpected path or invoking `undefined()` in `parallel` — a
// typo'd/hostile track is an input error, not something to silently route around.
const KNOWN_TRACKS = ['codex', 'lens', 'police']
const badTracks = TRACKS.filter((t) => !KNOWN_TRACKS.includes(t))
const dupTracks = TRACKS.filter((t, i) => TRACKS.indexOf(t) !== i)
if (badTracks.length || dupTracks.length) {
  return {
    status: 'setup-failed',
    branchHead: '',
    base: a.base || 'origin/master',
    tracks: {},
    consolidation: null,
    note: `tracks must be a subset of ${KNOWN_TRACKS.join(', ')} with no duplicates.${badTracks.length ? ` Unknown: ${[...new Set(badTracks)].join(', ')}.` : ''}${dupTracks.length ? ` Duplicated: ${[...new Set(dupTracks)].join(', ')}.` : ''}`,
  }
}

// SHARED-CWD NOTE. Every workflow agent inherits the SESSION cwd (the main
// worktree) — the harness offers no per-agent cwd, and `isolation:'worktree'`
// can't host a multi-round debate (each agent would get a fresh tree and lose
// the prior round's commits). So isolation here is STRUCTURAL, not behavioral:
// every path below is ABSOLUTE and every git command is `git -C <worktree>`, so
// the shared cwd is irrelevant — no agent can leak into the wrong tree by
// forgetting to `cd`. The per-track worktrees live under the repo's conventional
// `.worktrees/` (gitignored); commit-message + PR-comment scratch lives under
// the gitignored `.be-review/`. Both are absolute, and a per-RUN id is woven into
// the worktree name and the scratch subdir so two /be-review runs in the SAME
// main worktree never clobber each other's live worktrees or scratch files (the
// old fixed `be-review-<track>` / `.be-review/*` paths let a second run `rm -rf`
// the first run's in-flight worktree). The id comes from `args.runId`: the
// workflow runtime forbids `Date.now()`/`Math.random()` (they'd break resume), so
// the CALLER stamps a unique value (the /be-review skill passes the launch epoch
// ms). Defaults to 'run' when absent — fine for a single run; CONCURRENT runs in
// the same main worktree must pass distinct ids. The actual paths are reported in
// the result so manual inspection doesn't need to guess them.
const RUN_ID = String(a.runId || 'run')
// `RUN_ID` and the track names below are woven directly into filesystem paths
// (worktree dirs, scratch subdirs) and into the shell snippets the mechanical
// agents run, so they MUST be conservative tokens. A value with `/`, `..`, or
// shell metacharacters could place a worktree or scratch file OUTSIDE the
// intended `.worktrees`/`.be-review` dirs, collide with another run, or inject a
// command into an agent's `git -C`/`mkdir` snippet. Reject anything that isn't a
// plain `[A-Za-z0-9._-]` token (which also excludes path separators and `..` as a
// whole, since `.` alone is fine but `..` can't reach a parent without a `/`).
if (!/^[A-Za-z0-9._-]+$/.test(RUN_ID) || RUN_ID === '..' || RUN_ID === '.') {
  return {
    status: 'setup-failed',
    branchHead: '',
    base: a.base || 'origin/master',
    tracks: {},
    consolidation: null,
    note: `runId must match ^[A-Za-z0-9._-]+$ (no slashes, no shell metacharacters) so it stays safe inside filesystem paths and shell snippets; got \`${RUN_ID}\`. Pass a plain token like the launch epoch ms.`,
  }
}
const WT_ROOT = `${repoPath}/.worktrees`
const wtDir = (track) => `${WT_ROOT}/be-review-${RUN_ID}-${track}`
const SCRATCH = `${repoPath}/.be-review/${RUN_ID}`
// The two gitignored scratch dirs this orchestrator owns: live per-track
// worktrees under `.worktrees/` and commit-message/PR-comment scratch under
// `.be-review/`. Two prompts must name them in lockstep — the DIFF brief tells
// reviewers to ignore them, and the Setup preflight excludes them from the
// clean-tree check — so the list lives here once and both interpolate it.
const ORCHESTRATOR_SCRATCH = ['.worktrees/', '.be-review/']
const scratchList = ORCHESTRATOR_SCRATCH.map((d) => `\`${d}\``).join(' and ')
// The per-track debate scratch dirs the child workflows own (codex/lens write
// their transcripts here). The consolidation clean-check must ignore these when
// judging whether a track left uncommitted work, so the list lives here once.
const TRACK_SCRATCH = ['.codex-debate/', '.lens-debate/']
const trackScratchList = TRACK_SCRATCH.map((d) => `\`${d}\``).join(', ')

// Generated skill locations the child debate workflows live at.
const CODEX_SCRIPT = '.claude/skills/codex-debate/debate.workflow.js'
const LENS_SCRIPT = '.claude/skills/lens-debate/debate.workflow.js'
const CODEX_SKILLDIR = '.claude/skills/codex-debate'

// The diff base reviewers actually use is the MERGE-BASE (resolved by Setup),
// not the raw `${base}` tip — see SETUP_SCHEMA.mergeBase. DIFF is an arrow, so it
// reads `mergeBase` lazily at call time (Tracks phase, after Setup has set it).
const DIFF = (wt) =>
  `Inspect the FULL change in the worktree at \`${wt}\`: run \`git -C ${wt} diff ${mergeBase}\` (committed + unstaged) and \`git -C ${wt} status --short\` (untracked/new files do NOT appear in the diff), then Read every new/changed file (use ABSOLUTE paths under \`${wt}\`) plus enough surrounding code to judge it in context. Ignore the gitignored ${scratchList} scratch dirs if they appear.`

const rationaleBlock = rationale
  ? `\nAuthor's note on deliberate decisions (do not flag these as defects unless the reasoning is itself wrong):\n${rationale}\n`
  : ''

// Single source of the cwd-safety contract every mechanical git agent runs under.
// The Workflow runtime can't run git/gh itself, so a thin agent shells out — and
// because all agents share the SESSION cwd (see SHARED-CWD NOTE), each MUST use
// absolute paths + `git -C` and never rely on the current directory. This sentence
// was copy-pasted across the six mechanical-agent prompts; hoisting it here means
// the contract lives in ONE place if the shared-cwd guarantee ever changes.
const mechanicalPreamble = (role) =>
  `You are a MECHANICAL ${role}. Every path here is ABSOLUTE; use \`git -C\` and never rely on the current directory.`

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const SETUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['branchHead', 'mergeBase', 'cleanTree', 'worktrees'],
  properties: {
    branchHead: { type: 'string', description: 'SHA of the branch HEAD every track was forked from' },
    mergeBase: { type: 'string', description: 'SHA of `git merge-base <base> HEAD` — the diff base reviewers actually use, so master’s drift past the fork point is NOT reviewed. Empty string iff the merge-base command FAILED (do NOT fall back to the raw base).' },
    mergeBaseError: {
      type: 'string',
      description: 'the verbatim `git merge-base` error when mergeBase is empty; "" otherwise',
    },
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

const setupPrompt = `${mechanicalPreamble('SETUP RUNNER')} You are preparing isolated worktrees for a parallel code-review gauntlet. Do exactly these steps; do not edit any source files.

1. Record the branch HEAD: \`git -C ${repoPath} rev-parse HEAD\` — this is \`branchHead\`, the commit every track forks from.
1b. Record the MERGE-BASE: \`git -C ${repoPath} merge-base ${base} HEAD\` — this is \`mergeBase\`, the point the branch diverged from its base. Reviewers diff against THIS (not the raw \`${base}\` tip) so that commits \`${base}\` gained since the branch forked are NOT reviewed as if this PR made them. If the command FAILS (missing/typoed base, stale ref, or unrelated history), the review scope is untrustworthy — do NOT fall back to the raw \`${base}\`; instead set \`mergeBase\`: "" and put the exact git error in \`mergeBaseError\`, then STOP (skip worktree creation, return an empty \`worktrees\` array). (The orchestrator aborts the whole run when \`mergeBase\` is empty.)
2. CLEAN-TREE PREFLIGHT. The tracks fork detached worktrees from \`branchHead\`, so anything NOT committed to HEAD is invisible to every reviewer. Run \`git -C ${repoPath} status --short\` and ignore only lines under the gitignored scratch dirs (${scratchList}). If ANY other staged, unstaged, or untracked entry remains, the working tree is dirty: set \`cleanTree\`: false, put those offending lines in \`dirtyStatus\`, SKIP worktree creation entirely (return an empty \`worktrees\` array), and stop. Otherwise set \`cleanTree\`: true and \`dirtyStatus\`: "".
3. Only if \`cleanTree\` is true — ensure the scratch dirs exist: \`mkdir -p ${WT_ROOT} ${SCRATCH}\`.
4. Only if \`cleanTree\` is true — create a fresh detached worktree at \`branchHead\` for each track, at these EXACT absolute paths (per-run unique, so they cannot belong to another in-flight run):
${TRACKS.map((t) => `   - ${t}: \`git -C ${repoPath} worktree add --detach ${wtDir(t)} <branchHead>\``).join('\n')}
   These paths are unique to THIS run, so they should not pre-exist. If \`worktree add\` reports the path already exists, that is an error — set \`ok\`: false and put the message in \`note\`; do NOT \`rm -rf\` or force-remove it (it may belong to a concurrent run).
5. Run \`git -C ${repoPath} worktree prune\` to clear any stale entries.

Return \`branchHead\`, \`mergeBase\`, \`cleanTree\`, \`dirtyStatus\`, and, for each track, its absolute worktree \`path\` and whether creation succeeded (\`ok\`). If a worktree failed, set \`ok\`: false and put the git error in \`note\` — do NOT invent success.`

const setup = await agent(setupPrompt, { label: 'setup:worktrees', phase: 'Setup', model, schema: SETUP_SCHEMA })
const branchHead = (setup?.branchHead || '').trim()
// The diff base every reviewer uses: the merge-base of the branch and `${base}`,
// so commits `${base}` gained since the branch forked aren't reviewed as ours.
const mergeBase = (setup?.mergeBase || '').trim()

// Merge-base gate. A failed `git merge-base` means the review scope can't be
// trusted (missing/typoed base, stale ref, unrelated history). Falling back to the
// raw `${base}` tip would silently review the base branch's drift as if this PR
// made it — the exact noise the merge-base exists to remove. Fail loudly instead.
if (!mergeBase) {
  const err = (setup?.mergeBaseError || '').trim()
  log(`Setup: ABORT — \`git merge-base ${base} HEAD\` failed; the review scope can't be trusted. Not falling back to the raw ${base} tip.`)
  return {
    status: 'setup-failed',
    branchHead,
    base,
    tracks: {},
    consolidation: null,
    note: `merge-base of \`${base}\` and HEAD could not be resolved, so the diff scope is untrustworthy (missing/typoed base, stale ref, or unrelated history). Fix the base ref (e.g. \`git fetch\`) and re-run.${err ? `\ngit error:\n${err}` : ''}`,
  }
}

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

  // /code-police runs its passes "until clean": applying a finding can introduce a
  // NEW issue or leave one only partially fixed, so a single review+apply sweep is
  // not equivalent. Loop the passes on the UPDATED worktree until a sweep returns
  // no findings (clean) — applied fixes are re-reviewed, not assumed correct. A cap
  // keeps a thrashing reviewer from spinning forever (the harness backstop is the
  // hard ceiling); if we hit it with findings still open, the track reports
  // `incomplete` rather than a false `consensus`. Each round's finding ids are
  // round-scoped so commits stay unique across sweeps.
  const POLICE_MAX_ROUNDS = 4
  const applied = []
  let totalFindings = 0
  let policeRound = 0
  let sweepsRun = 0
  let lastRoundFindings = 0
  for (; policeRound < POLICE_MAX_ROUNDS; policeRound++) {
    sweepsRun++ // one review pass per iteration, counted BEFORE any break/cap exit so the reported sweep count is exact (not derived from the loop index)
    const reviews = await parallel(
      passes.map((p) => () =>
        agent(
          `You are the **code-police ${p.key}** reviewer on a fresh, cold context — the implementer is biased to rationalize their own diff, so you start from "assume the code is wrong until proven right" and NEVER talk yourself out of a finding. First Read \`${wt}/.claude/skills/code-police/SKILL.md\` (and \`${wt}/.agency/code-police.md\` if it exists) for the rules and reviewing principles, then ${DIFF(wt)}\n${rationaleBlock}\nReview through ${p.brief}. Emit high-confidence findings only; an empty list is a fine verdict for a clean diff. Each finding: a title, a file:line location, the problem, a concrete implementable fix, and a severity.`,
          { label: `police:${p.key}:r${policeRound + 1}`, phase: 'Tracks', model, schema: POLICE_FINDINGS_SCHEMA },
        ),
      ),
    )
    const findings = passes.flatMap((p, i) =>
      (reviews[i]?.findings ?? []).map((f, j) => ({ id: `police-r${policeRound + 1}-${p.key}-${j + 1}`, pass: p.key, ...f })),
    )
    lastRoundFindings = findings.length
    log(`police: round ${policeRound + 1} — ${findings.length} finding(s) across ${passes.length} passes`)
    if (!findings.length) break // clean sweep on the updated worktree → done

    // Apply each finding as its own commit, sequentially (same-file edits can't be
    // parallel-applied). Every edit and git command targets the absolute worktree.
    for (const f of findings) {
      const impl = await agent(
        `You are implementing ONE code-police finding in the worktree at \`${wt}\`. Work ONLY inside that worktree — every file you Read or Edit MUST be an ABSOLUTE path under \`${wt}\` (your shell cwd is a DIFFERENT worktree, so a relative path would edit the wrong tree). Read the surrounding code first so the edit fits the existing style; keep it tightly scoped.\n\nFinding ${f.id} [${f.severity}] — ${f.title}\n  at ${f.location}\n  problem: ${f.problem}\n  fix: ${f.fix}\n\nMake ONLY this change, fixing the issue COMPLETELY (a partial fix would resurface in the next review sweep). Do NOT git add / commit / push. You MUST run the project's formatter on every file you touched (\`cd ${wt} && <formatter>\`). Return a one-line summary and the exact list of files you changed (absolute paths).`,
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
    totalFindings += findings.length
  }
  // `clean` only if the FINAL sweep found nothing. If we exhausted the round cap
  // with findings still open, the worktree isn't verified-clean — report
  // `incomplete` so the caller (and the PR comment) doesn't read it as consensus.
  const reachedClean = lastRoundFindings === 0
  const status = !totalFindings ? 'clean' : reachedClean ? 'consensus' : 'incomplete'
  if (!reachedClean) log(`police: hit round cap (${POLICE_MAX_ROUNDS}) with findings still open — reporting incomplete.`)
  return { status, findings: totalFindings, rounds: sweepsRun, passes: passes.map((p) => p.key), applied }
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
  const prompt = `${mechanicalPreamble('COMMITTER')} Do exactly these steps and nothing else — do not edit files, do not push, do not stage anything beyond the listed files.

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

// A live track with no registered thunk (an unknown/typo'd TRACKS entry whose
// worktree Setup still built) would make `parallel` invoke `undefined()`. Seed it
// as a track-error — same shape as a setup failure — and drop it from dispatch so
// the parallel call stays total.
const dispatchable = liveTracks.filter((t) => trackThunk[t])
for (const t of liveTracks.filter((t) => !trackThunk[t])) {
  tracks[t] = { track: t, status: 'track-error', error: 'unknown track: no thunk registered' }
  log(`Track ${t}: no thunk registered — recorded as track-error and excluded from dispatch.`)
}
const trackResults = await parallel(dispatchable.map((t) => trackThunk[t]))
// `tracks` already carries a `track-error` entry for every setup failure (and any
// unknown track above); the dispatchable tracks fill in alongside them, so the
// returned map covers EVERY requested track.
dispatchable.forEach((t, i) => (tracks[t] = trackResults[i] || { track: t, status: 'track-error', error: 'no result' }))
for (const t of dispatchable) log(`Track ${t}: ${tracks[t].status || 'unknown'}`)

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

// A track that ran but was NOT consolidated (preserved worktree) carries
// `consolidated:false` and a recovery `note`. Surface it as a banner at the top of
// that track's comment so the PR audit trail never reads "reached consensus" while
// the fixes silently live only in a side worktree.
function preservedBanner(t) {
  if (!t || t.consolidated !== false) return ''
  return `\n\n> ⚠️ **Not consolidated onto the branch.** ${esc(t.note) || 'This track was preserved in its own worktree; its fixes are not on the branch.'}`
}

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

**Outcome:** \`${t.status}\` after ${t.rounds} round(s) · codex reviewed at \`xhigh\` reasoning effort.${preservedBanner(t)}

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

**Outcome:** \`${t.status}\` after ${t.rounds || 0} round(s). Independent review: ${Object.entries(t.reviews || {}).map(([k, v]) => `${k}=${(v || []).length}`).join(', ') || 'n/a'}.${preservedBanner(t)}

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

**${t.findings || 0} finding(s)** across the ${(t.passes || []).join(' / ') || 'code-police'} passes over ${t.rounds || 1} review sweep(s)${t.status === 'clean' ? ' — clean diff' : ''}.${t.status === 'incomplete' ? ` ⚠️ **Did not reach a clean sweep within the round cap** — the worktree may still have open issues; re-run /code-police on it.` : ''}${preservedBanner(t)}

| severity | finding | files | commit |
|---|---|---|---|
${rows || '| — | — | — | — |'}`
}

// Fallback comment for any requested track that has NO bespoke builder. It leans
// only on the always-present per-track fields (`track`, `status`, and `error`/
// `note` when present), so a newly-added reviewer track gets a real PR comment
// instead of being silently dropped — keeping Report total over `TRACKS`.
function genericComment(t) {
  return `## ${t?.track || 'unknown'} track

**Outcome:** \`${t?.status || 'unknown'}\`.${t?.error ? ` Track error: ${esc(t.error)}.` : ''}${t?.note ? `\n\n${esc(t.note)}` : ''}`
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

// ---------------------------------------------------------------------------
// Rich reporter agents (issue #1151). The deterministic builders above are the
// BASELINE (and the fallback); a reporter agent turns the structured track
// result into a genuinely detailed, well-organized comment — narrative + tables
// + reasoning — that a string builder can't synthesize from the rich-but-under-
// used fields each track carries. The mechanical `postComment` below still does
// the actual `gh pr comment`; only the body *authoring* becomes an agent.
// ---------------------------------------------------------------------------

// What each reporter should foreground — the fields each track carries that the
// terse builders drop on the floor (see issue #1151).
const REPORT_GUIDANCE = {
  codex: `Tell the codex⇄claude debate ROUND BY ROUND: how it converged (not just open-counts), the reasoning behind each disposition, codex's responses to Claude's rebuttals, and which findings were conceded vs fixed. Group findings by severity. Source: per-round transcript (findings = id/severity/location/issue/suggestion/status; claude actions = findingId/disposition/detail; round commit).`,
  lens: `Lead with each lens's INDEPENDENT findings (lowy and hickey each surface several). Then, per finding, the cross-examination outcome with BOTH lenses' reasoning, the agreed plan, and — most interesting — which findings FLIPPED disposition during the debate (drop→fix or fix→drop) and why. Source: settled[] (origin, title, location, disposition, plan, both lenses' reasonings), reviews (each lens's independent findings), history[] (per round), applied[] (commit), unresolved[].`,
  police: `For each finding give the actual PROBLEM statement and the FIX (not just title + commit), grouped by pass (rules / fact-check / elegance). Source: applied[] (id, title, severity, problem, files, commit).`,
  consolidation: `Surface the reconciliation REASONING prominently: for any pick whose outcome is 'reconciled' or 'dropped', explain the overlap and how it was resolved (the note) as prose, not a buried table cell. Clean picks can stay a compact table. Source: picks[] (track, sourceCommit, outcome, newCommit, files, note).`,
}

// Strip a wrapping ``` / ```markdown fence if the agent wrapped the whole body.
function stripFences(s) {
  const m = String(s || '')
    .trim()
    .match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/)
  return (m ? m[1] : s || '').trim()
}

// Is there enough substance to be worth an authoring agent? A track-error, a
// clean/empty result, or a no-pick consolidation just posts its deterministic
// baseline — no agent spent on a one-liner.
function hasRichContent(slug, data) {
  if (!data) return false
  if (slug === 'consolidation') return (data.picks || []).length > 0
  if (data.status === 'track-error') return false
  if (slug === 'codex') return (data.transcript || []).some((r) => (r.codex?.findings || []).length)
  if (slug === 'lens') return (data.settled || []).length > 0 || Object.values(data.reviews || {}).some((v) => (v || []).length)
  if (slug === 'police') return (data.applied || []).length > 0
  return false
}

// Author a rich comment body for one slug from its structured result. Returns the
// deterministic `baseline` on empty/failed output so Report never posts a blank
// comment. `baseline` carries the canonical top-level header (the agent is told to
// keep it), so PR anchors stay stable whether the body is agent- or builder-authored.
async function reporterBody(slug, data, baseline, guidance) {
  const prompt = `You are the **${slug} reporter** for a /be-review run. Author ONE genuinely detailed, well-organized GitHub PR comment from the structured result below — narrative + tables + reasoning, not a terse row count.

STRUCTURED RESULT (JSON):
${JSON.stringify(data, null, 2)}

DETERMINISTIC BASELINE (improve on it — keep its facts and its EXACT top-level header line, add the depth it lacks):
${baseline}

WHAT TO FOREGROUND:
${guidance}
Open with a 1-2 sentence synthesis of what this track changed and why.

HARD RULES:
- Keep the baseline's exact top-level header line (the \`##\`/\`###\` heading) so the PR anchor stays stable.
- Output ONLY the raw markdown body — no surrounding code fence, no preamble, no "here is the comment".
- Commit SHAs MUST be plain text (bare, e.g. a1b2c3d4e), NEVER wrapped in backticks — GitHub only auto-links bare SHAs.
- Stay under 60 KB; if the data is large, prioritize the most significant findings and note how many you summarized.
- Do NOT invent facts not in the structured result — synthesize only from the data given; you need not read the repo.
Return the markdown body as your final message.`
  const out = await agent(prompt, { label: `report:${slug}`, phase: 'Report', model })
  const body = stripFences(out)
  return body && body.length > 40 ? body : baseline
}

// Post one comment via a mechanical agent. Resolves the PR from the branch in the
// MAIN worktree (gh uses cwd's repo; the agent runs `gh -C`-equivalent by cd-ing).
async function postComment(slug, body) {
  const file = `${SCRATCH}/comment-${slug}.md`
  const prompt = `${mechanicalPreamble('PR COMMENTER')} Do exactly these steps and nothing else.

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
  log(`--no-commit: skipping Consolidate + Cleanup. Per-track fixes are UNCOMMITTED in their worktrees; inspect them there: ${liveTracks.map((t) => `git -C ${wtDir(t)} diff`).join(' ; ')}`)
  return {
    status: 'no-commit',
    branchHead,
    finalHead: branchHead,
    base,
    order: [],
    tracks,
    consolidation: null,
    reconciled: [],
    dropped: [],
    note: 'commit=false: each track left its fixes uncommitted in its worktree and nothing was consolidated. The worktrees are PRESERVED for inspection — see the `worktrees` field below for each track’s path — and re-run with commit enabled to consolidate.',
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

// BRANCH-DRIFT GATE. The Tracks phase can run for many minutes; the consolidator
// below cherry-picks onto the branch in `${repoPath}` and its prompt asserts the
// branch is still AT `branchHead` (the tracks' shared fork point). Setup's
// clean-tree preflight ran BEFORE the tracks, so if the user, another workflow, or
// a second /be-review advanced or dirtied the branch while the tracks ran, we'd
// cherry-pick onto an unreviewed base while telling the agent it's at `branchHead`
// — corrupting the review scope. Re-check HEAD and cleanliness NOW, just before the
// picks. If the branch moved or is dirty, abort and PRESERVE every track worktree
// (don't tear them down — their commits are the only copy of the reviewed fixes),
// so the human can consolidate by hand after sorting out the drift.
const driftCheck = await agent(
  `You are a MECHANICAL DRIFT CHECKER. Do exactly this against the main worktree at \`${repoPath}\` (use \`git -C\`; do not edit anything):
1. \`git -C ${repoPath} rev-parse HEAD\` — return as \`head\`.
2. \`git -C ${repoPath} status --short\` — IGNORE only lines under the gitignored scratch dirs (\`.worktrees/\` and \`.be-review/\`). If ANY other staged/unstaged/untracked entry remains, set \`clean\`: false and put those lines in \`dirtyStatus\`; otherwise \`clean\`: true and \`dirtyStatus\`: "".`,
  {
    label: 'consolidate:drift-check',
    phase: 'Consolidate',
    model,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['head', 'clean'],
      properties: {
        head: { type: 'string', description: 'current HEAD SHA of the main worktree' },
        clean: { type: 'boolean' },
        dirtyStatus: { type: 'string' },
      },
    },
  },
)
const curHead = (driftCheck?.head || '').trim()
const branchMoved = curHead && curHead !== branchHead
const branchDirty = driftCheck?.clean === false
if (branchMoved || branchDirty) {
  const dirty = (driftCheck?.dirtyStatus || '').trim()
  const why = branchMoved
    ? `the branch HEAD moved from \`${branchHead.slice(0, 9)}\` (the tracks' fork point) to \`${curHead.slice(0, 9)}\` while the tracks ran`
    : `the main worktree became dirty while the tracks ran`
  log(`Consolidate: ABORT — ${why}. Cherry-picking onto a changed base would corrupt the review scope. Preserving all track worktrees for manual consolidation.`)
  for (const t of liveTracks) {
    tracks[t] = {
      ...tracks[t],
      consolidated: false,
      note: `NOT consolidated — ${why}, so the consolidator's "branch is at ${branchHead.slice(0, 9)}" assumption no longer holds. The track's worktree was PRESERVED at ${wtDir(t)}; after resolving the drift, replay its commits with \`git -C ${repoPath} cherry-pick $(git -C ${wtDir(t)} rev-list --reverse ${branchHead}..HEAD)\`.`,
    }
  }
  return {
    status: 'consolidation-aborted',
    branchHead,
    finalHead: curHead || branchHead,
    base,
    order: [],
    tracks,
    consolidation: null,
    reconciled: [],
    dropped: [],
    preservedTracks: liveTracks,
    note: `consolidation aborted: ${why}. Cherry-picking onto the changed base would review against an untrustworthy scope, so nothing was consolidated and every track worktree was PRESERVED (see each track's note for the recovery cherry-pick).${dirty ? `\nOffending entries:\n${dirty}` : ''}`,
    worktrees: liveTracks.map((t) => ({ track: t, path: wtDir(t) })),
  }
}

// CLEAN-WORKTREE GATE before consolidation. Consolidation replays only COMMITTED
// commits (`rev-list branchHead..HEAD`), and Cleanup later force-removes every
// worktree — so any edit a track left UNcommitted (an apply agent that produced
// files but whose commit helper failed, a formatter that touched an unlisted
// file, an untracked new file) would be invisible to cherry-pick and then deleted
// for good. The check runs for EVERY live worktree — including a track whose
// gauntlet CRASHED (`track-error`): a crash after edits-applied-but-before-commit
// is exactly when uncommitted work is most likely, so skipping crashed tracks
// here would force-remove the very edits this gate exists to save. We only USE the
// clean result to decide consolidation eligibility (a `track-error` track is never
// cherry-picked regardless); for cleanup we FAIL CLOSED — any worktree that isn't
// EXPLICITLY clean (dirty, or missing from the checker's response) is preserved,
// never torn down. A dirty/unknown track is surfaced in the result for the human.
const cleanCheck = liveTracks.length
  ? await agent(
      `${mechanicalPreamble('CLEANLINESS CHECKER')} For EACH track below, run \`git -C <path> status --short\` against its worktree and report whether it is fully clean. IGNORE only lines under each track's own gitignored debate scratch dirs (${trackScratchList}); ANY other staged, unstaged, or untracked entry means the track left uncommitted work — set clean=false and report those lines. Report a row for EVERY track listed, even if its worktree looks empty or the command errors (if \`git status\` fails, set clean=false and put the error in dirtyStatus). Do not edit anything. Tracks and their worktrees:
${liveTracks.map((t) => `  - ${t}: ${wtDir(t)}`).join('\n')}
For each track return { track, clean (boolean), dirtyStatus (the offending \`status --short\` lines verbatim, or "" if clean) }.`,
      {
        label: 'consolidate:clean-check',
        phase: 'Consolidate',
        model,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['tracks'],
          properties: {
            tracks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['track', 'clean'],
                properties: {
                  track: { type: 'string' },
                  clean: { type: 'boolean' },
                  dirtyStatus: { type: 'string' },
                },
              },
            },
          },
        },
      },
    )
  : { tracks: [] }
// FAIL CLOSED for cleanup: a track is "preserved" (kept off teardown) unless it is
// safe to discard. A worktree is safe to discard ONLY if it was both (a) EXPLICITLY
// reported clean by the checker AND (b) successfully replayed onto the branch — i.e.
// it ends up in `consolidateOrder`. Everything else is preserved:
//   - a missing clean-check row, or a row that says it's dirty → may hold UNcommitted
//     edits (fail closed on the checker);
//   - a `track-error` track, even one that `git status` calls clean → may hold
//     COMMITTED-but-unreplayed work, since `consolidateOrder` deliberately excludes
//     it (its commit ledger is untrustworthy, so the consolidator never cherry-picks
//     it). Removing its detached worktree would make those commits unreachable.
// `cleanTracks` is the allowlist of explicitly-clean worktrees; `consolidateOrder`
// narrows that to the ones we actually replayed; teardown only touches the latter.
const cleanResultFor = (t) => (cleanCheck?.tracks || []).find((c) => c.track === t)
const cleanTracks = liveTracks.filter((t) => cleanResultFor(t)?.clean === true)

// Only replay tracks that are explicitly clean (every agreed fix really is a
// commit) AND completed without crashing — a `track-error` track is never
// cherry-picked even if its worktree happens to be clean, since its commit ledger
// is untrustworthy. The agent only picks committed work.
const consolidateOrder = cleanTracks.filter((t) => tracks[t]?.status !== 'track-error')

// The terminal statuses that mean a track's review actually FINISHED — codex/lens
// reached consensus (or had nothing to raise), police got a clean final sweep.
// Anything else a consolidated track can carry (police `incomplete` after the
// round cap, lens `unresolved` with findings still contested, codex
// `reviewer-error`/`merge-base-error`) means the gauntlet did NOT fully complete
// for that track, even though its committed fixes are real and DO get replayed.
const COMPLETED_TRACK_STATUS = new Set(['clean', 'consensus'])
// Consolidated tracks whose own review did not reach a completed terminus. Their
// fixes still land (they're committed and clean), but the top-level result must
// not read `done`, or /be would proceed as if the gauntlet fully passed when a
// police/lens sweep was actually cut short. (A `track-error` track is never in
// `consolidateOrder`, so it can't appear here.)
const incompleteTracks = consolidateOrder.filter((t) => !COMPLETED_TRACK_STATUS.has(tracks[t]?.status))
for (const t of incompleteTracks) {
  log(`Consolidate: track ${t} consolidated but its review ended \`${tracks[t]?.status}\` (not a completed terminus) — top-level status will reflect that the gauntlet did not fully finish.`)
}

// Preserve every live track we did NOT consolidate, so neither uncommitted edits
// nor committed-but-unreplayed commits are lost.
const preservedTracks = liveTracks.filter((t) => !consolidateOrder.includes(t))
for (const t of preservedTracks) {
  const row = cleanResultFor(t)
  const ds = row?.dirtyStatus || ''
  const reason =
    tracks[t]?.status === 'track-error'
      ? 'CRASHED (track-error) so its commit ledger is untrustworthy and it was never replayed — its worktree may hold committed-but-unconsolidated fixes'
      : row
        ? 'left UNcommitted changes in its worktree'
        : 'could not be confirmed clean (no clean-check result — failing closed)'
  tracks[t] = {
    ...tracks[t],
    consolidated: false,
    dirtyStatus: ds,
    note: `track ${reason} (${wtDir(t)}); NOT consolidated and its worktree was PRESERVED so any edits aren't lost. Inspect with \`git -C ${wtDir(t)} log ${branchHead}..HEAD\` and \`git -C ${wtDir(t)} status\`.${ds ? `\nOffending entries:\n${ds}` : ''}`,
  }
  log(`Consolidate: track ${t} not consolidated — worktree preserved at ${wtDir(t)}.`)
}

// PRECONDITION GATE. The consolidate prompt below asserts the branch is AT
// `branchHead` (the tracks' shared fork point) and cherry-picks the track commits
// onto it without re-checking. That holds for a normal single run — nothing
// advances the main worktree between Setup and here. But on an ABNORMAL re-run
// (e.g. /be-review invoked twice in the same worktree without resetting), the
// branch HEAD has already moved PAST `branchHead` to the previously-consolidated
// commits; the Setup clean-tree preflight only rejects an UNcommitted tree, so a
// clean-but-advanced HEAD sails through. Cherry-picking again would stack the
// track commits a second time, silently double-applying every fix. Verify the
// precondition mechanically (`rev-parse HEAD` == `branchHead`) and abort with a
// `consolidation-precondition-failed` status rather than picking onto a drifted
// HEAD — the worktrees are PRESERVED for the human to inspect and re-run from a
// clean fork point.
const headCheck = await agent(
  `You are a MECHANICAL PRECONDITION CHECKER. Run \`git -C ${repoPath} rev-parse HEAD\` and report the FULL SHA it prints, verbatim. Do not edit anything, do not cherry-pick, do not run any other command.`,
  {
    label: 'consolidate:precondition',
    phase: 'Consolidate',
    model,
    schema: { type: 'object', additionalProperties: false, required: ['head'], properties: { head: { type: 'string', description: 'the full HEAD SHA from `git rev-parse HEAD`' } } },
  },
)
const currentHead = (headCheck?.head || '').trim()
if (currentHead !== branchHead) {
  log(`Consolidate: ABORTING — branch HEAD is ${sha9(currentHead) || '(unknown)'} but the tracks forked from ${sha9(branchHead)}. The branch has drifted (likely an already-consolidated re-run); cherry-picking now would double-apply every fix. Worktrees PRESERVED.`)
  return {
    status: 'consolidation-precondition-failed',
    branchHead,
    finalHead: currentHead || branchHead,
    base,
    order: [],
    tracks,
    consolidation: null,
    reconciled: [],
    dropped: [],
    note: `consolidation precondition failed: the branch in \`${repoPath}\` is at \`${currentHead || '(unknown)'}\` but the review tracks forked from \`${branchHead}\`. The HEAD has advanced past the shared fork point — likely a re-run in an already-consolidated worktree — so cherry-picking the track commits would stack them a SECOND time and double-apply every fix. Nothing was consolidated and the per-track worktrees are PRESERVED. Reset the branch to \`${branchHead}\` (\`git -C ${repoPath} reset --hard ${branchHead}\`) or start from a clean worktree, then re-run.`,
    worktrees: liveTracks.map((t) => ({ track: t, path: wtDir(t) })),
  }
}

const consolidatePrompt = `${mechanicalPreamble('CONSOLIDATOR')} You are consolidating the results of a parallel code-review gauntlet onto the branch in the MAIN worktree at \`${repoPath}\`. ${consolidateOrder.length} review track(s) (${consolidateOrder.join(', ')}) each ran to consensus in their own detached worktree, all forked from branch HEAD \`${branchHead}\`, each committing its agreed fixes on top. Your job: replay every track's commits onto the branch, in the given order, reconciling the rare overlap.

The branch in \`${repoPath}\` is currently AT \`${branchHead}\` (the tracks' shared fork point). Process tracks in THIS order: ${consolidateOrder.join(' → ')}.

Each track's worktree (use these EXACT absolute paths):
${consolidateOrder.map((t) => `  - ${t}: ${wtDir(t)}`).join('\n')}
For each track, get its new commits oldest-first:
  \`git -C <that track's worktree> rev-list --reverse ${branchHead}..HEAD\`
(An empty list means the track found nothing to change — skip it.)

Then cherry-pick each of those commits onto the branch IN THAT ORDER:
  \`git -C ${repoPath} cherry-pick <sha>\`

- **Clean pick** → record outcome \`clean\` with the new SHA (\`git -C ${repoPath} rev-parse HEAD\`).
- **Conflict** (\`git -C ${repoPath} status\` shows unmerged paths) → this is an OVERLAP: an earlier track already changed the same lines. Resolve by Reading both sides (ABSOLUTE paths under \`${repoPath}\`) and producing a result that HONORS BOTH fixes (they each came from a review debate — neither is noise). Edit the conflicted files to the merged result, \`git -C ${repoPath} add\` them, then \`git -C ${repoPath} cherry-pick --continue\` (keep the original commit message). Record outcome \`reconciled\`, list the conflicted files in \`files\`, and explain the merge in \`note\`. Only \`drop\` a commit (\`git -C ${repoPath} cherry-pick --abort\`) if the earlier track's change already FULLY subsumes this one — record outcome \`dropped\` with the overlapping \`files\` and say so in \`note\`; never drop to avoid the work of merging.

Do NOT push and do NOT merge — leave the consolidated commits on the local branch for the human. Return the final branch HEAD and the per-commit \`picks\` ledger (in processing order); the overlaps you reconciled are just the picks whose outcome isn't \`clean\`.`

const consolidation = await agent(consolidatePrompt, { label: 'consolidate:cherry-pick', phase: 'Consolidate', model, schema: CONSOLIDATE_SCHEMA })
const picks = consolidation?.picks ?? []
const reconciled = picks.filter((p) => p.outcome === 'reconciled')
const dropped = picks.filter((p) => p.outcome === 'dropped')
log(`Consolidate: ${picks.length} commit(s) replayed, ${reconciled.length} reconciled, ${dropped.length} dropped. HEAD ${(consolidation?.finalHead || '').slice(0, 9)}`)

// ---------------------------------------------------------------------------
// Phase 4 — post a detailed PR comment for EVERY track + the consolidation
// ledger. This is the review trail the whole gauntlet exists to leave; it runs
// here (not in the caller) so it ALWAYS happens. `--no-comment` suppresses it.
// ---------------------------------------------------------------------------
phase('Report')

const comments = {}
if (postComments) {
  // Data-drive Report over every REQUESTED track (the `TRACKS` set), not just the
  // live ones: a track whose worktree failed in Setup is in `tracks` as
  // `track-error`, and each builder renders that as a "Track error" comment — so
  // setup failures get a PR comment too, keeping the documented one-comment-per-
  // requested-track audit trail instead of silently omitting the dropped track. A
  // per-track comment builder keyed by track name; adding/removing a reviewer costs
  // Report nothing — no hardcoded track literal to keep in sync.
  // Bespoke per-track builders; any requested track without one falls back to
  // `genericComment`, so the map below stays TOTAL over `TRACKS` — a new reviewer
  // track gets a comment even before it grows a hand-written builder.
  const builder = { codex: codexComment, lens: lensComment, police: policeComment }
  // Each item is [slug, structuredData, deterministicBaseline]. The baseline is
  // both what a reporter agent improves and the fallback when `richComment` is off
  // or the track is trivial. The consolidation ledger is a WORKFLOW-level artifact,
  // not a track artifact, so it posts as its own comment — surviving any track
  // subset instead of being string-stapled onto whichever track happens to be present.
  const items = [
    ['consolidation', consolidation, consolidationSection(consolidation, consolidateOrder)],
    ...TRACKS.map((t) => [t, tracks[t], (builder[t] || genericComment)(tracks[t])]),
  ]
  // Author the bodies — a rich reporter AGENT for non-trivial tracks (in parallel),
  // the deterministic baseline otherwise — then POST sequentially for a stable
  // order. A failed/empty authoring falls back to the baseline, so Report never
  // skips a comment.
  const authored = await parallel(
    items.map(([slug, data, baseline]) => () =>
      richComment && hasRichContent(slug, data)
        ? reporterBody(slug, data, baseline, REPORT_GUIDANCE[slug] || '')
            .then((body) => [slug, body])
            .catch(() => [slug, baseline])
        : Promise.resolve([slug, baseline]),
    ),
  )
  for (const item of authored) {
    if (!item) continue
    const [slug, body] = item
    const url = await postComment(slug, body)
    comments[slug] = (url || '').trim()
    log(`Report: posted ${slug} comment${comments[slug] ? ` → ${comments[slug]}` : ''}`)
  }
} else {
  log('Report: --no-comment — skipping PR comments.')
}

// ---------------------------------------------------------------------------
// Phase 5 — tear down the per-track worktrees. Only worktrees we actually
// CONSOLIDATED (explicitly clean AND replayed onto the branch — i.e.
// `consolidateOrder`) are torn down. Everything else is PRESERVED, since its
// worktree may be the only place its edits live and force-removing it would
// discard them: uncommitted edits the clean-check caught, a worktree the checker
// never reported on, OR a crashed `track-error` track whose committed-but-
// unreplayed fixes were deliberately excluded from consolidation. Fail closed.
// ---------------------------------------------------------------------------
phase('Cleanup')

const teardownTracks = consolidateOrder
if (preservedTracks.length) log(`Cleanup: preserving ${preservedTracks.length} worktree(s) not consolidated (${preservedTracks.join(', ')}) — they may hold uncommitted or unreplayed committed edits.`)
if (teardownTracks.length) {
  await agent(
    `${mechanicalPreamble('CLEANUP RUNNER')} Remove EACH of these worktrees, then prune; ignore errors if one is already gone. Do NOT touch any other path.
${teardownTracks.map((t) => `  - \`git -C ${repoPath} worktree remove --force ${wtDir(t)}\``).join('\n')}
Then: \`git -C ${repoPath} worktree prune\`. Leave the gitignored \`${SCRATCH}\` directory (it holds commit-message + comment scratch); do not delete the branch's commits. Return "done".`,
    { label: 'cleanup:worktrees', phase: 'Cleanup', model },
  )
} else {
  log('Cleanup: no consolidated worktrees to tear down (all preserved or none live).')
}

// Top-level status reflects whether EVERY requested track actually (a) landed on
// the branch AND (b) ran its review to a completed terminus. Two ways it falls
// short of `done`:
//   - a PRESERVED track (uncommitted edits, an unconfirmed worktree, or a crashed
//     `track-error` whose committed fixes were deliberately not replayed) means at
//     least one reviewer's fixes live ONLY in a side worktree; or
//   - an INCOMPLETE track (consolidated, but its review ended `incomplete`/
//     `unresolved`/`reviewer-error` rather than `clean`/`consensus`) means the
//     gauntlet was cut short for that track even though its fixes landed.
// Either way `done` would overstate the outcome and let /be continue as if the
// gauntlet fully passed. Surface `consolidation-incomplete` (the preserved tracks'
// recovery notes are already on each `tracks[t]`; the incomplete tracks carry their
// own non-terminal status) so the caller adjudicates instead of silently shipping.
const status = preservedTracks.length || incompleteTracks.length ? 'consolidation-incomplete' : 'done'
if (preservedTracks.length) {
  log(`Done: status=consolidation-incomplete — ${preservedTracks.length} track(s) preserved, not consolidated: ${preservedTracks.join(', ')}. Their worktrees hold the only copy of those fixes; see each track's note for the recovery cherry-pick.`)
}
if (incompleteTracks.length) {
  log(`Done: status=consolidation-incomplete — ${incompleteTracks.length} track(s) consolidated but their review did not finish (${incompleteTracks.map((t) => `${t}=${tracks[t]?.status}`).join(', ')}); re-run the gauntlet (or that track) before treating the change as fully reviewed.`)
}
return {
  status,
  branchHead,
  finalHead: consolidation?.finalHead || null,
  base,
  order: consolidateOrder,
  tracks,
  consolidation,
  reconciled,
  dropped,
  // Tracks whose fixes were NOT consolidated onto the branch (preserved worktrees);
  // empty in the common case. Non-empty ⇒ status is 'consolidation-incomplete'.
  preservedTracks,
  // Tracks that WERE consolidated but whose review ended on a non-terminal status
  // (police `incomplete`, lens `unresolved`, codex `reviewer-error`); their fixes
  // landed but the gauntlet didn't fully finish. Non-empty ⇒ 'consolidation-incomplete'.
  incompleteTracks,
  comments,
}
