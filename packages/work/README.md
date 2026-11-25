# kolu-work

A **piece of work**, as kolu stores it: the record, its event vocabulary, the
pure transitions that grow it, and the folds that read it — where it stands,
who it is waiting on, who holds it, the six stages and the trail of visits
through them, how long each step took.
One dependency (`effect`, for the schemas). It knows nothing of the Conductor,
ACP, MCP, padi or the browser: a terminal is a string (`host/id`), a question
is its words and its options.

```ts
WorkKey = { kind: "branch", host, repo, branch, repoBy }  // a work IS its branch…
        | { kind: "watch",  host, id }                     // …or the terminal you asked kolu to watch
RepoBy  = { kind: "git" }            // `repo` is the root git named
        | { kind: "as-written" }     // kept from before: the root git has not been asked
        | { kind: "held", root }     // git named `root`, whose key another work holds
WorkId  = workIdOf(key)              // "branch:<host>/<repo>/<branch>" | "watch:<host>/<id>"

works   : Map<WorkId, Work>          // one work per key, by construction
members : Map<TerminalRef, Member>   // a terminal is in at most one work, by construction

Work {
  key, title, startedAt
  decisions: Decision[]   // Asked | Settled — every question put to the human, and how it ended
  events:    WorkEvent[]  // append-only, each kind with its own typed payload
  state:     { kind: "open" }
           | { kind: "ended", at, outcome, kept: KeptFile[] }
  worktree:  { kind: "unread" } | { kind: "absent" } | { kind: "at", path }
             // where git says the key's branch is checked out, on the key's host
}

Outcome = { kind: "merged", pr } | { kind: "closed", pr }
        | { kind: "stopped", by: "you" | "conductor" | "kolu" }

Answer  = { how: "answered", at, from, value | said }   // always WITH its value
        | { how: "declined", at, from }
        | { how: "dropped", at }

Member { work: WorkId, role, joinedAt }   // where it stands is the terminal's, never the work's
```

**The illegal states are unwritable.** A work has no id of its own: its id is
its key, so one key is one work. One branch is one OPEN work where git has said
the repository root — two keys can name one root, so that one is the store's
rule 5, checked on every write. There is no `abandoned` outcome:
nothing kolu merely fails to see ends a work, and an open work with no members
is an open work with no terminals. A finished work has nowhere to put a
terminal, a lock or an open question — one `state` sum, and the members go
with the ending. `workIdOf` is injective and `workIdParts` reads an id's parts
back, so the host is read off the key (`hostOf`) rather than stored twice, and
the repository and branch are read by matching on `key.kind` — a watch has
none. A work's facts are its key's: its PR is its branch's, its folder is
where git says that branch is checked out, and no member terminal lends it
either.

**Nothing in it is a hole.** Anything that may be absent is an arm of a tagged
sum saying what the absence means — an event about the work or about a
member (`about`), a reason given or none (`why`), a head commit or a host that
reports none (`head`), a worktree not read yet (`worktree`), a request with no
words (`request`), a question with no header or file — or an effect `Option`
for a lookup that may find nothing. There is no nullable field, no optional
one, no `""` standing for "none". An answer always carries its value: a
question left blank is still `asked`, so "answered with nothing" cannot be
stored. `noNull.test.ts` reads this package's sources and fails on a
`NullOr`, `| null`, `| undefined` or optional field.

**One rule decides who writes what.** The Conductor states intent once — the
key and the title when it opens the work, a member's role in the same call
that creates or adopts the terminal — and may add a plain `note`. The human
decides: each answer is a `Decision`, and the setup (mode, harness and model
per role, what to do on green) is **read** off those decisions, never stored
beside them. kolu records everything else it observes as events.

**One reading of a setup question.** `setupStanding(work, key)` says where a
setup key stands — `answered` with its value, `open` in front of the human, or
`unasked` — and everything reads it: `setupOf` (a role's setup is `not-chosen`,
`harness`, or `harness-and-model`: a model is only ever a model of a harness),
`keysToAsk` (what `work_open` asks: every key the work still needs with no
value, the open ones included, whose old question `openSetupQuestions` +
`dropQuestions` replace), and `startBlockers` (what starting a role waits on,
and whether the answer will come by itself or must be asked). Which keys a
work still needs is `needsSetupKey`: all of them until the mode is answered,
then the mode and what that mode runs on — so a planner question left open on
a form answered `trivial` is moot (`unneededSetupQuestions`) and goes.
`setupReading.test.ts` walks random sequences of asks, partial answers,
declines, stops, reopens and `work_open` calls and checks the three agree at
every step.

