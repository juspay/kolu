# The patches this adapter carries

Two patches apply to the pinned `@agentclientprotocol/claude-agent-acp`
0.81.2 — to its **compiled** `dist/acp-agent.js`, because npm is the only
channel the adapter ships through (`../shim/` is the npm shim,
`../default.nix` the facts kolu's `nix/packages/acp-adapter.nix` builds the
derivation from). They are applied with `patch -p1 -F0`, sorted by name, so
every padi kolu builds or copies to a host runs the same agent.

`-F0` is the load-bearing part. What `patch` reads here is a BUNDLE, not the
TypeScript it was built from, so a pin bump must **fail the build** rather than
land a hunk two lines from where its context said it belongs and silently
change what the behaviour means. A red build at the next bump is the point.

## Provenance

The patches and the shim beside them are **vendored from
[olai](https://github.com/juspay/olai)** (`packages/plugins/claude/acp/`) at
this same 0.81.2 pin, where they were written, reviewed and measured against
real adapter runs. The shim's package name differs (`kolu-acp-claude`), and so
does one forced line — kolu's shim carries zod's 4.6.7 over the adapter's own
4.6.5 pin (see the `//overrides` note in `../shim/package.json`) — which is why
`npmDepsHash` is kolu's own value for a dependency set that is no longer
olai's. The added lines still say `olai patch (…)` in their comments:
that is whose patch it is, and rewriting the attribution would make the two
copies diverge for nothing.

**Both patches travel here, and the second one is olai's reader's.** The rule
this directory keeps is that a patch is a cost paid at every pin bump, so it
must have a reader — and `session-list-info` does, though not in kolu: it is
what `@kolu/acp-claude`'s `listedIn` reads, and olai's conversation picker is
what draws it. The package is shared, the reader is another product's, and a
patch whose reader lives one repository over still has to ship beside the leg
that reads it. (kolu's own conductor never lists a stored conversation, so
nothing in this repository draws those two stamps.)

## `background-tasks-visible.patch` — a background task lives past its launch

A background task the agent arms — a `Monitor`, a `Bash(run_in_background)`,
an async `Agent` — reports its launch and then lives on. Unpatched, its tool
call reaches **`completed` at launch**: the acknowledgement is read as the
call's result. An armed watch is then indistinguishable from a finished one,
nothing ticks, and its DEATH never appears on the wire at all
([claude-agent-acp#865](https://github.com/agentclientprotocol/claude-agent-acp/issues/865)).

**This is the patch kolu's conductor depends on most directly.** The
conductor watches a host's terminals by arming `kolu watch` as a background
task; without this, the call that armed the watch would settle the instant the
watch started, and the row the user reads would say "done" about a watch that
is still running — or has died, which is exactly the fact a supervisor must
not miss.

What it does, in the shape of upstream's closed
[PR #941](https://github.com/agentclientprotocol/claude-agent-acp/pull/941):
a launch acknowledgement no longer settles the call; the call stays
`in_progress` until the harness reports a real terminal state, with the
launch's own output still riding the card. `completed` → `completed`;
`failed` / `killed` / `stopped` → ACP's `failed`, with the harness's own word
kept in `_meta.claudeCode.taskStatus`. Beyond #941 it covers each
background-launching tool through a TABLE (`BACKGROUND_LAUNCHES`) rather than a
branch — a tool the table does not name keeps the lifecycle it always had and
completes at launch, which is the unpatched behaviour and the safe direction to
fail in — stamps `_meta.claudeCode.backgroundTask` (`{ taskId, taskType,
description }` when armed, `{ status, summary }` when it settles, where a
background shell's *…failed with exit code 3* sentence lives), files an async
agent's injected report onto the spawning call instead of forwarding it as
human speech, and reopens the spawning call when a subagent is sent more work
and the harness starts the same task again.

Upstream has been asked and has not answered:
[#1038](https://github.com/agentclientprotocol/claude-agent-acp/issues/1038)
describes the extension and links the patch. #1017's native async-task channel
does not replace it — that lifecycle is published only to a client that
advertises the AIR capability, which kolu's leg does not.

## `session-list-info.patch` — what a stored conversation holds, and which one a `/clear` moved you to

Two questions about an agent's stored conversations that `session/list` cannot
answer on its own: **how big is this conversation** (two sessions can share a
title and an hour; three versus three hundred messages is usually what the
person reading the picker means), and **which conversation did `/clear` move me
into** (the CLI starts a fresh session for the same directory and leaves no
pointer connecting the two, so a picker shows the pair as twins).

The patch answers both by stamping each listed session's `_meta.claudeCode` as
`session/list` replies: `messageCount`, read from the transcript, and
`supersededBy: <sessionId>` on the OLDER of a `/clear` pair. The asking that
follows is written up in
[claude-agent-acp#1052](https://github.com/agentclientprotocol/claude-agent-acp/issues/1052),
which also asks whether the CLI could make the link a fact rather than an
inference.

The pairing and scanning rules are vendored OUT of the patch and into
[`../session-list-info/`](../session-list-info/README.md): the patch is
GENERATED from that source (`bash packages/acp-claude/adapter/session-list-info/regenerate.sh`,
with the hunks computed by `diff -u` against the pristine npm extract — one
generation of hand-numbered hunks failed at `-F0` on the pristine corpus and
taught where the arithmetic belongs). The reader of both stamps is
`@kolu/acp-claude`'s `listedIn`, and the panel that draws them is olai's.

## Steering, and the hang this pin still has

The leg's steering bits — `STEERING` (`method: "_session/steering"`,
`meta: { steering: { idleBehavior: "promptRequired" } }`, `timeout`, `taken`
and `advertised`) and `QUEUES_WHEN_BUSY` —
are **vendored from olai** (whose `packages/plugins/claude/src/leg.ts` this
file began as) at this same
0.81.2 pin, where they were written and measured. They are not a patch: the
adapter ships the extension, and what is vendored is the READING of it.

**The known limit, and why kolu carries a latch for it.** olai measured, on the
wire and with no client of its own in the loop, that this adapter leaves a
turn's `session/prompt` unanswered **forever** once a `_session/steering` is
injected into any turn of a session that has ever held a QUEUED prompt: the
steered words run and stream, and only a cancel ends the turn. Fresh sessions
steer cleanly, one sequential turn steers cleanly, two steer cleanly — one
queued turn earlier in the session poisons every steer after it. (It is not the
whole defect: a session whose turn armed a background task hangs the same way
with nothing ever queued. olai left that one open and so does kolu, because
widening the guard is a change to what the composer OFFERS rather than a fact
about the adapter.)

So `@kolu/acp-harness` carries olai's `queuedHere` latch: once this conversation
has sent a message while a turn was running, `state.steers` is false for the
rest of that session, and a new session gets it back. It costs a person their
interruption after one message typed into a working turn, and that is the price
of never offering a control that hangs the conversation. It goes when the
adapter is fixed, which is not the same as when the pin moves — re-measure it
at each bump and record the result here, as olai's copy does.

## Bumping the pin

Move the version in `../shim/package.json`, regenerate the lockfile
(`npm install --package-lock-only --ignore-scripts`), set `npmDepsHash` to
`lib.fakeHash` and build once to get the new one. Then the real work: the build
will fail loudly if the hunk no longer applies, and the answer is never fuzz.
Ask whether each patch is still NEEDED (upstream may have landed it), re-anchor
it against the new `dist/` by `diff -u` against a pristine npm extract, and
look at the layer no dist diff can see — the Claude Agent SDK moves with the
adapter, and the vocabulary `background-tasks-visible` reads is the SDK's
(`SDKTaskStarted/Updated/Notification`, `SDKBackgroundTasksChanged`), not the
adapter's.

TWO things about `session-list-info` are NOT a hunk context, and both must
survive a bump on their own:

1. `message.timestamp` — an UNDOCUMENTED passthrough of the SDK's
   `SessionMessage`. The day it stops arriving, `patch` still applies cleanly
   and every supersession link simply disappears. `facts.js` guards it
   (`timestampLoss`/`sayTimestampLossOnce`), which is why that guard stays.
2. The pairing rules themselves: they live in `facts.js`, not in the diff, and
   `regenerate.sh` re-derives the patch from them.

olai's copy of this README keeps the bump-by-bump record of what each move
found, at `packages/plugins/claude/acp/patches/README.md`; it is the place to
read before doing the next one.
