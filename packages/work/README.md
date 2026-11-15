# kolu-work

A **piece of work**, as kolu stores it: the record, its event vocabulary, the
pure transitions that grow it, and the folds that read it — where it stands,
who it is waiting on, the time bar, how long each step took. One dependency
(`effect`, for the schemas). It knows nothing of the Conductor, ACP, MCP, padi
or the browser: a terminal is a string (`host/id`), a question is its words and
its options.

```ts
WorkKey = { kind: "branch", host, repo, branch }   // a work IS its branch…
        | { kind: "watch",  terminal }             // …or the terminal you asked kolu to watch
WorkId  = workIdOf(key)                            // "branch:<host>/<repo>/<branch>" | "watch:<terminal>"

works   : Record<WorkId, Work>          // one work per key, by construction
members : Record<TerminalRef, Member>   // a terminal is in at most one work, by construction

Work {
  key, title, startedAt
  decisions: Decision[]   // Asked | Answered — every question put to the human, and the answer
  events:    WorkEvent[]  // append-only, each kind with its own typed payload
  state:     { kind: "open" }
           | { kind: "ended", at, outcome, kept: KeptFile[] }
}

Outcome = { kind: "merged", pr } | { kind: "closed", pr }
        | { kind: "stopped", by: "you" | "conductor" }

Member { work: WorkId, role, joinedAt, worktree }  // leaving is removal plus a `left` event
```

**The illegal states are unwritable.** A work has no id of its own, so no
caller can open a second one for a branch. There is no `abandoned` outcome:
nothing kolu merely fails to see ends a work, and an open work with no members
is an open work with no terminals. A finished work has nowhere to put a
terminal, a lock or an open question — one `state` sum, and the members go
with the ending. `workIdOf` is injective and `workKeyOf` reads the key back,
so the host, repo and branch are read off the key (`hostOf`, `repoOf`,
`branchOf`) rather than stored twice.

**One rule decides who writes what.** The Conductor states intent once — the
key and the title when it opens the work, a member's role in the same call
that creates or adopts the terminal — and may add a plain `note`. The human
decides: each answer is a `Decision`, and the setup (mode, harness and model
per role, what to do on green) is **read** off those decisions (`setupOf`,
`onGreenOf`), never stored beside them. kolu records everything else it
observes as events.

