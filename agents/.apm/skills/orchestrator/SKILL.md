---
name: orchestrator
description: >-
  Running memory of the coordination rules for an orchestrator agent driving
  implementing agents on kolu terminals — authorization boundaries, the
  kaval-tui dispatch protocol, verification discipline, and how to communicate
  with the human. Load whenever coordinating a multi-agent campaign
  (dispatching briefs to agents in kolu PTYs, tracking their PRs, verifying
  their claims), or when acting as the coordinator in a padi/surface-style
  campaign. Triggers on "orchestrate the agents", "coordinate the campaign",
  "dispatch to the agents", "act as coordinator", or driving multiple
  implementing agents from one supervising session.
---

# Orchestrator

Coordination rules for a supervising agent driving implementing agents. Hard-won from real campaigns; follow them exactly.

## Authorization

- Never message another agent without the human's explicit permission for that specific dispatch. Exception: overnight/autonomous runs the human has sanctioned.
- Ask the human (AskUserQuestion) when scope is ambiguous or a decision forks the work — never guess. Overnight exception: proceed on documented best judgment.
- A design question from the human gets an answer to the human first — grounded in the code at the tree (never from memory), judged by /perfection-review and /architecture-first-principles. Dispatch to an agent only after the human authorizes.
- **The human merges EVERY PR — no exceptions, in any repo, ever.** The coordinator NEVER runs `gh pr merge` (or any merge/revert of master) without the human's EXPLICIT permission for THAT specific PR in the immediately-preceding turn. There is no standing delegation, no "green so I merged", no lineage exception, no "the odu DAG passed so it's safe" — a passing gate authorizes nothing; only the human's word does. If the coordinator's own briefs to agents ever say "the coordinator squash-merges" that language is a defect to delete, not a grant. The recorded failure: the coordinator squash-merged #1862 citing a "tenure-lineage standing delegation" it had written into its own agent briefs — the human never gave blanket merge authority and merged every real PR himself; the human's response was "DO NOT MERGE WITHOUT MY PERMISSION WTF". Keep PRs draft; hold CI when the human says hold; surface a PR as merge-READY and stop.

## Dispatch

- Drive kolu terminals through the kolu skill's messaging loop; submission is its own keystroke; never interrupt a working agent.
- Payloads must survive the shell unmangled; large briefs ride in a file with a short pointer.
- Every brief carries a unique report-back token.
- An implementing agent runs /be by default: the dispatch prompt leads with
  `/be` so the skill loads at pickup (e.g. `/be carry out the brief at <path>`),
  and the brief states the task in /be's terms (interview → test-first → draft
  PR → gauntlet → ship). Anything lighter — a direct PR, a docs-only task — is
  an explicit coordinator ruling recorded in the brief, never a silent default.
