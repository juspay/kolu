# @kolu/child — one owner for a subprocess

Spawn, the exec-failure that arrives after `spawn` returns, drained pipes, and
a kill with a grace period. Listeners attach at spawn. A wait is the EVENT (the
chunk, the exit, ESRCH); a clock is only a hang detector that throws with what
the child said.

A LEAF: `node:child_process` and nothing else. No Effect — a caller wraps this
in its own language. No workspace sibling — a package between a caller and the
ability to start a process is the inversion this extraction exists to have
stopped. The empty `dependencies` block in the manifest is the whole claim, and
a leaf that grew one would be the defect.

```ts
import { childEnvOf, run, start } from "@kolu/child";

const child = start("git", ["status"], { cwd: root });
const close = await child.wait(10_000, "git status");
// or the one-shot:
const said = await run("git", ["status"], { cwd: root, timeout: 10_000 });
```

## What it exports

| | what it is |
| --- | --- |
| `start` | spawn, with the `error` and `close` listeners already on |
| `Child.unstartable` | a promise that settles ONLY if the exec failed — race it against the conversation |
| `Child.said` / `out` / `err` | drained pipes, so a child nobody is reading cannot block |
| `Child.wait(ms, why)` | the close, or `Hung` after `ms` with what the child said |
| `Child.stop` | SIGTERM, then SIGKILL if the grace expires. ESRCH is success |
| `run` | one-shot: drain both pipes, wait for close. Exec failure is an answer; a hang throws; a stream past `maxBuffer` is `ok: false` with the tail quoted, never a silent truncate |
| `childEnvOf(base, extra, unset)` | the environment a spawn gets: a copy of `base` plus `extra`, minus `unset`. Never mutates what it was handed |

**Stdout is not drained by default.** It is often a protocol (ACP, JSON-RPC),
and stealing it is worse than not logging it. `run` opts in because the answer
*is* the output; a test that reads the serving line does too.

**A process group is opt-in.** `start(cmd, args, { processGroup: true })` gives
the command its own POSIX group, so `stop()` reaches the CLI an adapter spawned
in turn — the thing holding a credential store open. Ordinary callers keep the
single-process behaviour.

## Who depends on it

`@kolu/acp-harness` (the ACP adapter, and the sign-in command it runs, both as
process groups). olai vendors this package: its git, browsing, chat, server
tests and web build all spawn through it.

## What a maintainer must not break

- **The listeners stay on the line after `spawn`.** Attaching either later is
  how a caller that asks after the fact waits for an event that will never come
  again, or lets an unhandled `error` take the process down.
- **`wait` throws, it does not answer `false`.** The sentence and the child's
  own words are the whole point.
- **`stop` escalates.** SIGTERM, then SIGKILL after the grace; ESRCH is success.
- **No dependency arrives here.** A sibling or a runtime library would put a
  package between a caller and the ability to start a process.

## What is out

Readiness (the serving line, the ACP handshake), transport (how pipes become
JSON-RPC), restart policy, and the orphan sweep. #355 answered the last of
those: the harness reaper and `PR_SET_PDEATHSIG` own it. A caller whose needs
exceed the socket keeps that residue **on top of it**, never beside it.
