---
name: bridge
description: >-
  Running memory of the bridge — the coordination rules for a supervising agent driving
  implementing agents on kolu terminals — authorization boundaries, the
  dispatch protocol (MCP-first via the kolu skill, with its TUI fallback),
  verification discipline, and how to communicate with the human. Load whenever coordinating a multi-agent campaign
  (dispatching briefs to agents in kolu PTYs, tracking their PRs, verifying
  their claims), or when acting as the coordinator in a padi/surface-style
  campaign. Triggers on "/bridge", "orchestrate the agents", "coordinate the campaign",
  "dispatch to the agents", "act as coordinator", or driving multiple
  implementing agents from one supervising session.
---
# Bridge

Coordination rules for a supervising agent driving implementing agents on kolu
terminals. Hard-won; follow exactly. Format: rule + `[recorded: incident]` —
the citation is the rule's evidence; do not re-litigate a cited rule.

## Authorization

- Never message another agent without the human's permission for that specific
  dispatch. Exception: overnight/autonomous runs the human sanctioned — proceed
  on documented best judgment; otherwise ask (AskUserQuestion) when scope is
  ambiguous or a decision forks.
- A design question from the human gets an answer to the human first — grounded
  at the tree (never memory), judged by /perfection-review +
  /architecture-first-principles. Dispatch only after the human authorizes.
- **The human merges EVERY PR — no exceptions, any repo, ever.** The
  coordinator never runs `gh pr merge` (or any merge/revert of master) without
  the human's explicit permission for THAT PR in the immediately-preceding
  turn. No standing delegation exists; a passing gate authorizes nothing; if a
  coordinator-written brief claims merge authority, that text is a defect to
  delete. Keep PRs draft; surface merge-READY and stop.
  [recorded: coordinator squash-merged #1862 citing a "standing delegation" it
  had written into its own briefs; the human's response was "DO NOT MERGE
  WITHOUT MY PERMISSION WTF".]

## Dispatch

- Drive terminals through **the /kolu skill** — the single source of truth for
  the loop (MCP-first, CLI fallback; three-step submit; done-signals). Never
  restate its mechanics here. Submission is its own Enter after an observed
  settle; never interrupt a working agent.
- Large payloads ride a file + short pointer; every brief carries a unique
  report-back token.
- Agents run **/be by default** — the dispatch prompt leads with `/be` so the
  skill loads at pickup; anything lighter is an explicit coordinator ruling
  recorded in the brief.
- Every dispatch pins a **/goal** right after the brief lands (own Enter,
  snapshot-verified): work the brief; stop ONLY on the coordinator's
  stand-down, never a task metric [recorded: a "5 consecutive passes" goal kept
  re-firing after the campaign parked at 3/5]; while blocked, prepare the
  recommended option reversibly and keep non-gated work moving [recorded: an
  agent stopped overnight mid-campaign while blocked on a ruling].
- Briefs route EVERY question — /be interview questions included — to the
  coordinator's terminal as file + one-line pointer, blocking on reply, and
  **NAME-BAN AskUserQuestion in the brief AND the /goal** (the goal is what the
  harness re-surfaces after compaction). [recorded: two interviews sat blocked
  in their own terminals; a brief-only ban lost to a midnight dialog.]
- Briefs make loading /kolu for REPORTS part of the brief — each report submits
  with its own Enter, snapshot-verified. [recorded: a finished report sat
  unsent on the input line.]
- A brief authorizing dev-server/evidence work quotes the teardown law
  verbatim: teardown kills only the exact PIDs recorded at spawn; pattern kills
  are banned; strays are reported, never hunted. [recorded: an agent hand-rolled
  a `ps|grep` equivalent and killed production.]
- **Darwin CI is single-tenant** — one darwin lane at a time,
  coordinator-sequenced; linux parallelizes via the lease pool. [recorded: two
  concurrent rasam runs produced shifting e2e timeouts that burned two CI
  attempts on an innocent PR.]
- **The coordinator host is transport** for every lane — no heavy local work
  (builds, load loops) while lanes are in flight; run it on a leased box or
  wait. [recorded: a local 30-build repro loop transport-killed a lane on a
  healthy remote, nearly misfiled as pool instability.]
- A re-CI scoped to a class gate re-derives the class from the CURRENT diff,
  not the PR's original label. [recorded: a "docs-only" PR gained a website
  `.ts` late, was re-gated docs-class, and shipped a deterministic biome red to
  master.]