**Two kinds of setup question, by who offers the options.** A decision whose
key is one of `KOLU_CHOICE_KEYS` — a role's harness or model — is one kolu
draws the options for, live: the harnesses this kolu carries, and what that
harness offers on the work's host (`ModelChoices`: `listed` ids, `unlisted`,
or `unavailable` with the host's words when it could not list just now). Its
decision has no `options`, and its answer is ONE value and HOW IT WAS CHOSEN
(`chosen`: `picked` or `typed`), so a stored model list (one that goes stale
the day the host's agents update) or a role run on two harnesses is not a
value. `mode` and `on-green` keep the asker's options, and their answer is one
of kolu's own words for them, by type. ONE RULE judges a kolu answer
(`unofferedAnswers`): a harness this kolu carries; a PICKED model its harness
listed, or — when the harness cannot list, or the host could not just now — a
model id, upstream agent-distro's own rule; a TYPED model a model id and
nothing more, never held to a list (`modelNotOffered`). It reads one shape,
`KoluAnswer` (a key, its values, how it was chosen, its role's harness), built
from wherever the answer is: the form (`askedAnswersOf`, where a face sends a
typed model as `{ typed }` — `SentAnswer`), the request (`givenAnswersOf`,
held to the list like a pick) or the record (`savedAnswersOf`, when its agent
starts and when `work_open` decides what to ask). `modelHarnessesOf` names the
lists those need: one per picked model, none for a typed one. The words are
`unofferedWhy` / `unofferedWords`. The last answers a form preselects are read
off the saved works (`setupMemory`), each as it was chosen, never off a
conversation — a model is that role's own last one with that harness first.

## What is here

| module | what |
| --- | --- |
| `schema.ts` | the KEY (`WorkKey` with its `RepoBy`, `ParsedWorkKey`, `workIdOf`, `workIdParts`, `rootOf`, `watchedRef`), the record, the `state`/`outcome` sums and their readings (`isOpen`, `endedAt`, `outcomeOf`, `keptOf`), the `Asked \| Settled` decision sum (each arm split by topic: `mode`, `on-green`, a kolu choice, or a question about the work) and its answer sums, the event union typed by kind with its `about` / `why` / `head` / `request` arms (`told` is the Conductor handing the work to a member; `hand-offs-kept` is the upgrade's word that a saved work's hand-offs were not recorded), the PR's draft word (`PR_DRAFT`, which `pr-opened` widens with `unrecorded` and `draft-state` moves), and the waterfall's WORDS (`WORK_ROLES`, `WORK_MODES`, `ON_GREEN`, `SETUP_KEYS`, `KOLU_CHOICE_KEYS`, `OFFERED_SETUP_KEYS`) — declared here because the record's schema embeds them |
| `store.ts` | the ONE smart constructor over works + members: `parseStore` (what the decoder and the single writer both go through), `storeFault` and the `InvalidWorkStore` carrying the `StoreFault` that names the rule that broke and the rows that break it — a VALUE, because the sentence belongs to the face that shows it — and `rekeyed`, the one re-key transition |
| `record.ts` | the transitions: `openWork`, `askQuestions`, `answerAsk` (a blank question stays asked; `answered` or `answered-part` on the timeline), `answeredWith`, `dropAsk`, `dropQuestions`, `joinWork`, `leaveWork`, `recordWorktree`, `recordEvent` (observations only: its type excludes every kind a transition of its own appends), `prEnded` (a merge or close and the ending, naming the timeline's PR — the only door to either), `linkPr` (a PR recorded before kolu kept addresses learns its own, by AMENDING its `pr-opened`), `takeOver`/`handBack`, `endWork` (a stop, by you, the Conductor or kolu: its type takes no other outcome), `reopenWork`, `keepFiles`/`keepFailed` — the record only grows, except for the bounds below and that amend; `openAsks`/`hasOpenAsk` derive what is still waiting on a person |
| `readings.ts` | the MECHANISM of a reading: the decisions of one ask, the PR as the timeline last said it (`prStep`, the ONE statement of the PR-fact rule, and `prOf` over it: its state, its recorded link, whether it is a draft, the last check event and the last merge answer — what the observer compares a reading with, so it records only a CHANGE for that PR at that commit, and what the folds carry to tell green) with the one check table (`CHECK_STEP`), `sameHead` (two facts about one commit, by kind and sha), WHO HOLDS THE WORK (`holdStep`, the ONE statement of the hand-off rule, and `holdingOf`, `holds`, `nobodyHolds`, `holderOf`, `handsOver`, `letsGo`, `joinedAs` and `plannersTurn` — the one question the stage of the agents' time asks — over it, read by the folds, by the agent-state bound and by the Conductor's observer), `prLinks` (each PR number the timeline opened, to the URL recorded with it), the files seen, and why the latest ending did not keep some (`notKeptOf`) |
| `folds.ts` | `waitingOn`, `standing` (a sum: a question with its `ask` and its words, a merge with the `GreenPr` it waits on — number, head and link — when the timeline knows one, CI, the agents, or done), `timeSpent`, `stages` (a `Stages` sum: `unset` none yet, `none` for a mode that declares none, `staged` the six cells with every event filed, `where` the work is or ended and the `trail` of `Visit`s, each cell a `StageState` sum, each place a `Filed`: a stage, the setup or a `Doubt` — `DOUBTS` the one list of them, `DOUBT_STAGES` their two stages — with `canBe` its stages), `visitMs` (a visit's time), `doubtsOf` (each doubt the trail visited, with its time), `movedTimes`/`visitedTimes` (the map's loop counts and a stage's visits, each a `Count`: `exactly`, or `at-least` where a doubt may hide more), `took`, `lifetime`, `inProgress`/`finished` over `WorkRow`, `capFinished` — each taking a `Policy` (`handOver`, and how the work is `run`: `unset`, or `set` with whether it is driven and the stages its mode declares) rather than reading the setup itself |
| `needsYou.ts` | WHAT NEEDS THE HUMAN, `standing` and `WAITER_OF` read as a list: `needsYou` over the rows, `needsYouOf` for one, the `NeedsYou` item (its work and title, the `question` or `merge` arm, `since`, the `wanted` words and the item's `key` — the work, the reason and the ask or the green commit, so a merge answer flickering on one commit is ONE item), and `wantedWords`, the one phrase every face says |
| `waterfall.ts` | the WORDS and every rule over them: `MODE_RUNS` (what each mode runs, needs and drives, and the stages it HAS), `runOf` (a watch key runs the watch row whatever its decisions say), `rolesOf`, `setupKeyOf`, `roleOfKey`, `roleRank`, the one setup reading (`setupStanding`, `setupValue`, `modeOf`/`onGreenOf`/`setupOf`/`roleSetupOf`, `keysToAsk`, `openSetupQuestions`, `startBlockers`), `missingSetup` + `foreignSetupWords`, the kolu-choice rules (`harnessForModel`, `askedAnswersOf`/`givenAnswersOf`/`savedAnswersOf`, `modelHarnessesOf`, `modelNotOffered`, `unofferedAnswers`, `koluKeysOf`, `unofferedWhy`/`unofferedWords`, `setupMemory`), `driverOf`, `membershipOf`, `policyOf`, where a work's files live (`WATERFALL_DIR`, `waterfallFileName`), and a flat list of them read as a tree, the same for a live listing and a kept copy (`waterfallLevel`, `childFolderOf`, `compareWaterfallPaths`, `waterfallBytes`) |
| `refusal.ts` | why a call about a work is refused — `WORK_REFUSALS` and the `WorkRefusal` every face `instanceof`s |

**Six rules JSON cannot state, in one constructor.** Everything else is the
types' job, so `parseStore(works, members)` is left with exactly six
sentences: the record's key is the work's own id; every member's work exists;
that work is open (so an ended work has no members); a work holds at most one
`planner` and at most one `implementor`; no two OPEN works share a host, a
repository root and a branch where git has said the root (`rootOf`); and a
watch holds only its own terminal, as `other`. Parse, do not validate — the
decoder goes through it, so a store on disk that breaks one fails to decode
with the sentence naming it, and `kolu-conductor`'s one writer assigns its
value only through it, so a transition that would break one throws before it
is saved.

**A re-key never removes anything.** `rekeyed(store, id, root, at)` moves a
branch work kept under a key git never named to the key of `root`: stamped
`git` where that is its own id, moved there in its place when the id is free,
or kept under its old key as `held` when another work holds it — and ended
`stopped by kolu` only when both are open, because one branch runs as one
card. Every other work is the same value it was.

**The mechanism does not read the vocabulary.** `schema.ts`, `record.ts`,
`folds.ts` and `readings.ts` import nothing from `waterfall.ts`; the rules that
need a mode, a role or an on-green live there and read all four. The direction
is a lint rule (`noRestrictedImports` in `biome.jsonc`), not a comment —
adding a mode is then ONE row of `MODE_RUNS`, typed by `WorkMode`, instead of
three tables that each failed open.

**Almost no English crosses this wall.** `standing()` answers a TOKEN — who is
waited on and why, the question's words or the PR number as needed — and each
reader spells it: the card writes a lead and a live check tally, the
Conductor's `works` resource writes a sentence for an agent. The one phrase
that lives here is `wantedWords` (`needsYou.ts`): what a wait on the human
asks for, in a few words, because the card's line, the palette's row and the
notification must say the same short thing and three copies would be three
places to drift. The refusal SENTENCES are composed by `kolu-conductor`,
which names its own tool calls.

**Who is typing into a terminal is a reading too.** The Conductor drives the
members of a work whose mode is `full` or `trivial`; a person takes one over
(`takeOver`) and gives it back (`handBack`), and `driverOf` answers
`"conductor" | "you" | "nobody"` off those events since the member last joined. So
the lock survives a restart, every reader sees one answer, and it ends by
itself when the member leaves or the work ends.

**Three things are bounded.** An agent that stops and comes up for days would
otherwise grow a work without limit. The `append` every transition goes
through keeps the most recent `AGENT_STATES_KEPT` (30) agent-state events
(`ready`, `stopped`, `asking`, `exited`, `asleep`) and counts the rest into ONE
`folded` event, sitting where the oldest one it stands for sat. A state that
LET GO of the work (`letsGo`) is never folded and does not count: it ends a
visit on the trail, so a work keeps it, and every `told`, for as long as it is
kept. GitHub flips
its merge answer while required checks land, so a `merge-state` given while
its commit's checks are running REPLACES the one before it from the same
run (unless a draft flip came between them, which keeps both): CI holds the
work while its checks run, so none of those answers
decided anything. And a commit keeps at most `PR_FACTS_PER_COMMIT` (8) check
results, and as many merge answers: past that, the oldest one between its
first and its newest goes. Two suites reporting out of phase cannot write a
row per poll (#2376's shape), GitHub recomputing every time the base moves
cannot either, and the newest — the word the work reads, and what a green
PR's wait is filed under — is never the one that goes. The stretch a dropped
flip began is read by the fact before it, so an old flip loses its detail and
the time still adds up. Nothing else is bounded. The only other rewrite of a
past row is `linkPr`'s, above.

Nothing computed is stored: "where it stands" and the durations are folds
over the events at a clock reading the caller passes in.

**Green is two facts, about one commit, on a PR that is not a draft.** A
`checks-*` event is the rollup and
nothing else, recorded when its word changes for that PR at that commit; a
`merge-state` event is GitHub's answer to "would you merge it" — `can`,
`cannot` with a reason, or `unsettled` (working it out), recorded when it
changes for that PR at that commit, so a push never inherits the last
commit's answer and a recompute takes back the one it had. A PR is green when
the answer is `can` and no check is running or red, both about the same
commit, so a PR with no checks that GitHub would merge is green, and one
still waiting on a required review (`cannot · review`) is the agents' time.
An open DRAFT reads `cannot · draft` whatever GitHub answered (it works a
draft's merge state out as if it were ready), and entering or leaving a
draft forgets the answer. Reopening forgets both until the next reading.
`prStep` says all of this once; the folds carry its reading rather than a
second copy of the rule.

**One walk, so the time adds up.** `timeSpent`, `stages` and `lifetime` step
through the events with the same running state `standing` uses, and the
stretches tile the work's life exactly: an event stamped before the one
ahead of it is held to the walk's clock, and time a reopened work spent
ended is nobody's and counts in none of them.

**The stage is who holds the work.** A member is handed the work when it
joins as planner or implementor and when the Conductor speaks to it while it
is not holding it (`told`, recorded by `kolu-conductor`'s observer); it lets
go when its agent stops, exits or sleeps, or it leaves. An agent asking a
question has not let go. The holder is the member handed the work most
recently among those still holding it, or, when nobody is, the one handed it
last; an `other` member never holds it, and a role once joined in stays
joined even if its terminal comes back as `other`. The upgrade's
`hand-offs-kept` forgets who holds the work — nothing read off the events
before it is believed. `holdStep` says this once.

**The stages a work has are its mode's.** `MODE_RUNS` declares them: `full`
has all six, `trivial` has Build, Checks and Merge (nobody plans, approves or
reviews it), `watch` has none. The fold places each stretch as a six-stage
waterfall would: a merged PR is Merge; CI running is Checks, whoever holds
the work; a green PR handed over is Merge; a question keeps the work in the
stage it is in (before the implementor: Approve once a planner has joined,
Plan before that); the agents' time asks one thing, whether it is the
planner's turn (`plannersTurn`): before the implementor it is Plan, except
that a plan you answered is Approve when it is not; after, it is Review on
the planner's turn and Build otherwise. A draft decides no stage: it only
cannot merge. Each stretch is filed under the nearest stage at or before
that the mode has, so "a trivial work in Review" cannot be written down. A
stretch with no such stage — a trivial work's setup form and the Conductor
starting its implementor — is filed as `setup`.

**A doubt is a type.** On a work saved before kolu kept hand-offs (the upgrade
wrote it a `hand-offs-kept`), who held the work is not known up to the first
hand-off after the upgrade, so the fold takes every answer that is possible —
the planner's turn only if a planner ever joined — and two different stages
make a `Doubt` between them: `plan-or-approve` or `build-or-review`
(`DOUBT_STAGES`). One answer is no doubt: a work no planner joined is Build. A
mode that does not have both of a doubt's stages files it where it files its
`others` stage, so a trivial work's `build-or-review` is its Build and no
doubt ever names a stage the mode lacks. A stage with no visit of its own
that a visited doubt names is `unrecorded` (`StageState`), neither done nor
skipped; the doubt's time — how long the two took together, known exactly —
is `doubtsOf`'s.

**The trail is every visit, in order.** A visit is a run of stretches filed in
one place, closed by the work moving on or ending; Review and Build, and Build
and Checks, can loop any number of times, and `movedTimes` counts the loops
off the trail — `exactly`, or `at-least` where a move could hide in a doubt.
Events stamped at one instant are one moment: the stretches of no length
between them are no visit, except the last before the work ended (a PR
merged at the instant the work ended still reached Merge). The cells are the
trail summed by stage; a stage the work entered is done and says whose time
it mostly was (it has no time only where the work ended as it got there),
and the stage the work is in is `now`, with the visit in hand's time
(`here`). The same walk files EVERY EVENT where the stretch it begins is
(`Stages`' `events`, and each visit's `events`) and says `where` the work is
(`in`, while open) or ended (`ended-in`), which is what lets a card show one
place's or one visit's events. `stages.test.ts` checks, over generated
records walked by its own independent fold, that the stages, the setup and
the doubts add up to `lifetime`, that so do the waiters, that each stage
holds exactly the time after its events, that the visits tile the life and
hold every event once, and that a doubt only ever stands on a work whose
hand-offs were not kept; it reads the trails of the shapes real works have
taken, each by name; the seeded generator it and `work.test.ts` share lives
in `src/seeded.testlib.ts`, exported as `kolu-work/testlib` for the suites of
the packages that read works and never imported by their runtime.

## Why a package of its own

The work used to be guessed from which watched terminals shared a parent, and
the watch list lived inside the conversation's record — so "New session" took
the work with it. Those were two ideas braided into one thing (Hickey): what a
conversation remembers, and what is going on. Pulled apart, a conversation can
be cleared and the work in flight is picked up by the next one.

It also changes on its own clock (Löwy): the vocabulary of a piece of work —
its events, its decisions, its outcomes — moves when the *process* moves, not
when ACP, the MCP SDK, padi's frames or the browser's layout do. Every one of
those depends on this package; it depends on none of them. The one rule it
reads from outside is what a model id is, upstream agent-distro's
(`@kolu/agent-distro/models`), so a model kolu records is one a launch takes.

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