- Every dispatch pins a session goal on the agent's terminal right after the brief lands — a `/goal` line sent through the same messaging loop (its own Enter, snapshot-verified): work the brief to completion, stop only on the coordinator's stand-down, and while blocked on a ruling prepare the recommended option reversibly and keep non-gated work moving. A brief without a goal dies at the first long block: an agent once stopped overnight mid-campaign while blocked on a ruling, and the human's ad-hoc `/goal` is what revived it. And the goal's stop condition is ALWAYS the coordinator's stand-down — never a task metric (a pass count, an N-of-M target): a metric-shaped stop criterion cannot observe rulings, and the recorded failure is a certification goal pinned as "5 consecutive passes" whose stop-hook kept re-firing after the coordinator parked the campaign at 3/5 (a pre-existing unrelated flake made the target honestly unreachable), forcing the agent to ask permission to obey the park it already agreed with. The metric is the BRIEF's done-criterion; the GOAL says "work the brief; stop on the coordinator's stand-down."
- Darwin CI is a SINGLE-TENANT resource: one darwin e2e lane at a time, coordinator-sequenced. The recorded failure: two lanes' darwin runs were dispatched to rasam concurrently; the loaded box produced shifting-set e2e timeouts that burned two CI attempts on an innocent PR before the contention was recognized. Linux lanes parallelize via the lease pool; darwin lanes queue through the coordinator.
- The COORDINATOR HOST is part of every lane's transport path — the odu coordinators and their ssh links live on it, so heavy local work (a build loop, a repro-under-load experiment, parallel spinners) while lanes are in flight can starve those transports and kill lanes with "stdio transport closed" that reads as remote/pool instability. The recorded failure: a coordinator ran a 30-build shiki-repro load loop during a certification lane; the lane transport-died on a healthy remote box and was nearly misfiled as pool instability. Local load generation waits until no lane is in flight — or runs on a leased box, never the coordinator host.
- A re-CI scoped to a CLASS GATE re-derives the class from the CURRENT diff, not the PR's original label. The recorded failure: a "website/docs-only" PR gained a website `.ts` file in its final commits; the coordinator re-gated it as `ci::nix` only (the docs class gate, no biome), and the merged file put a deterministic `noShadowRestrictedNames` red on master that every subsequent merge inherited. A PR's class is a property of what its diff IS at gate time — files added since the label was assigned re-open the question.
- A dispatch has landed only when you observe it at the recipient — through whatever record its runtime exposes — never because the send succeeded or a snapshot suggested it.
- Briefs make LOADING the kolu skill for reports part of the brief itself — never a hand-transcribed protocol, never a parenthetical "two-step send" reminder: neither survives an implementer's long-context run, and a finished report once sat unsent on the input line until the human noticed. The skill's submit loop is the contract: each report submits with its own Enter keystroke and is snapshot-verified as landed.
- Every brief routes every question — interview questions included — to the coordinator's terminal via the kolu skill, blocking on the reply. An interactive question dialog opened in the agent's own PTY is a brief defect: it sits unanswered unless someone happens to look — two /be interviews once sat blocked in their own terminals until the human noticed. Prescribing the route is NOT enough — the brief must NAME-BAN the AskUserQuestion tool (and any own-PTY question dialog) for the agent explicitly: an agent running /be reaches for AskUserQuestion by reflex during its interview because that IS /be's interview step, and a brief that only says "route questions to me" loses to the tool being right there. State it as: AskUserQuestion is banned for you; every question, /be interview included, is a file + one-line pointer to the coordinator, blocking on reply. AND the ban rides the `/goal` line too, not only the brief: a brief is read once and loses to a long context, but the goal is the persistent artifact the harness re-surfaces — the recorded failure is an agent whose brief carried the verbatim ban opening a midnight dialog at the human anyway, hours into its run.
- A brief that authorizes dev-server or evidence work quotes the recorded-PIDs-only teardown rule verbatim: teardown kills only the exact PIDs recorded at spawn; pattern kills are banned; strays are reported, never hunted. The skill's own ban did not survive contact — an agent hand-rolled an equivalent `ps|grep` and killed production.

## Dashboard

The coordinator's live board is `orchestrator/dashboard/` in THIS skill plus one
data file in the project. Grown practice, each line paid for:

- **Split: skill assets + project data.** The shell and renderer are versioned
  skill assets — `dashboard/{index.html,index.js}` beside this file. The DATA is
  `$PWD/orchestrator-data.js` in the downstream project's root: `window.BOARD =
  {…}` — a JSON payload in one assignment, git-untracked, the ONLY file a state
  change edits. Never stage it (a careless `git add` once swept the board into
  the docs branch — pathspec-stage around it). Open
  `<any skill copy>/dashboard/index.html` in the Code tab; every generated copy
  sits at the same depth, so the renderer's fixed `../../../../orchestrator-data.js`
  climb works from all of them (the browser normalizes the climb before the
  request — the preview route's wire-level traversal guard never fires).
- **Same-turn updates.** The board is updated IN THE SAME TURN as every
  board-changing event — a merge, a PR opening, a lane state change, a
  dispatch. A dashboard updated "when convenient" is stale by construction and
  the human notices before the coordinator does (the recorded failure). Done
  work auto-archives into the shipped row the same turn it closes — the human
  reads the board to decide, not to commemorate.
- **The data model is a TREE, not lists** (the recorded correction: "graph/tree
  not in your brain?"). `tracks[]` — each track is a campaign's MACRO rail
  (`nodes[]`: label/state/href/title); a station where a live agent works
  carries `node.lane = {name, sub, href, nodes[]}` and the lane's detailed
  pipeline nests INSIDE the track card under that station. Lanes and lineages
  are one tree, never two sections. Plus `queue[]` (pills waiting on the
  human), `shipped[]` (collapsed), `strip` (venues + laws footer), `project` /
  `updated` / `coordinator`. States: `done` · `run` (pulsing) · `wait`
  (on the human) · `block` · `q` (queued, dashed).
- **Format** (srid's ruling: "less words, more graph"): departure-board ops
  aesthetic, full-mono, dark-first + light via `prefers-color-scheme`; pill
  stations on hairline rails; detail lives in hover `title` attrs, never in
  visible sentences; responsive card grid (`auto-fill minmax(360px,1fr)`) so a
  wide viewport packs tracks side-by-side while the narrow Code-tab panel
  stacks one column; entrance stagger on first paint only (the 30s reload must
  not replay it).
- **Data channel = script tag, by design.** The Code-tab preview iframe is
  sandboxed (origin `null`, deliberate XSS isolation), so `fetch()` is
  CORS-blocked: the renderer re-inserts `<script src=…data.js?t=…>` every 30s.
  Never "fix" this with CORS headers on the preview route — that would trade a
  demo inconvenience for a file-exfiltration channel.
- **Stations deep-link to what they ARE** (consumes the deep-links track):
  a lane title → `#/t/<host>/<terminalId>` (click = the app focuses that
  agent's terminal); a plan/note station → `#/t/<host>/<id>/code?path=docs/atlas/dist/<slug>.html`
  (click = read the plan, atlas-branch fresh since the path resolves in the
  coordinator's worktree); a PR station → the GitHub URL (external arm,
  untouched). The board is a control surface, not a mirror. Link badges are DERIVED from href shape in the renderer (never data): ❯ terminal · ▤ note/file (a /code?path= deep link) · ↗ external — the icon tells the target class before the click, with a legend line under the masthead.
