# kolu-conductor

The **Conductor**'s server half: one Claude conversation over the [Agent Client
Protocol](https://agentclientprotocol.com) for a whole fleet, as a package kolu
mounts.

Three things make the conversation work and they are all here:

- **the host** (`startConductorHost`) — owns the ACP child and the transcript,
  translates the harness's two refusals into the two errors a caller branches
  on, and WIRES the modules below, one per thing that moves on its own clock;
- **the record** (`./persisted`) — what survives a restart, and the re-validation
  that refuses a transcript with holes in it rather than drawing one. Its
  session id is resumed only when the rows since the last break show a turn:
  the agent writes nothing for a session until its first prompt, so one nobody
  spoke into is opened again in silence rather than "lost" with a notice;
- **the standing prompt** — what the agent is told, once, on the first turn.
  The words are in [`src/teaching.md`](src/teaching.md), a Markdown file of
  sections, lists and tables, read when kolu-server starts (a missing or
  malformed file stops the boot) and sent as the Markdown it is. Each rule is
  said once; a rule about one kolu tool lives in that tool's description.

The `koluSurface` members a browser subscribes to are here too (`./surface`),
because an implementation of "what `conductor.prompt` does" belongs with the
thing that does it.

### The modules the host wires

| module | what moves it |
| --- | --- |
| `conductor.ts` | the CONVERSATION — the ACP child, the transcript, the restart fence, `publishState`, and the facade that returns `ConductorHost` |
| `workStore.ts` | the works map KEYED BY `WorkId`, the single writer: idempotent `openFor` (an ended work reopens), join/leave/save, `stop`/`reopen`, ending (drop the members and the open questions in the same write → keep files → cap at `FINISHED_KEPT` → sweep), the driver lock, restore, and publish-what-moved (one helper, an equivalence per collection) |
| `memberStore.ts` | what kolu knows about each member terminal, by fleet ref — ONE location; the watch's six fields are listed at the write (`members.ts`'s `saved`), because the row carries the model's half too |
| `members.ts` | pure: what a reading MEANS for a member (`MemberWatchSchema`, `observed`, `spokenTo`) |
| `observation.ts` | the observation vocabulary alone (`WatchObservation`, `WatchGit`, `WatchPr`, `PrWatch`) — a leaf both rule modules read |
| `readings.ts` | pure: a host's frames → one `WatchObservation` per member terminal |
| `observing.ts` | pure `ringEvent` / `prEvents` / `fileEvents` + the ONE pass per reading that applies them |
| `wakes.ts` | when news reaches a turn: the held queue (`@kolu/acp-harness`'s `holding`, the slot discipline both products share), the one-flight flush, the failure episode, the `told` write-back |
| `asking.ts` | kolu's own questions: minted, recorded on the work and SAID in the transcript, answered later from any face — nothing waits on a person, and the answer leaves as news through one sink |
| `askNews.ts` | what a settled ask says — to its transcript row and to the Conductor — and the drop that an ending performs, read by `asking` and by the writer alike |
| `attachments.ts` | a prompt's files on their way up, and the rule that reaps them |
| `recordWrites.ts` | how often any of it hits disk — one leading-edge timer, one flag per record |
| `workFiles.ts` | the port kolu-server implements over padi |
| `persisted.ts` | the four records a restart reads, decoded through `kolu-work`'s `parseStore` so a store that breaks an invariant fails with the sentence naming it, and the re-validation that refuses a file with holes in it. The conversation's own record carries `taught` — whether the standing prompt has already gone out in the session it names — because the agent's memory of it outlives the subprocess holding it, and a restart that assumed nothing taught a chat in progress again |
| `kolu.ts` | WHAT A TOOL CALL MEANS TO KOLU: the reading a card is drawn from (one per tool the fleet face serves, each gated on `isTerminalId`), the fold of a call's two frames, and the `Fleet` — the terminals this conversation has created or typed into, in first-touch order. `conductor.ts` hands the reader to `@kolu/acp-harness` as its `readCall` and computes the fleet out of what it reads |
| `aboutBlock.ts` | the `[kolu] about …` lines a message carries above the words, composed here and handed to the harness as the body a person's message is sent under |
| `wakeText.ts` · `teaching.ts` · `surface.ts` · `transcriptStream.ts` | what the agent reads, what it is taught, and what a browser subscribes to |

## The works, the watch, the hold and the wake

A PIECE OF WORK is the thing kolu stores (`kolu-work`: the record, the event
vocabulary, the pure folds). This host owns the LIVE half — opening one,
putting its questions to the human, watching its member terminals, and
appending what it observes.

- **The works** (`works` / `openWork` / `askAboutWork` / `joinWork` /
  `leaveWork` / `stopWork` / `reopenWork` / `note`) — kept in memory in the
  order they were opened, keyed by `WorkId`, and saved under `config.json`'s
  `works` key — `kolu-work`'s `Work`, unadorned. Opening is IDEMPOTENT: a key
  kolu already holds answers that work as it stands (an ended one comes back
  open, its decisions and timeline whole) and asks only the setup questions
  with no answer, so no caller can make a second card for one branch. A work
  OUTLIVES the conversation that opened it: `clearSession` wipes the chat and
  keeps every work, dropping only the questions that chat was holding.
- **Membership is a map of its own**, keyed by terminal, so a terminal is in
  at most one work and a work that ends drops its members in the same write.
  Losing terminals never ends a work: an open work with no members says "no
  terminals" on its card and the Conductor is woken ONCE with exactly that,
  and `work_adopt` re-joins existing terminals with a role.
- **What kolu knows about each member TERMINAL** is its own key beside them,
  `members` (ref → `MemberWatch`, `./members.ts`): the name kolu last saw,
  whether an agent was ever seen in it, the level the conversation has already
  been TOLD about, HOW it joined (`created` · `created-run` · `asked`),
  whether anything has been said to the agent in it, and whether a command was
  ever seen running in it. Beside the works rather than inside them because it
  is a fact about a terminal rather than part of what a work is, it moves every
  time a host is read, and a reader of the record is never handed it. WHERE a
  member worked is the exception and lives on the record (`WorkMember.worktree`):
  a work's files have to be findable after its terminals are gone.
- **The setup is DECISIONS.** `work_open` carries the questions; they are
  recorded on the work and said in the transcript as ONE row that NAMES it,
  and nothing waits on the answer — the Conductor's turn ends, and whoever
  answers (card, chat, reader, pop-out) wakes it with what they said. The
  mode, the harness and model per role and what to do on green are READINGS
  of those decisions (`kolu-work`'s `setupOf`); the HOST is part of the work's
  key rather than a decision, and `work_open` takes it beside the repo and the
  branch. A setup that does not ask what its mode needs — or offers words
  `modeOf`/`onGreenOf` cannot read — is refused with `WorkRefusal` before the
  work exists. Declining the setup of a work nothing has happened in REMOVES
  it; a decline on one a terminal joined is recorded, and the work stays open.
- **kolu offers the harness and the model.** `work_open` NAMES a role's
  harness and model questions and nothing more: kolu words them, the form draws
  their options live, and `openWork` / `answerWork` / `startOf` judge against
  `ConductorDeps.offer` — a `KoluOffer`: the harnesses this kolu carries, what
  a harness offers on the work's host (`models`, the host's word — `listed`,
  `unlisted`, or `unavailable` in its own words when it could not list just
  now), how that harness takes a model (`launch`, which runs no harness), and
  whether that host has a harness to choose at all, which kolu-server reads off
  its agent-distro listing and that host's padi. A setup asking a harness for a
  host whose agents are not ready is refused `agents-not-ready` before
  anything exists. A `given` harness or model, and every answer to one, is
  judged where it is recorded (`kolu-work`'s `unofferedAnswers`), refused
  `not-offered` naming each answer that is not an option. A list the host
  could not read refuses nothing: the person chose knowingly, beside its
  words. A typed model asks for no list at all.
- **A saved answer is judged again, by the same rule.** `startOf` is what a
  planner or implementor starts on: its saved harness and model judged against
  the offer — or `not-offered`, naming which answer and why, so nothing is
  typed into a terminal on an answer kolu no longer offers — and the host's
  `launch` for that harness. A start never depends on a list: a picked model
  is checked against one only when the host can read it, and how the harness
  takes a model is `launch`'s word. `openWork` asks a refused question AGAIN
  (only unanswered keys are asked otherwise), its words saying what the old
  answer was and why it no longer stands; one `work_open` reads the host once
  for its `given` answers and its saved ones together.
- **The open questions are TWO lists, and what needs you is one reading.**
  `publishState` publishes the conversation's own open elicitations as
  `ConductorState.openAsks` and every question still open on a work in
  progress as `ConductorState.workAsks` — derived from the works' decisions,
  published and never written back. Two lists because a browser must know
  which a question is the moment it appears: a work's question reaches it
  before that work's record does, and read as the conversation's it would be
  rung by the wrong rule. What NEEDS the human is the one reading over the
  works themselves (`kolu-work`'s `needsYou`: a question, or a green PR handed
  over), and the bell, the OS badge, the tab's count and the palette read it;
  `openAsks` is what the conversation adds to it, the questions that belong to
  no work and so have no card.
- **A message says what it is ABOUT.** `prompt` takes `ConductorMention`s, each
  a terminal (`host/id`, its name, cwd and intent) or a piece of work (the
  `WorkId` it is filed under and the title it had when the message went), and
  `./aboutBlock.ts` puts them above the words as `[kolu] about`
  lines. They are rows of the transcript, so a reload still says what a message
  named, and `teaching.md` says what a work line means: read that id in `works`
  and answer about it.
- **The reading** (`./readings.ts`, pure) — what ONE host's frames mean:
  padi's urgency fold, that host's roster and the records read on it become
  one observation per member terminal (its level, its name, the agent in it,
  padi's foreground answer and the git fact). The PULL REQUEST is not among
  them: it belongs to the work's branch, and `prReading` (same module) folds
  padi's `pullRequest` reading for that branch instead. kolu-server owns the
  subscriptions; this owns what they SAY.
- **The merge answer is its own fact, and a draft has none** (`mergeOf` and
  `prReading`, in `./readings.ts`). A check event means the rollup and
  nothing else. Whether the PR is a draft is GitHub's `isDraft`: GitHub
  retired the `DRAFT` value of `mergeStateStatus` in 2021 and now works a
  draft's merge state out as if it were ready, so a green draft says
  `CLEAN`. So the reading is two arms: `draft`, with no merge answer to read,
  or `ready` with `mergeOf`'s — GitHub's `mergeStateStatus` read into `can`
  or `cannot` with a reason (`blocked`, `review` when the review decision
  wants one, `behind`, `conflicts`, and `draft` for the retired word), or
  `unsettled` for `UNKNOWN`. `observing.ts` records a `draft-state` event
  when the draft word CHANGES for an open PR, and a `merge-state` event, for
  a ready PR only, when the answer for a PR at a commit
  CHANGES — `unsettled` too, so a push never inherits the last commit's
  answer and GitHub recomputing one takes back the `can` it had. A reading
  with no merge state at all (`unreported`, a padi older than the field)
  records nothing. A reading whose PR has no address is `broken`
  (`prReading` answers a sum, never throws): it is refused, as an error, for
  the one work it was about, and the watch goes on serving every other.
  Green is read by `kolu-work` off both facts, about the same commit — merge
  `can` and no check running or red, on a PR that is not a draft — so the
  card, the timeline, the stages and the Conductor's `works` resource agree
  without asking again.
- **The decision** (`./members.ts`, pure) — one reading of one member becomes
  a wake level or nothing:
  - `working` forgets what we were told, so the next stop is news again;
  - `ready` — an agent that has COME UP and has not been spoken to rings this
    instead of `stopped` the first time it is idle: a fresh agent at its
    prompt has not ended a turn, it is waiting for one;
  - `stopped` · `asking` — the ordinary two, once each until the terminal
    moves;
  - `asleep` — a terminal an agent was seen in was put to sleep; rings once
    and the member STAYS, because waking it brings it back;
  - `ended` — a terminal kolu opened WITH a command whose command ran (a
    non-shell foreground was seen) and gave the prompt back with no agent ever
    detected: the brief never started. padi exposes the foreground process and
    agent detection and NO exit status, so a command that fails before any
    non-shell foreground is sampled (`omp: command not found`, answered by the
    shell itself) is not detectable and does not ring;
  - a shell never rings otherwise, a terminal that goes away rings only if an
    agent was ever seen in it (and LEAVES the work either way), and a level
    equal to `told` does not ring twice. That last rule is what makes a
    restart quiet.
- **The timeline** — everything observed is appended through `kolu-work`'s
  transitions: a level change that rings is the same word on the card
  (`ready` · `stopped` · `asking` · `exited` · `asleep`); every file under a
  member's `.waterfall/`, at any depth (`kolu-common/workFiles`' one walk,
  first 200 entries), that `filesSeen` does not already hold becomes a
  `file` event, listed off a level change rather than a timer; and the PR —
  ONE per work, read ONCE from the work's own branch (`observedPr`, fed by
  kolu-server's per-work leg over padi's `pullRequest` stream) — is compared
  with the TIMELINE and never with the last reading: `prOf(work)` for the
  number, its state and what it last said about the checks and the merge at
  which commit. A check event is recorded when the rollup's word CHANGES for
  that PR at that commit (the real CI run turning a passed rollup pending
  again is news; the next poll of the same word is not), and a PR recorded
  before kolu kept addresses learns its own (`linkPr`). So a poll that says
  what kolu already knows records nothing, a restart records nothing twice,
  and a push — a new head — records a run of its own. A work with NO terminals is still watched,
  which is what makes a Conductor-merged work end: the script merges and
  closes its terminals seconds later (#2376). THE ONLY ENDINGS are the forge's
  two — merged or closed — and a **Stop** (the card's button, the Conductor's
  `work_stop`), which is the one a person or the Conductor chooses. Nothing
  kolu merely fails to see ends anything, and nothing the forge says brings a
  work back: a finished work's branch is not watched at all (`prWatches` is
  the one statement of that scope), so **Reopen** on the card — or `work_open`
  on the same key — is the way back.
- **The end** — the work's open questions are recorded as dropped and its
  members removed in the same write as the ending; then its files are listed
  and copied into kolu (`WorkFiles`, implemented by kolu-server), so the plan
  outlives the worktree, and the history is capped at the twenty most recently
  finished; what falls off has its kept files deleted.
- **The baselines** — a state the Conductor itself caused is never news.
  `saidTo(ref)`, which the fleet face calls when `agent_say` lands its keys,
  withdraws that terminal's held slot and re-baselines `told` at the level it
  stands at; a member that joined by being `asked` for baselines on its first
  reading, and the tool's own answer tells the Conductor what it was found in.
  Without the two, `agent_say` — which returns on the keystrokes, before the
  agent flips to working — would wake the Conductor about the agent it has
  just briefed.
- **The hold** (`@kolu/acp-harness`'s `holding`) — while a turn runs, news
  WAITS: one slot per terminal, newest only, kept in the position the first one
  took, withdrawn when that terminal goes back to working. On every turn
  boundary — however the turn ended, a cancel included — everything waiting
  leaves as ONE wake, which is one `harness.hostTurn(...)`: one row with N
  events, in the Conductor's own voice rather than a person's. Held news is
  memory only: a restart re-reads the world instead of replaying a queue about
  one that has moved on.
- **The account** (`./wakeText.ts`, pure) — what the agent is actually handed:
  who speaks, each terminal as `host/id` with the work it belongs to and the
  part it plays ("the planner of «…»"), its name, host, agent and how it
  stands, and what to do about it — read the screen, answer with `agent_say`,
  then end the turn.
- **A wake that could not go** — one `notice` row naming the terminals still
  waiting and why, the news put back, and an event-driven retry with no timer:
  the next time the conversation goes idle, the next time the agent comes up,
  or the next reading from the watcher. One notice per failure episode.

A wake MAY start the agent (that is the feature); reading the works may not
(`works()` is bookkeeping). kolu-server holds the subscriptions that produce
those frames (`conductor/watcher.ts`, scoped to `memberRefs()`), and only for
refs on CONNECTED hosts — a host that is not answering says nothing about its
terminals, and `gone` for one of them would be a lie.

## What kolu brings to the shared conversation

The conversation itself is [`@kolu/acp-harness`](../acp-harness)'s, and it
names no product. These are the five things kolu hands it, each a fact about
kolu rather than about the protocol:

| handed in | what it is |
| --- | --- |
| one `http` MCP server | kolu's fleet face, served in-process by kolu-server on loopback (`ConductorDeps.fleetMcp`), which is how ONE conversation reaches terminals on every host. The bearer token rides its headers |
| `readCall` | `./kolu.ts` — what a tool call MEANS to kolu, one reading per tool the fleet face serves, each gated on `isTerminalId`. The `Fleet` is computed from what it reads |
| the body under a message | `./aboutBlock.ts`'s `[kolu] about …` lines, so a message says which terminals and which pieces of work it is about |
| the three policies | `whenNewSession: "divide"`, `whenLoadRefused: "fresh"`, `whenReplayed: "drop"` — kolu persists its own rows, so it keeps them across a break and throws the agent's replay away |
| the files | `./attachments.ts` spools a prompt's bytes in frame-sized pieces to a path under kolu's state directory, because base64 on the prompt frame closes the tab's socket. The harness reads the bytes off that path |

And one thing kolu does with what comes back: a sign-in that succeeds
**restarts the agent** into the conversation that was live when it was asked
for (`reloadAgent` is the same restart for a signature made outside kolu). The
harness opens nothing itself — a signature reaches an adapter only through a
fresh `initialize` — so re-entering the conversation is this package's move.

## Why a package

The same argument `kolu-mcp` makes one shelf over: **a face kolu mounts is not
kolu-server's inside.** kolu-server is a web server, a host map and a state
ladder; that it also supervises a Claude subprocess is a separate concern on a
separate clock — ACP's — and the wall is what keeps a protocol bump out of the
file that serves the websocket.

## The mount

The dependency arrow points **out** and never back. This package reads
`@kolu/acp-harness`, `@kolu/acp`, `kolu-common`'s schema and `kolu-agents`'
registry, and knows nothing about kolu-server. Everything server-owned is
**pushed in** at the mount — `packages/server/src/conductor/live.ts`:

| pushed in | why it is the server's |
| --- | --- |
| `store` · `storePath` · `stateRoot` | kolu has one state ladder and one state directory, and they are kolu-server's |
| `fleetMcp` · `proveFleetMcp` | the loopback MCP door, and the `initialize` that proves it — the MCP SDK's pin, not ACP's |
| `publish` | the served cell's writer; importing the ctx would be a cycle |
| `home` · `hostName` | facts about the machine kolu-server is running on |
| `spawn` | the composition root is the one place that knows a conversation is a subprocess |

`packages/server/src/seal.test.ts` holds the wall in both directions: arm (g)
fails if a file here imports kolu-server, and fails again if kolu-server reaches
past this package's published doors.

## What deliberately did not move

- **The wire schema** stays in `kolu-common` — the browser reads it too, and a
  browser must not import a package that spawns subprocesses.
- **The migration rung** and the `PersistedStateSchema` key stay in
  `packages/server/src/stateLadder.ts` and `stateShape.ts`: kolu has one
  ladder and it has one home — rung `1.53.0` is where every pre-key store is
  folded into this model (works grouped by key become one, members re-keyed
  into the one map, `abandoned` becomes open again), and rung `1.58.0` is
  where every saved mention gains the `kind` that tells a terminal from a
  work. The record's own schema is this package's export, which is the half
  that describes the data rather than the file.
- **The UI** is `packages/client/src/conductor/`.
- **No test lane of its own.** The Conductor's suites are composition tests — the
  host against the real fleet MCP door and the real tool registry — so they run
  in `packages/server`'s. Stubbing the door to relocate them is exactly the drift
  one of those tests exists to stop: an imitation answered `400`, the proof
  passed on it, and a door that could serve nobody looked healthy.
