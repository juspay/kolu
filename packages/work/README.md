# kolu-work

A **piece of work**, as kolu stores it: the record, its event vocabulary, the
pure transitions that grow it, and the folds that read it — where it stands,
who it is waiting on, the time bar, how long each step took. One dependency
(`effect`, for the schemas). It knows nothing of the Conductor, ACP, MCP, padi
or the browser: a terminal is a string (`host/id`), a question is its words and
its options.

```ts
Work {
  id, title, repo, branch          // stated by the Conductor when it opens the work
  members:   Member[]              // terminal, role, joinedAt, leftAt, worktree — role stated at create/adopt
  events:    WorkEvent[]           // append-only: what kolu observed (and the Conductor's notes)
  decisions: Decision[]            // every question put to the human about this work, and the answer
  startedAt, endedAt, outcome      // null | merged | closed | abandoned
  keptFiles                        // .waterfall/ files copied into kolu when the work ended
}
```

**One rule decides who writes what.** The Conductor states intent once — the
title, repo and branch when it opens the work, a member's role in the same call
that creates or adopts the terminal — and may add a plain `note`. The human
decides: each answer is a `Decision`, and the setup (host, mode, harness and
model per role, what to do on green) is **read** off those decisions
(`setupOf`, `onGreenOf`), never stored beside them. kolu records everything
else it observes as events.

## What is here

| module | what |
| --- | --- |
| `schema.ts` | the record, the event kinds and what each one's `detail` carries, and the waterfall's WORDS (`WORK_ROLES`, `WORK_MODES`, `ON_GREEN`, `SETUP_KEYS`) — declared here because the record's schema embeds them |
| `record.ts` | the transitions: `openWork`, `askQuestions`, `answerAsk`, `dropAsk`, `joinWork`, `leaveWork`, `recordEvent`, `takeOver`/`handBack`, `endWork`, `keepFiles` — the record only grows, bounded by `AGENT_STATES_KEPT` |
| `readings.ts` | the MECHANISM of a reading: what a decision came to (`answerValue`), the decisions of one ask, the PR as the timeline last said it (`prOf`) with the one check table (`CHECK_STEP`), the grammar of a check event's detail (`checkDetail` / `checkHeadOf` / `checkFailingOf`) and the key a timeline holds at most one of (`checkKey`, `checksSeen` — one per kind per head commit), the files seen |
| `folds.ts` | `waitingOn`, `standing`, `timeBar`, `timeSpent`, `took`, `capFinished` — each taking a `Policy` (what the waterfall's words mean for this work) rather than reading the setup itself |
| `waterfall.ts` | the WORDS and every rule over them: `MODE_RUNS` (what each mode runs, needs and drives), `rolesOf`, `setupKeyOf`, `modeOf`/`hostOf`/`onGreenOf`/`setupOf`, `missingSetup` + `foreignSetupWords`, `driverOf`, `membershipOf`, `waitingOnYou`, `policyOf` |
| `refusal.ts` | why a call about a work is refused — `WORK_REFUSALS` and the `WorkRefusal` every face `instanceof`s |

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
  migration ladder, and kept files under `<state dir>/works/<id>/`. How many
  finished works are kept is the host's number too (`FINISHED_KEPT`, beside
  the cap it applies); `capFinished(works, keep)` takes it.
- **Observation** is split where its sources are. What a host's frames *mean*
  for a member — a level change, a PR transition, a file that appeared — is
  decided in `kolu-conductor` (pure readings over padi records); the
  subscriptions and the file reads/copies that feed it are kolu-server's,
  over the host map's padi clients.