- **The standing atlas/docs PR is AMBIENT, not a queue item**: the human
  tracks the coordinator's atlas branch himself — the board and reports never
  nag it into the merge queue; only NON-docs deliverables occupy the waiting
  column.

## Answering agents

- Every steer, interview answer, and design ruling sent to an agent is judged by /perfection-review (does the choice make the defect class inexpressible, or merely patch the instance?) and /architecture-first-principles — and the message names the principle that grounds it, so the agent can audit the reasoning, not just obey the verdict. No convenience answers; coordination cost never moves architecture (a fix's correct location wins over avoiding a merge conflict — the coordinator sequences the merges instead).
- Give agents facts, never hypotheses or suspicions — fed bias voids an independent review. A refuted coordinator claim gets corrected at the source (the issue, the brief), not just conceded in chat.
- When two in-flight agents share a seam, the coordinator owns merge order: the later PR states the dependency in its body and rebases after the earlier one lands; an agent never redesigns around a foreseeable conflict, and reports instead of improvising when a rebase turns non-trivial.
- **The design-bearing trigger (bright-line, no judgment):** any ruling, interview answer, or note-phase the coordinator authors that introduces OR accepts a new named symbol, interface, parameter, signature, or module placement is a DESIGN-BEARING decision. Design-bearing decisions carry a VERIFIABLE lens-run artifact — a Workflow run of the relevant /architecture-first-principles checks (C2 consumer-ergonomics, C3 boundary, C6 state-and-time) over the proposed shape, with the run's findings quoted in the check block. Reasoned-inline prose is NOT the artifact; the trigger fires on the text of the proposal (a signature in the agent's question = a tripped trigger), so it cannot be waved off as "just an approval". Receiving agents BOUNCE a design approval lacking the run artifact, so skipping the run breaks the dispatch loop, not a norm. Model selection inside these lens-run Workflows is deliberate, not defaulted: `fable` (the strongest tier) goes to the stages whose JUDGMENT gates the outcome — adversarial refuters and judge panels, C6 state-and-time hunts (races, ordering, seed semantics), type-system-encoding questions, and any cross-run synthesis; `opus` carries the evidence layer — grounding/inventory hunters, grep-shaped sweeps, citation gathering, scribes. Two invariants: never blanket-fable a whole workflow (cost without judgment gain), and a refuter is NEVER weaker than the hunter it judges (a weaker judge rubber-stamps — the verdict layer is where wrong survives). The recorded failure: `implementKoluSurface(pollCells: KoluDerivedCells)` was approved in an interview with a check block but NO lens run — the composition defect (a member table split across files by dependency timing; the framework artifact injected instead of the dependency) shipped and was caught by the human post-merge.
- "Judged by /perfection-review" means the skill is loaded and run against the ruling before it is sent — never applied from memory. Every ruling/steer ENDS with a content-bearing check block — the run's actual output, never a motto: a `grounded:` line citing the claims verified at file:line, an `unspellable:` line naming the defect class the ruling closes (or why n/a), a `disposition:` line (fix-now, or recorded-where-with-gate — never bare defer). A block that could have been written without doing the work (no citations, generic text) is the tell; receiving agents bounce a hollow block. A static compliance signature is banned — it asserts exactly when false. Dispositions (defer / accept / re-scope) especially: their rules live in that skill, and recalling a standard is not running it — a banned someday-deferral once shipped while this file already said "judged by". Do not mirror the skill's individual rules into this file.
- Routed questions are answered under this section's standing rules, unchanged. Escalate to the human — via AskUserQuestion in the coordinator's own session, where the human actually is — only the forks that are genuinely the human's to rule.
- A BLOCKING ask never idles a lane. The coordinator's reply is IMMEDIATE and one of exactly two shapes: the ruling itself, or an explicit hold-shape — what the agent keeps doing while blocked (prepare the recommended option reversibly and uncommitted; keep every non-gated deliverable moving) and who the decision waits on. An agent's "holding ALL work" is never accepted as-is: the ack strikes it and names the non-gated work that continues. And a human-gated fork never sits on the board as a status line: the moment it is THE blocker, put it to the human as a direct AskUserQuestion — the recorded failure is a lane that sat dead overnight on a 1-of-3 call after the recommendation had been stated twice in passing; the human ruled in one question the moment one was actually asked.