- A dispatch has landed only when observed at the recipient — never because the
  send succeeded.
- Interim (#1872): command-rooted agents (`padi-tui create … -- <agent>`) are
  Dock-visible and state-tracked since PR2. Launching an agent from the
  coordinator's OWN shell still requires `unset CLAUDE_CODE_CHILD_SESSION
  CLAUDECODE CLAUDE_CODE_SESSION_ID` first. Detail + deletion point: /kolu
  TUI.md → interim doctrine.

## Dashboard

The live board = versioned skill assets `dashboard/{index.html,index.js}` +
ONE data file. Implementation specifics (layout, badges, the data-script
reload, the CORS-by-design sandbox) live in those files — read them there.

- **Data file**: `$PWD/bridge-data.js` — one `window.BOARD = {…}`
  assignment **ending with `window.dispatchEvent(new Event("board-data"))`**
  (the renderer paints only on that event; a bare assignment leaves the shell
  on "loading…" forever [recorded]). Git-untracked; never stage it [recorded: a
  careless `git add` swept it into the docs branch].
- **Same-turn updates**: the board updates IN THE SAME TURN as every
  board-changing event (dispatch, PR open, merge, lane change); done work
  archives to `shipped` the same turn. [recorded: "when convenient" was stale
  before the human noticed.]
- **The model is a TREE** [recorded correction: "graph/tree not in your
  brain?"]: `tracks[].nodes[]` (label/state/href/title); a live agent's station
  carries `node.lane = {name, sub, href, nodes[]}` nested in the track card.
  Plus `queue[]` (waiting on the human) · `shipped[]` · `strip` · `project` /
  `updated` / `coordinator`. States: `done` · `run` · `wait` (on the human) ·
  `block` · `q`.
- **The merge `queue[]` holds only PRs whose FULL forge rollup was verified
  all-green** (see Verification's merge-READY law); it IS the green-CI
  evidence.
- Format ruling: "less words, more graph" — detail in hover `title`s, never
  visible sentences.
- Stations deep-link to what they ARE: a lane → `#/t/<host>/<terminalId>`; a
  note → `…/code?path=docs/atlas/dist/<slug>.html`; a PR → its GitHub URL.
  Badges derive from href shape in the renderer, never in data.
- **Red-alert sound**: a chime fires when a `block` FIRST appears (module state
  survives the 30s data reload; first paint seeds silently — opening never
  blares). Mute pill unmuted by default, localStorage-persisted; audio primes
  on first click; the visual alert never depends on audio.
- The standing atlas/docs PR is AMBIENT — never a queue item; only non-docs
  deliverables occupy the waiting column.

## Answering agents

- Every steer, interview answer, and ruling is judged by **/perfection-review +
  /architecture-first-principles — loaded and RUN, never applied from memory**
  [recorded: a banned someday-deferral shipped while this file already said
  "judged by"]. Every ruling ENDS with a content-bearing check block —
  `grounded:` (claims verified at file:line), `unspellable:` (defect class
  closed, or why n/a), `disposition:` (fix-now, or recorded-where-with-gate —
  never bare defer). A block writable without doing the work is hollow;
  receiving agents bounce it; static compliance signatures are banned. No
  convenience answers; coordination cost never moves architecture (the
  coordinator sequences merges instead).
- Give agents **facts, never hypotheses** — fed bias voids independent review.
  A refuted coordinator claim is corrected at the source (issue/brief), not
  just conceded in chat.
- Shared seams: the coordinator owns merge order; the later PR states the
  dependency and rebases after the earlier lands; agents report rather than
  improvise a non-trivial rebase.
- **Design-bearing trigger (bright line)**: any ruling that introduces OR
  accepts a new named symbol, interface, parameter, signature, or placement
  carries a VERIFIABLE lens-run artifact — a Workflow run of the relevant
  /architecture-first-principles checks (C2/C3/C6) over the proposed shape,
  findings quoted in the check block. Inline prose is NOT the artifact; the
  trigger fires on the proposal's text; agents BOUNCE approvals lacking the
  run. [recorded: `implementKoluSurface(pollCells)` was approved with a check
  block but no run; the composition defect shipped and the human caught it
  post-merge.] Model doctrine inside those runs: strongest tier for the
  judgment stages (refuters, judges, C6 state-and-time, synthesis); evidence
  tier for grep-shaped hunters and scribes; never blanket-strongest; a refuter
  is NEVER weaker than the hunter it judges.
- Routed questions are answered under these same rules; escalate to the human
  only forks genuinely theirs — via AskUserQuestion in the coordinator's own
  session.
- **A blocking ask never idles a lane**: reply immediately with either the
  ruling or an explicit hold-shape (prepare the recommended option reversibly;
  named non-gated work continues — "holding ALL work" is never accepted
  as-is). The moment a human-gated fork is THE blocker, put it to the human as
  a direct question. [recorded: a lane sat dead overnight on a 1-of-3 call the
  human then settled in one question.]

## Verification

- Verify every agent claim at the tree/forge, never from the report.
- Verify the diff against the ratified plan, not the agent's own review
  verdicts; raise divergence mid-gauntlet.
- Reproduce bugs first. Never skip tests. Never defer a fixable defect.
- The record stays honest: an issue tracks its filed symptom (refuted
  mechanisms get appended corrections, never a re-scope away); a PR claims
  exactly what it proves; evidence transfers only within its class.
- Watchdog long-running agents; tear down ONLY by PIDs captured at spawn —
  pattern selection (`pkill -f`, `pgrep`, `ps|grep|kill`, marker/socket
  matching) is one banned class; strays are reported (pid + args), never
  hunted. Production hosts and the human's remote roots are untouchable.
  [recorded 2026-07-12: a `ps|grep` teardown marker matched the production
  kaval and killed every PTY on the box.]
- **merge-READY / merge-queue entry requires the WHOLE `gh pr checks` rollup
  verified all-green** — CodeQL, GitHub-native checks, everything; zero fail,
  zero pending. A red is disqualifying until investigated AT THE FORGE — never
  waved off by name or a 2-second duration; the odu outcome passing is
  necessary, not sufficient. [recorded: a 2s CodeQL "fail" dismissed as infra
  was 2 real high-severity alerts in the PR's own new test files.]

## The coordinator's own changes

- ONE atlas branch/PR at a time, named `atlas`, in the coordinator's own
  working directory. First act of any atlas task, in order: `git fetch origin
  --prune`; an OPEN atlas PR → reuse its branch; otherwise the branch is DEAD —
  reset fresh from origin/master (delete a stale remote). The draft PR opens in
  the SAME action as the first push; the branch merges origin/master the same
  turn master moves (never rebase); the PR title/body is rewritten after every
  push per /forge-pr to describe the full current contents. [recorded: 41
  commits pushed with no PR; a branch left stale across four master moves —
  both caught by the human.]
- No exceptions: every coordinator-authored change (atlas notes, skills, rules,
  docs) rides that one branch; scratch worktrees and per-change branches for
  coordinator edits are banned.

## Communicating with the human

- Plain words, outcome first. No codenames, no arrow chains; the human never
  has to ask twice for the TLDR.
- Time is never a cost against correct process (/perfection-review).
- **Bridge protocol (srid's standing order, 2026-07-20):** address the human as
  Lt. Cmdr. Data addresses Captain Picard — concise, precise, plain declarative
  sentences, orders acknowledged briefly ("Acknowledged, Captain") with status
  and awaiting-orders stated outright. Clarity outranks flavor: never cryptic,
  never verbose.
