---
name: odu
description: Drive CI with `odu` — one shared service, reached from a terminal (`odu surface`), from an agent (`odu mcp`), or from a browser. Trigger when the user asks to "run CI", "run the pipeline", "re-run a check", to run named lanes or recipes (e.g. "run fmt and nix", "just the e2e lane", bare selectors like `fmt`/`nix`/`e2e`), or names a recipe by `<recipe>@<platform>`. This skill — not a repo's local `just ci` / `just <recipe>` — is how an odu-run request is served, whichever face you are on.
---

# odu

[`odu`](https://github.com/juspay/odu) (Tamil ஓடு — "run") runs a repository's
`just` recipe DAG tagged `[metadata("ci")]` across machines, posts a GitHub
commit status per `<recipe>@<platform>`, and keeps every run in a per-user
catalog.

**There is one shared service and one vocabulary.** A per-user singleton
(`http://127.0.0.1:18440`) owns every run. Three faces project the same
thirteen verbs — and none of them has a verb of its own:

```
run_start · run_wait · run_read · run_retry · run_cancel · log_read
catalog_import · catalog_prune · pipeline_read
venue_probe · venue_hold · venue_release · protect_apply
```

| Face | Spelling | Who uses it |
| --- | --- | --- |
| terminal | `odu surface <verb> --input '{…}' --json` | you, with shell access |
| agent | MCP tools of the same names | you, in an MCP host |
| browser | `odu web` | the human |

The two spellings below are the same call. Use whichever face you have; never
mix vocabularies, and never reach for a face-specific workaround.

> **A request to run CI is a request to run `odu` — never `just ci`.** Many
> consuming repos expose a `just ci` (or `just <recipe>`) that runs a pipeline
> locally. Do **not** shell out to it: it bypasses everything odu gives you —
> the durable run record, per-node GitHub statuses, structured failures with
> addressed evidence, fail-fast, retry and cancel. "run CI", "run fmt and nix",
> "re-run the e2e lane" all mean *drive an odu run through the verbs below*.

**Run keys are host-global.** Every address is a run id or a key built from one
— never a path relative to whoever is calling. Your cwd is not a fact about
what the user meant, so `run_start` takes the checkout as an explicit absolute
path, and `run_start` is the only verb a filesystem path appears in at all.

**The face holds no run authority.** Every call goes over the wire to the
singleton. A harness restarting your MCP server kills nothing, two agents are
two clients of one truth, and the run outlives whoever started it.

---

## The loop

```
1. bootstrap   — a face, once, unpinned from upstream
2. run_start   — absolute checkout + expectedSha + YOUR requestId
3. run_wait    — bounded; feed the returned cursor back as `after`
4. log_read    — on a failure's logKey, echoed verbatim
5. run_retry   — same commit; a NEW commit is a new run_start
6. verify      — scope, sha, contentSha, reportingDebt, before you say "green"
```

### 1. Bootstrap

Nix is the only supported way to run odu, and the reference is **unpinned
upstream**. `--accept-flake-config` is not optional for an agent: odu's flake
declares a binary cache, and without the flag `nix run` stops on an interactive
trust prompt your tool call cannot answer.

```sh
nix run --accept-flake-config github:juspay/odu -- web --background
```

Every face bootstraps for you: `odu surface …` and the MCP bridge dial the
singleton and, **at the default origin only**, start one and verify it is ready
before issuing your call. So in practice you just issue the verb. Run `web
--background` explicitly when you want the service up before the first verb, or
want its URL to hand the human.

- Bare `odu web` **serves in this terminal until Ctrl-C**. Never run it from a
  tool call — it will block until your timeout. `--background` is the agent's
  spelling.
- A face **never** recovers a failed dial by executing locally. If bootstrap
  fails you get exit 3 and a reason, not a silent local run.
- An `--origin` naming somewhere OTHER than your own service is dialled and only
  dialled — a typo reports "nothing is serving there" rather than spawning a
  daemon that could not bind that address anyway. Your own origin still
  bootstraps, whether it is the default or one `$ODU_WEB_ORIGIN` moved.

### 2. Start

```sh
odu surface run_start --input '{"checkout":"/abs/path/to/repo","expectedSha":"'"$SHA"'","requestId":"fix-lint-1"}' --json
```

```jsonc
// MCP tool: run_start
{ "checkout": "/abs/path/to/repo", "expectedSha": "<sha>", "requestId": "fix-lint-1" }
// optional: selectors[], platforms[], hostPins[], root, noDeps,
//           noStrict, noSnapshot, noPost, supersede
// hostsFile is a terminal's own $ODU_HOSTS. Omit it — you have no shell,
// and omitting it keeps the service's configured inventory.
```

`selectors` are `recipe[@platform]` — `["ci::e2e"]`, `["fmt","nix"]`,
`["ci::unit@x86_64-linux"]`. Empty means the whole `[metadata("ci")]` DAG on
every configured platform. `platforms` slices the fanout; `noDeps` runs only
the named nodes.

- **`checkout` is absolute and explicit.** Read it from the repo you are working
  in; do not pass a relative path and do not assume the service shares your cwd.
- **`expectedSha` is a hard check.** A checkout that has moved on is refused
  (`checkout_refused`), never quietly a different run.
- **`requestId` is mandatory, and that is the feature.** See below.
- A checkout that already has a live run does **not** get a second one, and this
  is an ANSWER rather than a refusal: you get `accepted: false` with `existing`
  naming the run that is already there. Observe it, or repeat the call with
  `supersede: true` — which cancels the WHOLE live run in that checkout.

The receipt carries `runId`, `requestId`, `sha`, `scope`, a usually-null
`endpoint` (the coordinator has not bound its socket yet), and a `cursor`
positioned at the run's beginning — pass that cursor straight into your first
`run_wait` so you resume rather than replay.

**Lost replies are why `requestId` exists.** Mint one id per *intent*, never per
attempt. If a reply is lost — a timeout, a killed tool call, a restarted harness
— repeat the call with **the same id and the same input**: you get the recorded
receipt back with `replayed: true`, and no second run. A fresh id is a licence
to run twice; never mint one to "retry a call". Two rules follow:

- `request_conflict` — that id was used for a *different* input. Pick a new id
  for the new intent, or resend the original input.
- `request_unresolved` — the request was accepted and its outcome is genuinely
  unknown. Do **not** re-issue it with a new id. Look for the run
  (`odu surface keys runs` / `get runs`, or the board) and reconcile from what
  is actually there.

### 3. Wait — bounded, resumable, fail-fast

```sh
odu surface run_wait --input '{"runId":"'"$RUN"'","after":"'"$CURSOR"'","deadlineMs":120000}' --json
```

```jsonc
// MCP tool: run_wait
{ "runId": "<run>", "after": "<cursor>", "deadlineMs": 120000 }
// optional: settle (wait for the whole run), limit (page size)
```

`reason` is what you branch on:

| `reason` | Meaning | Next move |
| --- | --- | --- |
| `failure` | A red node whose evidence is ready. **A normal result, not an error.** | Read `failures[].excerpt`, then `log_read` its `logKey`. Start fixing now. |
| `still_running` | The deadline passed with nothing red. | Ask again with the returned `cursor` as `after`. |
| `settled` | The whole run is done. | Verify (step 6). |
| `owner_lost` | The coordinator is provably gone without finalizing. | Start a fresh run. |

**Fail-fast is the point.** `run_wait` returns on the first *actionable* red —
a failure whose log has had its last word — while the slow lanes keep running.
`failures[]` is a floor, not the final tally: more lanes may still go red. Do
**not** sit through the remaining lanes to "see the full status", and do not pad
`deadlineMs` and block. The loop is wait → fix → wait again.

**`passed: true` is only trustworthy with `settled: true`.** Never infer green
from a bounded wait that saw nothing red.

**Feed the cursor back.** Every answer carries a `cursor`; pass it as `after`
next time and you are not shown the same events twice. It suppresses repeats and
resolves nothing — a red node you already saw is still red. A cursor from
another run is refused (`bad_cursor`) with a `resync` route rather than silently
restarted; that bites hardest after a retry that relaunched (step 5).

**Terminal handling: Ctrl-C ends an OBSERVATION, not the run.** An interrupted
or disconnected wait exits 130 and the run carries on — as does a wait that
simply hit its deadline. Re-attach with `run_wait` and your last cursor.
**Stopping work is an explicit act**: `run_cancel`.

### 4. Diagnose — addressed evidence

```sh
odu surface log_read --input '{"key":"'"$LOG_KEY"'","offset":-4096}' --json
```

```jsonc
// MCP tool: log_read
{ "key": "<logKey from failures[]>", "offset": -4096 }   // negative offset = tail; limit pages
```

- **Echo the `logKey` verbatim.** A run id, a node and an attempt travel as one
  token precisely so no caller reassembles them from parts. Never build a path.
- `complete: false` means the producer's last word is missing — the evidence is
  truncated, not "the recipe was quiet". Say so rather than concluding from it.
- `excerptSource: "none"` on a failure means the log was unreadable. That is
  never a pass and never "flaky".
- Page forward with `nextOffset`; `eof` is about this read, `complete` is about
  the log.
- **`log_read` also FOLLOWS.** Pass `waitMs` and it holds until the log grows
  past the end of this page, the attempt finishes, or the deadline passes. Feed
  `nextOffset` back as `offset` — that is the cursor, and YOU hold it, so a call
  that dies is re-issued rather than resumed. Stop when `open` is false. A
  `size` smaller than the offset you asked for means that attempt was re-run and
  its log rewritten: start again from 0. `odu logs -f` / `--wait-ms` is the same
  follow from a terminal.
- Watching a live node instead of reading evidence? Subscribe to the
  `logTails` resource — `surface://collections/logTails/<key>` as MCP, or
  `odu surface get logTails "$KEY" --follow` as ndjson. (`watch` is not mounted
  on `logTails`: it carries no delta verb, because its key set is whatever
  happens to be subscribed rather than a set of runs.) Evidence for a verdict is
  always `log_read`.

### 5. Retry the same commit — or start the new one

```sh
odu surface run_retry --input '{"runId":"'"$RUN"'","selector":"ci::unit@x86_64-linux","requestId":"retry-unit-1"}' --json
```

```jsonc
// MCP tool: run_retry
{ "runId": "<run>", "selector": "ci::unit@x86_64-linux", "requestId": "retry-unit-1" }
// optional guard: expectAttempt { node, attempt }
```

`selector` is `<recipe>@<platform>`, `@<platform>`, or a bare recipe name.

- **Retrying is not your choice to make.** `run_retry` resets nodes on a live
  coordinator when there is one and starts a linked replay run when there is
  not, and tells you which in `mode` (`live` | `relaunched`).
- **Watch `effectiveRun`, not the run you asked about**, and use the receipt's
  `cursor`. A `relaunched` retry is a NEW run; your old cursor belongs to its
  parent and will be refused.
- **Siblings are preserved.** `roots` are the nodes actually reset and
  `resetDependants` their consequence; every other lane keeps running, keeps its
  venue and keeps its statuses.
- `expectAttempt` refuses (`stale_attempt`) if the node moved past the attempt
  you read. Use it when acting on a reading you took a while ago.
- `requestId` is mandatory here too, with exactly the semantics of step 2.

**Retry vs. supersede — the rule that costs the most to get wrong.**

| Situation | Verb | What it does |
| --- | --- | --- |
| One lane failed; same commit | `run_retry` | Re-runs that selector (and its dependants). Cancels nothing. |
| A **new commit** fixes it | `run_start` on the new sha, `supersede: true` if a run is live in that checkout | Replaces the WHOLE run, every lane. |

A new commit is a new run — never a retry, which replays recorded inputs with
the old commit pinned. And superseding to retry a flaky lane throws away the
darwin lane that was still running and green: the expensive operation for a job
the cheap one does.

**Cancelling** is `run_cancel` with an explicit scope — `{"kind":"run"}`,
`{"kind":"node","node":"ci::fmt@x86_64-linux"}` or
`{"kind":"lane","platform":"aarch64-darwin"}` — plus a `requestId`. The answer
echoes what was actually cancelled; `effective: "nothing"` with a `detail` means
nothing was, and is not a cheerful ok.

### 6. Verify before you call CI green

Three checks, every time, from the wait answer or the board row:

- **`scope` — a selection is not a pipeline.** `{selectors, platforms, root?,
  noDeps}`. A green over three recipes is a green over three recipes. Only an
  empty `selectors` and empty `platforms` (and no `noDeps`) is "CI is green".
  Say what you actually ran.
- **`sha` and `contentSha` — are these the inputs you meant?** Compare the base against the commit you asked
  for. A `dirty` run on the board is a verdict about a working tree, not about a
  commit.
- **`reportingDebt` — statuses that did not land.** Debt never blocks settle
  (the test verdict is the truth), but an unwritten required context is what
  blocks a merge. A green run with debt is not a green PR; report it.

And say `passed` only from `settled: true`.

---

## Verb reference

| Verb | argv | MCP tool | Input | Answers |
| --- | --- | --- | --- | --- |
| start | `odu surface run_start --input '{…}' --json` | `run_start` | `checkout`, `expectedSha`, `requestId`, `selectors?`, `platforms?`, `hostPins?`, `hostsFile?` (a terminal's own `$ODU_HOSTS`; agents omit it), `root?`, `noDeps?`, `noStrict?`, `noSnapshot?`, `noPost?`, `supersede?` | `accepted`, `runId`, `replayed`, `sha`, `scope`, `endpoint`, `cursor`, `existing?` |
| wait | `odu surface run_wait --input '{…}' --json` | `run_wait` | `runId`, `after?`, `deadlineMs?` (30s default), `settle?`, `limit?` | `reason`, `settled`, `passed`, `outcome`, `failures[]`, `failuresTotal`, `cursor`, `remaining`, `reportingDebt[]`, `scope`, `sha`, `contentSha?`, `dirty?` |
| diagnose | `odu surface log_read --input '{…}' --json` | `log_read` | `key`, `offset?` (negative = tail), `limit?`, `waitMs?` (follow) | `text`, `offset`, `size`, `nextOffset`, `eof`, `complete`, `open` |
| retry | `odu surface run_retry --input '{…}' --json` | `run_retry` | `runId`, `selector`, `requestId`, `expectAttempt?` | `mode`, `effectiveRun`, `parentRun`, `roots[]`, `resetDependants[]`, `scope`, `sha`, `cursor` |
| cancel | `odu surface run_cancel --input '{…}' --json` | `run_cancel` | `runId`, `scope`, `requestId` | `effective`, `detail` |
| read | `odu surface run_read --input '{…}' --json` | `run_read` | `runId`, `after?`, `limit?` | `run_wait`'s answer, without the waiting |

### Beyond one run

The same vocabulary reaches everything else odu does. These used to be local
commands that each did their own work in your process — which meant an agent
and a browser simply could not do them at all.

| Verb | argv | MCP tool | Input | Answers |
| --- | --- | --- | --- | --- |
| resolve a pipeline | `odu surface pipeline_read --input '{…}' --json` | `pipeline_read` | `checkout`, `root?` | `checkout`, `name`, `tasks[]`, `mermaid` — the DAG, without running it |
| list machines | `odu surface venue_probe --input '{}' --json` | `venue_probe` | *(none)* | `source`, `warnings[]`, `rows[]` — the lanes and who holds them |
| hold a machine | `odu surface venue_hold --input '{…}' --json` | `venue_hold` | `checkout`, `platforms?`, `hostsFile?`, `noWait?`, `requestId` | `results[]` (`held` / `waiting` / `already`), `replayed` |
| release it | `odu surface venue_release --input '{…}' --json` | `venue_release` | `checkout`, `platforms?`, `hostsFile?`, `requestId` | `released[]` (`effective`: `released` / `nothing`), `replayed` |
| import old runs | `odu surface catalog_import --input '{…}' --json` | `catalog_import` | `checkout`, `dryRun?`, `requestId` | `imported[]`, `skipped[]`, `catalog` |
| expire old runs | `odu surface catalog_prune --input '{…}' --json` | `catalog_prune` | `retentionDays?`, `dryRun?`, `requestId` | `expired[]`, `kept[]`, `retentionDays`, `dryRun`, `replayed` |
| require odu's checks | `odu surface protect_apply --input '{…}' --json` | `protect_apply` | `checkout`, `branch?`, `platforms?`, `hostsFile?`, `dryRun?`, `create?`, `requestId` | `repo`, `branch`, `contexts[]`, `rulesetId`, `applied`, `created`, `derivedFrom`, `detail`, `replayed` |

- **`requestId` is an idempotency key on these three too.** A repeat with the
  same id replays the recorded answer and performs nothing — which is what
  stops a lost reply's retry from releasing a hold somebody else has taken
  since, or overwriting a ruleset edited in between. A repeat with the same id
  and DIFFERENT input is `request_conflict`; one whose first attempt's outcome
  is unrecorded is `request_unresolved`, and the answer to that is to read the
  current state, never to re-issue under a fresh id. `replayed` says which you
  got.
- **A hold outlives your session.** `venue_hold` records the lease against a
  *checkout*, and the holder is the service's child rather than yours — so it
  survives your process ending, and you must `venue_release` it. `noWait` gives
  you `waiting` instead of a queue.
- **`protect_apply` writes to GitHub.** Run it with `dryRun: true` first and read
  `contexts` — that is exactly the set odu will require. `derivedFrom` being
  non-null means the platform set came from this machine's hosts file rather
  than from you; a repository's required checks should not depend on whose
  laptop ran the command, so name `platforms` explicitly when it matters.
  `create: true` is needed to make a ruleset that does not exist yet, because
  creating protection nobody asked for is not a recovery. Writing needs a `gh`
  the serving process can authenticate with; without one you get
  `no_credential`, which is fixable rather than fatal — `dryRun` still answers.
- **`catalog_prune` never expires a run with a live owner** — it reports it in
  `kept` with a reason instead.

Reading state without a verb — the same three resources on both faces:

```sh
odu surface keys runs            # the board: every registered run
odu surface get runs "$RUN"      # one row (state, sha, scope, passed, reportingDebt, cursor)
odu surface get service          # who is serving, which build, is it ready
odu surface watch runs           # follow the board
odu surface --help               # the whole projection
odu history list [--all] [--limit N] [-o json]   # the catalog from a terminal
```

MCP resources: `surface://cells/service`, `surface://collections/runs`,
`surface://collections/logTails/{key}`.

`odu run` is the human's one-shot spelling of the same thing: it calls
`run_start` for the checkout you are standing in and then observes. Its options
are `run_start`'s inputs plus four of its own — `--no-wait` (start and return
without observing), `--request-id`, `--origin` and `-o json`. Ctrl-C stops
observing; the run keeps going.

## Refusals, and what to do about them

A refusal is odu declining the request — not CI failing, and not a transport
error. `code` is what you branch on; `message` is for the human; `resync` and
`suggestion` carry the recovery where there is one.

| `code` | Next move |
| --- | --- |
| `bad_input` | Fix the input; it could not have meant anything. |
| `unknown_run` / `expired` | The run is not in the catalog (or aged out). Find it on the board, or start a fresh run. |
| `bad_cursor` | Run the `resync` it carries. Usually a cursor from a parent run after a `relaunched` retry. |
| `checkout_refused` | Not a git repo, or the checkout moved off `expectedSha`. Re-read HEAD and re-issue. |
| `not_replayable` | Dirty live tree, or the checkout is gone. Start a new run instead of retrying. |
| `request_conflict` | Same id, different input. New intent ⇒ new id. |
| `request_unresolved` | Outcome unknown. **Do not re-issue with a new id** — find the run and reconcile. |
| `stale_attempt` | The node moved past your `expectAttempt`. Re-read, then decide again. |
| `launch_failed` | The service could not start the coordinator; the message says why. |
| `pipeline_refused` | The checkout's `justfile` could not be resolved into a DAG; the message says what broke. |
| `no_venue` | No lane matched — the hosts file configures none for that platform. Read `venue_probe`. |
| `no_credential` | The serving process has no usable `gh`. Authenticate it, or use `dryRun`. |

## Exits — two vocabularies, and `1` means opposite things

**`odu surface` exits are about the CALL**, not about CI:

| Exit | Meaning |
| --- | --- |
| 0 | Answered — **including an answer that reports red CI**. |
| 1 | odu declared a refusal (one JSON line on stderr, with a `code`). |
| 2 | Usage error; the call never left the process. |
| 3 | Nothing serving (and, at the default origin, odu tried to start it and says why). |
| 130 | Interrupted — the observation ended, the run carries on. |

**`odu run` / `odu wait` exits are about CI**, because that is what they answer:

| Exit | Meaning |
| --- | --- |
| 0 | Settled, and it passed. |
| 1 | **There is a failure to act on.** Not a refusal — red CI. |
| 2 | Still going, nothing red yet. Ask again with the returned cursor. |
| 3 | Its coordinator is gone and it never finalized. Start a fresh run. |
| 4 | No such run, or its evidence expired. |
| 5 | The request itself was refused. |

Read that difference carefully before you branch on a number: exit 1 from
`odu surface` is odu refusing you, and exit 1 from `odu run` is your tests
failing. An agent that conflates them reports a broken test as a broken tool.

## Wiring the MCP face

The launcher ships beside this skill at `serve`, installed as
`.agents/skills/odu/serve`. It is one line — unpinned upstream, over stdio:

```sh
exec nix run --accept-flake-config github:juspay/odu -- mcp "$@"
```

`.mcp.json` (Claude Code; the same command for Codex / opencode / Gemini CLI):

```json
{ "mcpServers": { "odu": { "type": "stdio", "command": ".claude/skills/odu/serve" } } }
```

It is deliberately **not** under a `bin/` directory: apm deploys a skill's whole
directory tree but skips a top-level `bin/` whenever stdout is not a terminal,
which is every CI install — so a launcher placed there would be named in your
`.mcp.json` and never actually written.

The bridge dials the singleton, bootstraps it if nothing is serving, and
projects the thirteen verbs and three resources. It starts no coordinator and
holds no run authority, so a harness restarting it kills nothing.

## Nothing stays local

Every public command goes through the service, including `odu dump` and
`odu graph` — both are `pipeline_read`, and an agent can call that verb
directly. They used to be listed here as a deliberate exception on the grounds
that a `justfile` read touches no run. That was wrong: what odu will run for a
checkout is a question `run_start` answers through the same engine, so a face
answering it locally is a SECOND RESOLVER of the one thing you most need to be
able to trust — and it could disagree with the run it is meant to predict.

## Hosts

Lanes need machines. `$ODU_HOSTS` (a file path) → `~/.config/odu/hosts.json`:

```json
{ "x86_64-linux": ["ci-1", "ci-2"], "aarch64-darwin": "me@mac-mini.local" }
```

Keys are Nix system tuples; values are anything ssh dials, a list of them (a
pool), or `localhost`. A run that resolves **zero** lanes is refused, never
defaulted to `localhost`. `hostPins` (`"P=ADDR"`) pins one box for one run;
`venue_probe` shows the inventory from any face; `odu hosts [platform…]` is its
terminal spelling.

**`$ODU_HOSTS` belongs to the caller, and travels with the request.** The
service is a per-user singleton, so the process that starts your coordinator is
not the one a person typed into. Every verb that resolves a host inventory —
`run_start`, `venue_probe`, `venue_hold`, `venue_release`, `protect_apply` —
takes `hostsFile`: a path, or `""` for "this shell has none". **An agent omits
the field entirely**, which means "I have no shell and no preference" and
leaves the service's own configuration standing.

A finalized retry replays the PARENT's inventory, recorded in its manifest, and
refuses (`not_replayable`) for a record written before odu wrote it down — a
replay that resolved against today's fleet is not a replay.

A lane host needs ssh + Nix + outbound https,
and the source arrives by `git fetch` of the **pushed** SHA — remote lanes
fetch pushed commits in strict mode. With `noStrict`, odu ships a snapshot of the working tree, unpushed commits included.

## What changed (state it honestly if asked)

- `odu runs` is gone. Use `odu history list` (or the `runs` resource); the JSON
  shape differs.
- `odu run --linger` is gone from the public verb — it only meant something when
  a human attached to a coordinator directly.
- There is one MCP face. Bare `odu mcp` **is** the shared-service bridge; the
  old per-checkout tools (`run`, `node_rerun`, `wait_for_settle`, `cancel`,
  `runs`, `node_cancel`, `lane_cancel`, `lease`, `release`) no longer exist.
  `--service` is still parsed, ignored and warned about for one release, so
  existing `.mcp.json` argv does not crash.
- The per-run coordinator is internal execution machinery, reached only through
  a hidden verb. Do not invoke it, and do not dial `.ci/odu.sock`.

## When NOT to use this skill

- Questions about odu's internals or design history — read the
  [README](https://github.com/juspay/odu/blob/master/README.md).
- Project-specific CI operations (warm pools, banned flags, which lanes are
  required) — that is the consuming repo's operational docs, layered on top of
  this reference.

### Working-tree development

Use `run_start` with `noStrict: true` to snapshot current tracked edits, deletions and non-ignored new files consistently across local and remote workers/shards. This never posts GitHub statuses, even on a clean tree. `noSnapshot: true` takes precedence and runs in place on localhost only (including ignored dependencies/build outputs).

When verifying, compare the answer's base `sha` **and** `contentSha`: a `contentSha` means a working tree was tested, not just `sha`. The board, `run_read` and `run_wait` expose this identity, and each lane's `_ci-setup` lists the overlay. A new edit is a new intent: use a new request id. Cache-hit evidence requires identical `contentSha`; red-to-green edits change it. Finalized working-tree runs need a new `run_start`; live retries retain the same snapshot.

`.ci/` and ignored files are excluded. Sparse checkouts and submodule changes are refused; Git clean filters apply and LFS files travel as pointers. Capture fails on any Git error. Bundles are limited to 64 MiB (`ODU_SNAPSHOT_MAX_BYTES`); oversized captures name the largest paths. Recipes recreate ignored dependencies and outputs in their detached workspace.

Bundle creation and `ODU_SNAPSHOT_MAX_BYTES` apply only when the selected pool may use remote transport. Local-only working-tree runs need no origin and do not pack repository history.

To see `dirty` and `contentSha` over MCP, run the `odu mcp` bridge from the same build as the service; older bridges can drop these fields.