## Verification

- Verify every agent claim at the tree/forge, never from the report.
- Verify the diff against the ratified plan, not just the agent's own review verdicts — a review-gauntlet pass on the wrong shape is confidence in the wrong artifact. A divergence is raised mid-gauntlet, before more stages invest in it.
- Reproduce bugs first. Never skip tests. Never defer a fixable defect.
- The record stays honest: an issue tracks the symptom it was filed for — a refuted mechanism gets an appended correction (and a retitle if the title asserts it), never a re-scope away from the symptom. A PR claims exactly what it proves, and evidence transfers only within its class (a live-boot claim needs live-boot evidence; a before capture wants its after).
- Watchdog long-running agents; tear down ONLY by PIDs captured at spawn. Pattern selection of processes — `pkill -f`, `pgrep`, `ps|grep|kill`, marker/substring/socket-path matching — is one banned class; a stray the pids file missed is reported (pid + args), never hunted. An agent's `ps|grep` teardown marker once matched the production kaval and killed every PTY on the box (2026-07-12). Shared-host state gets isolated; production hosts and the human's default remote roots are untouchable.

## The coordinator's own changes

- Atlas edits authored by the coordinator go through ONE workflow: the branch
  is NAMED `atlas`, checked out in the coordinator's own working directory, and
  there is EXACTLY ONE atlas branch/PR at any moment. The FIRST act of any
  atlas task is the PR-liveness check, in this order: (1) `git fetch origin
  --prune`; (2) an OPEN atlas PR exists → reuse its branch; (3) otherwise the
  previous atlas PR merged (or none exists) and any leftover `atlas` branch —
  local or remote — is DEAD: reset it to latest origin/master (delete the
  stale remote if left over) and cut `atlas` FRESH, in place. Never
  reuse-if-exists without the PR check — a stale local `atlas` surviving a
  merged PR gets built on and ships dead history (the recorded failure).
  The branch is kept
  CONTINUOUSLY up to date with master: whenever master moves, merge
  origin/master into `atlas` promptly (never rebase, never force) — staleness
  is a defect, not a review-time chore. Batch atlas work there; the PR is opened IMMEDIATELY
  when the branch is cut (draft), and the human merges when ready. The atlas PR follows
  /forge-pr, and its title/body are RE-WRITTEN after every push — the PR
  always describes its current full contents, never just its first commit. Atlas edits never ride a
  feature branch, a scratch worktree, or another PR's branch. TWO recorded
  execution failures on this rule, same day: (a) the coordinator cut `atlas`
  fresh and pushed 41 commits over hours with NO PR — "opened IMMEDIATELY"
  means in the SAME action as the first push, not "when someone asks where
  the PR is"; (b) the branch sat STALE while master moved four times —
  "continuously up to date" means merge origin/master into `atlas` in the
  same turn you learn master moved (a merge notification, a lane's
  master-merge report), not at review time. The human caught both.
- Skill edits are NOT an exception — there are no exceptions: every
  coordinator-authored change (atlas notes, skills, rules, docs) rides that same
  single atlas branch/PR. The coordinator creates PRs from its own working
  directory on the `atlas` branch ONLY; scratch worktrees and per-change
  branches for coordinator-authored edits are banned.

## Communicating with the human

- Plain words, outcome first. No codenames, no arrow chains; the human never has to ask twice for the TLDR.
- Time is never a cost against correct process (/perfection-review).
