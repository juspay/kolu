# The silent peer — a second unspeakable trigger (W4)

`previousRelease.e2e.test.ts` failed at `newReadsOld` against the REAL previous
release: the old kaval kept the gate, `currentEpochPid` stayed `undefined`, and
the assertion "an unspeakable survivor must be RECYCLED, not adopted" fired.
Everything downstream of the classification was already built in W2 (the
corroboration in `endpoint.ts`, the `unspeakable` observation in `converge.ts`,
kaval's recycle disposition). What was missing was the TRIGGER.

## Root cause, measured

The W2 classification has exactly one trigger: the peer's first frame fails to
decode. A real previous-epoch daemon never produces one. Its oRPC `ServerPeer`
waits for a client hello it can recognise; our ndjson frames are not one; it
parses them, recognises nothing, and answers **nothing at all**. There is no
first frame to fail decoding.

What ends the connection instead is Effect's own RPC socket protocol. `makePinger`
writes a ping every 5 s and fails the socket after two unanswered intervals, with
`SocketError(SocketOpenError{kind:"Timeout"})` — whose message getter renders the
misleading `timeout waiting for "open"`. Reproduced at unit scale against a bare
silent listener:

```
elapsed=10020ms kind=rejected
err=SurfaceStdioTransportClosed: … unix socket …/d.sock transport closed
    (SocketOpenError: timeout waiting for "open"); the peer process exited or its stream ended
```

Byte-identical to the string the failing e2e logged. So the outcome degraded to
`probe-failed` → UNCONVERGED → refuse, and the old daemon was never recycled.

**Verdict on the hypothesis in the brief: confirmed, and sharpened.** The
connection does die by timeout with no first frame — but the timeout is not a
connect/open timeout and it is not the frozen hello's 30 s deadline. It is the
RPC protocol's own ping/pong liveness check, ~10 s after the dial. That number is
what makes the fix's bound choosable at all.

## The fix — two triggers, one fact

`UnspeakableEvidence` is now a tagged union carried by
`UnspeakableProtocolError` (replacing the bare `frame` string):

| trigger | what happened | evidence |
| --- | --- | --- |
| `undecodable-frame` | the peer spoke first, in a framing we cannot parse | bounded JSON-quoted `frame` excerpt |
| `silence` | the peer accepted, took our frames, and said nothing | `silentForMs` |

There is no third arm. Both are the same verdict — "not of this epoch" — so they
are one error type with the trigger as data, not two classes a consumer unions.
`unspeakableClause(evidence)` is the single renderer, shared by the dial path,
the corroboration site and the fold, so the operator-facing sentence cannot
drift.

Everything else is untouched, which is the point:

- The `silence` fact is raised by the DIAL and is uncorroborated, exactly like
  the decode fact. It becomes the `unspeakable-protocol` observation only after
  `endpoint.ts` proves the gate at this rendezvous is ours and its pid passes the
  holder identity law. **`probe-failed` is not widened**: a foreign silent
  squatter and a merely slow daemon both stop at the transport fact and keep
  their existing arms.
- Dispositions are unchanged and shared: kaval `recycle` (the failing arm), padi
  `drain-newer-else-refuse` → REFUSE with the operator message.

## The bound, and why 8 s

`UNSPEAKABLE_SILENCE_MS = 8_000` — armed at dial, disarmed by the FIRST inbound
byte of any kind (decodable or not, so the two triggers are mutually exclusive by
construction).

It is not a free knob. It is pinned between two facts of the protocol we run,
both asserted in `probeDaemonIdentity.test.ts`:

- **Floor — 5 s.** Effect's RPC socket protocol pings every 5 s and a peer of this
  epoch answers `Pong` from its protocol layer, *below* its handlers. So a daemon
  that is merely SLOW — blocked `hello` handler, stalled event loop — has still
  demonstrably spoken within 5 s. Any bound above 5 s cannot mistake slowness for
  silence. Pinned by a test whose `hello` deliberately answers only at 6 s: the
  probe still yields an identity, because the 5 s pong disarmed the deadline.
- **Ceiling — ~10 s.** Two unanswered ping intervals and that same protocol kills
  the connection itself. Past ~10 s there is nothing left to classify; the
  outcome degrades to `probe-failed`, i.e. back to the bug. A "more generous"
  bound is not available: 10 s is not ours to choose.

8 s takes the generous end of that band — 3 s over a slow peer's pong, 2 s under
the protocol's own execution. Both timers live in this process's event loop and
Node fires timers in deadline order, so the ordering is deterministic under load
rather than a race we hope to win. `awaitHelloGone` inherits the same bound: no
poll pass against a mute peer can now exceed 8 s (review #9's "own bound"), and
boot converges well inside the e2e's budget.

## Along the way

- `plantYesterdayDaemon`'s fixture listener (and the two silent listeners in the
  supervisor/padi suites) now `resume()` the accepted socket. A paused socket
  with buffered bytes never emits `end`, so the fixture outlived the peer that
  hung up and wedged its own `server.close()`. Draining is also the honest model:
  a previous-epoch daemon *reads* our frames, it just recognises none of them.
- Measured and rejected as unnecessary: an extra `socket.destroy()` in the dial's
  disposer. `link.dispose()` already severs the wire within a millisecond.

## What the tests now prove

- `probeDaemonIdentity.test.ts` — a silent listener is classified `silence`, and
  in **under 9.5 s** (the assertion that would have caught this at unit scale);
  the bound is bracketed by 5 s / 10 s; a hello that answers only at 6 s still
  yields an identity.
- `unspeakableProtocol.test.ts` — through the REAL dial, no injected error: a
  corroborated silent peer (live child holding a one-field gate beside a mute
  socket — the `previousRelease` shape exactly) is RECYCLED, and a silent
  squatter with no gate of ours is still only `probe-failed`.
- `padi/ptyHost/connect.test.ts` — the old "accepts but never answers ⇒ rejects"
  pin now settles inside 10 s of clock instead of needing the full 30 s hello
  deadline, and asserts the typed trigger rather than deadline prose.
- `padi/upgradeWindow/yesterdayKaval.test.ts` — padi's own probe raises the
  `silence` fact and, correctly, NOT the corroborated peer error.
- `previousRelease.e2e.test.ts` — the real previous-release binary: the survivor
  is recycled and its replacement answers at this build's contract version.

## The proof

`KOLU_DAEMON_TESTS=1 KOLU_DAEMON_BIND_PID=$$ KOLU_UPGRADE_WINDOW_REQUIRE=1
vitest run src/upgradeWindow/previousRelease.e2e.test.ts` — **1 passed, 114 s**,
against a real `nix build` of the previous release. Non-vacuous by the harness's
own guards, and the step-2 probe now names the trigger on the real binary:

```
previousRelease.e2e: previous ref=v2.0.0
previousRelease.e2e: previous kaval store=/nix/store/ij4q9…-kaval
previousRelease.e2e: current  kaval store=/nix/store/fp1y8…-kaval
previousRelease.e2e: store paths differ — window is real
previousRelease.e2e: previous kaval is unspeakable to this build — the peer
  serving …/pty-host.sock accepted our connection and then said nothing at all
  for 8000ms — longer than a daemon of this epoch can stay silent, which is what
  a peer waiting for a greeting in a protocol we no longer speak looks like
previousRelease.e2e: old padi is refused to this build
```

The `newReadsOld` recycle arm — `currentEpochPid` is a new live pid, the old
kaval is dead, and the fresh probe reads `PTY_HOST_CONTRACT_VERSION` — is what
that green covers.

Other gates: `@kolu/surface-daemon-supervisor` typecheck + 146 unit tests green;
`@kolu/surface-daemon` 104 green; `@kolu/padi` 529 green; repo-wide `pnpm
typecheck` green; `biome lint --error-on-warnings` clean on all three packages.

Follow-up (campaign-level, PLAN locked decision #3): this is an API-facing change
to `@kolu/surface-daemon-supervisor` — `UnspeakableProtocolError.frame` becomes
`.evidence`, plus the new `UnspeakableEvidence` / `unspeakableClause` /
`UNSPEAKABLE_SILENCE_MS` exports. It rides the deferred drishti pair-PR list with
the rest of the epoch's breaks. The reference page
(`ref-surface-supervisor.mdx`) is already current.
