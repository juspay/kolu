# The patches kolu's Claude ACP adapter carries

One patch applies to the pinned `@agentclientprotocol/claude-agent-acp`
0.81.2 — to its **compiled** `dist/acp-agent.js`, because npm is the only
channel the adapter ships through (`../shim/` is the npm shim,
`nix/packages/acp-adapter.nix` the derivation built from it). They are applied
by that derivation's `postInstall` with `patch -p1 -F0`, so every padi kolu
builds or copies to a host runs the same agent.

`-F0` is the load-bearing part. What `patch` reads here is a BUNDLE, not the
TypeScript it was built from, so a pin bump must **fail the build** rather than
land a hunk two lines from where its context said it belongs and silently
change what the behaviour means. A red build at the next bump is the point.

## Provenance

The patch and the shim beside it are **vendored from
[olai](https://github.com/juspay/olai)** (`packages/plugins/claude/acp/`) at
this same 0.81.2 pin, where they were written, reviewed and measured against
real adapter runs. Only the shim's package name differs (`kolu-acp-claude`),
which is why `npmDepsHash` is kolu's own value for an otherwise identical
dependency set. The added lines still say `olai patch (…)` in their comments:
that is whose patch it is, and rewriting the attribution would make the two
copies diverge for nothing.

olai carries a **second** patch at this pin, `session-list-info.patch`, which
stamps each `session/list` row with a message count and the `/clear` successor
that superseded it. kolu does not, and the reason is the whole rule this
directory follows: **a patch is a cost paid at every pin bump, so it must have
a reader.** kolu's orchestrator is one conversation per host and never lists
the stored ones, so nothing here would read those stamps — and an unread patch
goes on failing bumps for a fact nobody wants. If kolu ever grows a
conversation picker, that is the moment to bring it across from olai, which
owns its generator too.

## `background-tasks-visible.patch` — a background task lives past its launch

A background task the agent arms — a `Monitor`, a `Bash(run_in_background)`,
an async `Agent` — reports its launch and then lives on. Unpatched, its tool
call reaches **`completed` at launch**: the acknowledgement is read as the
call's result. An armed watch is then indistinguishable from a finished one,
nothing ticks, and its DEATH never appears on the wire at all
([claude-agent-acp#865](https://github.com/agentclientprotocol/claude-agent-acp/issues/865)).

**This is the patch kolu's orchestrator depends on most directly.** The
orchestrator watches a host's terminals by arming `kolu watch` as a background
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

## Bumping the pin

Move the version in `../shim/package.json`, regenerate the lockfile
(`npm install --package-lock-only --ignore-scripts`), set `npmDepsHash` to
`lib.fakeHash` and build once to get the new one. Then the real work: the build
will fail loudly if the hunk no longer applies, and the answer is never fuzz.
Ask whether the patch is still NEEDED (upstream may have landed it), re-anchor
it against the new `dist/` by `diff -u` against a pristine npm extract, and
look at the layer no dist diff can see — the Claude Agent SDK moves with the
adapter, and the vocabulary this patch reads (`SDKTaskStarted/Updated/
Notification`, `SDKBackgroundTasksChanged`) is the SDK's, not the adapter's.
olai's copy of this README keeps the bump-by-bump record of what each move
found; it is the place to read before doing the next one.