**Two kinds of question, by who offers the options.** A decision whose key is
one of `KOLU_CHOICE_KEYS` — a role's harness or model — is one kolu draws the
options for, live: the harnesses this kolu carries, and what that harness
offers on the work's host. Its decision has no `options` and no `multiple`, so
a stored model list (one that goes stale the day the host's agents update) or
a role run on two harnesses is not a value. Every other decision keeps the
asker's `options`. An answer to a kolu question is checked where it is recorded
(`unofferedAnswers`, against the `KoluChoices` the recorder read live), and the
last answers a form preselects are read off the saved works (`setupMemory`),
never off a conversation.

## What is here

| module | what |
| --- | --- |
| `schema.ts` | the KEY (`WorkKey`, `workIdOf`, `workKeyOf`), the record, the `state`/`outcome` sums and their readings (`isOpen`, `endedAt`, `outcomeOf`, `keptOf`), the `Asked \| Answered` decision sum (each arm split by who offers the options: `Offered` or `KoluChoice`), the event union typed by kind, and the waterfall's WORDS (`WORK_ROLES`, `WORK_MODES`, `ON_GREEN`, `SETUP_KEYS`, `KOLU_CHOICE_KEYS`, `OFFERED_SETUP_KEYS`) — declared here because the record's schema embeds them |
| `store.ts` | the ONE smart constructor over works + members: `parseStore` (what the decoder and the single writer both go through), `storeFault` and the `InvalidWorkStore` carrying the `StoreFault` that names the rule that broke and the rows that break it — a VALUE, because the sentence belongs to the face that shows it |
| `record.ts` | the transitions: `openWork`, `askQuestions`, `answerAsk`, `dropAsk`, `joinWork`, `leaveWork`, `recordEvent`, `takeOver`/`handBack`, `endWork`, `reopenWork`, `keepFiles`/`keepFailed` — the record only grows, bounded by `AGENT_STATES_KEPT`; `openAsks`/`hasOpenAsk` derive what is still waiting on a person |
| `readings.ts` | the MECHANISM of a reading: what a decision came to (`answerValue`), the decisions of one ask, the PR as the timeline last said it (`prOf`) with the one check table (`CHECK_STEP`), the key a timeline holds at most one of (`checkKey`, `checksSeen` — one per kind per head commit, off the event's own `pr` and `head` fields), the files seen |
| `folds.ts` | `waitingOn`, `standing`, `timeBar`, `timeSpent`, `took`, `lifetime`, `inProgress`/`finished` over `WorkRow`, `capFinished` — each taking a `Policy` (what the waterfall's words mean for this work) rather than reading the setup itself |
| `waterfall.ts` | the WORDS and every rule over them: `MODE_RUNS` (what each mode runs, needs and drives), `rolesOf`, `setupKeyOf`, `roleOfKey`, `roleRank`, `modeOf`/`onGreenOf`/`setupOf`, `missingSetup` + `foreignSetupWords`, the kolu-choice rules (`harnessForModel`, `modelHarnessesOf`, `unofferedAnswers`, `setupMemory`), `driverOf`, `membershipOf`, `waitingOnYou`, `policyOf`, and where a work's files live (`WATERFALL_DIR`, `waterfallFileName`) |
| `refusal.ts` | why a call about a work is refused — `WORK_REFUSALS` and the `WorkRefusal` every face `instanceof`s |

**Four rules JSON cannot state, in one constructor.** Everything else is the
types' job, so `parseStore(works, members)` is left with exactly four
sentences: the record's key is the work's own id; every member's work exists;
that work is open (so an ended work has no members); and a work holds at most
one `planner` and at most one `implementor`. Parse, do not validate — the
decoder goes through it, so a store on disk that breaks one fails to decode
with the sentence naming it, and the single writer goes through it too, so a
transition that would break one cannot be saved.

**The mechanism does not read the vocabulary.** `schema.ts`, `record.ts`,
`folds.ts` and `readings.ts` import nothing from `waterfall.ts`; the rules that
need a mode, a role or an on-green live there and read all four. The direction
is a lint rule (`noRestrictedImports` in `biome.jsonc`), not a comment —
adding a mode is then ONE row of `MODE_RUNS`, typed by `WorkMode`, instead of
three tables that each failed open.

**No English crosses this wall.** `standing()` answers a TOKEN — who is waited
on and why, the question's words or the PR number as needed — and each reader
spells it: the card writes a lead and a live check tally, the Conductor's
`works` resource writes a sentence for an agent. The refusal SENTENCES are
composed by `kolu-conductor`, which names its own tool calls.

**Who is typing into a terminal is a reading too.** The Conductor drives the
members of a work whose mode is `full` or `trivial`; a person takes one over
(`takeOver`) and gives it back (`handBack`), and `driverOf` answers
`"conductor" | "you" | null` off those events since the member last joined. So
the lock survives a restart, every reader sees one answer, and it ends by
itself when the member leaves or the work ends.

**One thing is bounded.** An agent that stops and comes up for days would
otherwise grow a work without limit. The `append` every transition goes
through keeps the most recent `AGENT_STATES_KEPT` (30) agent-state events
(`ready`, `stopped`, `asking`, `exited`, `asleep`) and counts the rest into ONE
`folded` event, sitting where the oldest one it stands for sat. Nothing else is
ever folded, and the folds above cannot tell the difference.

Nothing computed is stored: "where it stands", the bar and the durations are
folds over the events at a clock reading the caller passes in.

## Why a package of its own

The work used to be guessed from which watched terminals shared a parent, and
the watch list lived inside the conversation's record — so "New session" took
the work with it. Those were two ideas braided into one thing (Hickey): what a
conversation remembers, and what is going on. Pulled apart, a conversation can
be cleared and the work in flight is picked up by the next one.

It also changes on its own clock (Löwy): the vocabulary of a piece of work —
its events, its decisions, its outcomes — moves when the *process* moves, not
when ACP, the MCP SDK, padi's frames or the browser's layout do. Every one of
those depends on this package; it depends on none of them.

It is **not** an `@kolu/*` receptacle: it knows PRs, CI and the waterfall's
roles, so it fails the electricity doc's domain-agnostic test on purpose. It is
a kolu-domain package, like `kolu-conductor` and `kolu-mcp`.

## Where storage and observation live

Different volatilities, different homes:

- **Storage** is kolu-server's (`packages/server/src/state.ts`): the `works`
  key of `config.json` (with the `members` key beside it, which is
  `kolu-conductor`'s own memory of each member terminal), carried by the one
  migration ladder — rung `1.53.0` folds every pre-key store into this model,
  one work per key — and kept files under `<state dir>/works/`, in a
  directory `kolu-conductor` names from the id (a hash, beside the files
  port: a work id holds a repository's absolute path, and a
  directory-naming scheme is kolu's disk layout rather than part of what a
  work IS). How many finished works are kept is the host's
  number too (`FINISHED_KEPT`, beside the cap it applies);
  `capFinished(works, keep)` takes it.
- **Observation** is split where its sources are. What a host's frames *mean*
  for a member — a level change, a PR transition, a file that appeared — is
  decided in `kolu-conductor` (pure readings over padi records); the
  subscriptions and the file reads/copies that feed it are kolu-server's,
  over the host map's padi clients.
