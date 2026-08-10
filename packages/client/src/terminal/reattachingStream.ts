/**
 * The terminal attach loop, and THE statement of its channel taxonomy.
 *
 * Three ways an attach attempt can stop, three different meanings. Getting one
 * into the wrong channel is not a style slip — it is how a documented-recoverable
 * race became a dead pane in production twice (kolu#2101, deploy #2), so the
 * mapping is written here, once, and every site below points at it:
 *
 *  1. **DEFECT — an impossible state, dies loud, never retried.** Spelled as a
 *     `throw` (from `streamFn`, or from `onItem`) or an explicit `Effect.die`.
 *     `Effect.retry` retries FAILURES ONLY, so a defect skips every recovery path
 *     here and reaches `runAction`'s edge, which reports it (console + a
 *     "failed unexpectedly" toast) and ends the attach with no successor. That is
 *     the right answer for a breach of an invariant nothing can repair, and the
 *     ONLY thing left in this channel is that: the thunk's `attach opened without
 *     a measured grid` assert, and a throw out of `onItem`. What used to sit here
 *     too — a chain manufacturing clean ends, a chain delivering no frames — has
 *     moved to the verdict (channel 2 plus {@link FRUITLESS_CYCLE_VERDICT}'s
 *     loudness), because those describe a chain that might still recover and
 *     dying on them executed healthy panes (kolu#2101 K1).
 *  2. **TYPED FAILURE — a recoverable condition, retried through `onReattach`.**
 *     Spelled as a value in the error channel: a stream failure (a mid-chain padi
 *     death), a frame the consumer REFUSES ({@link StaleSnapshotGrid}), the
 *     first unexpected clean end, or the first SILENT open (an attach that opened
 *     and owed a snapshot it never sent — {@link FIRST_FRAME_DEADLINE_MS}). All
 *     of them take the SAME road — reset the screen,
 *     wait {@link REATTACH_BACKOFF_MS}, re-subscribe through a freshly-entered
 *     `streamFn` that reads the CURRENT grid. The retry is unbounded here and that
 *     is not a new unbounded thing: every member of this channel is driven by an
 *     external cause that stops (a resize settles, a re-bound padi comes back),
 *     each attempt re-reads live inputs so it makes progress rather than repeating
 *     itself, and a gone terminal ends the loop outright (below). What it is NOT
 *     is silent: a run of cycles that delivers nothing crosses
 *     {@link FRUITLESS_CYCLE_VERDICT}, or spends one of the two budgets, and the
 *     loop then SAYS SO once and drops to {@link DEMOTED_RETRY_MS} — the full
 *     unboundedness argument is on that constant.
 *  3. **CLEAN END — classified, never trusted.** A completed stream means "the PTY
 *     exited" only when the tile's own facts agree; otherwise it is channel 2 with
 *     a budget. See {@link AttachTileFacts} and {@link CLEAN_END_REATTACH_BUDGET}.
 *  4. **NO END AT ALL — the fourth way an attach can stop being useful, and the
 *     only one with no event to classify.** A stream that OPENS and then delivers
 *     nothing trips none of the three above: the transport never failed, the
 *     stream never ended, the consumer never refused. The pane simply stays
 *     blank over a live agent, forever (kolu#2101 H3, the wake-window residue).
 *     So silence itself is given a deadline —
 *     {@link FIRST_FRAME_DEADLINE_MS} — and its expiry enters channel 2.
 *
 * **THE REOPEN LANES, all four, and where each is governed.** This module's whole
 * point is that a reopen lane is governed, so every lane is named here:
 *
 *  - **The framework fence** (`unenrolledStreamCall`'s `STREAM_RETRY`). Owns the
 *    TRANSPORT class end to end, including — since kolu#2101 J1 — a wire re-dial:
 *    `@kolu/surface`'s `websocketLink` counts open EDGES and FAILS every call an
 *    edge superseded, so an orphaned subscription arrives as an ordinary
 *    `RpcClientError` on the first reopen, with no clock anywhere. It never
 *    reaches this module's budgets, and {@link FIRST_FRAME_DEADLINE_MS} is not
 *    what covers it.
 *  - **This loop's channel-2 retry** (the three members above plus the deadline).
 *    Governed by the budgets, the fruitless-cycle counter, and one loudness
 *    policy — {@link FRUITLESS_CYCLE_VERDICT}.
 *  - **The stale-grid reopen** (`Terminal.tsx`'s `reopenForStaleGrid`, the
 *    xterm-write-callback arm). It exists because the second grid check runs in
 *    a write callback, not in the iterator, so there is no return value the loop
 *    would read and no error channel to enter — the attempt is superseded and a
 *    successor opened explicitly instead. It is grid-correctness-driven and
 *    RTT-rate-limited by nature (one reopen per snapshot that actually landed),
 *    and since kolu#2101 K5 it takes the SAME {@link REATTACH_BACKOFF_MS} as
 *    every other reopen, so no lane jumps the queue. Its episode accounting
 *    needs no special case: it fires only after a snapshot has been WRITTEN, and
 *    a delivered frame refills both budgets ({@link FIRST_FRAME_DEADLINE_MS}),
 *    so its fresh loop legitimately starts a fresh episode rather than escaping
 *    an old one's accounting.
 *  - **The tile remount** (`h.onceMeasured`). One per mounted pane; not a retry.
 *
 * The rule that keeps this honest: **no message may claim a re-attach unless one
 * follows.** A comment or a toast that promises recovery on a path that dies is
 * the bug, not a documentation slip — it is what let both incidents pass review.
 * Its companion, since kolu#2101 K1: **no verdict may EXECUTE a pane whose chain
 * might still recover.** A verdict is loud PERSISTENCE — said once, then a slow
 * retry — never an `Effect.die` that leaves a tile with no road back.
 */

import { Duration, Effect, Schedule, Stream } from "effect";
import { toast } from "solid-sonner";
import { isDeclared, TERMINAL_NOT_FOUND } from "../rpc/declaredErrors";

/** How long to wait before re-subscribing after an abnormal end. Bounds the loop
 *  if a re-subscribe keeps failing (e.g. the terminal is genuinely gone — the
 *  tile then unmounts, interrupting the fiber and ending the loop).
 *
 *  EXPORTED for the one reopen lane that lives outside this file —
 *  `Terminal.tsx`'s `reopenForStaleGrid` (kolu#2101 K5). It reopens from an
 *  xterm write callback where the loop's own error channel is unreachable, and
 *  it takes this same spacing so the module header's four-lane list has one
 *  backoff, not two. */
export const REATTACH_BACKOFF_MS = 300;

/** How long a CLEAN end waits for the tile's own exit facts to land before it
 *  calls that end unexpected.
 *
 *  A real PTY exit ends the attach stream and publishes the exit (`terminalExit`,
 *  the metadata arm, the list removal) over the SAME socket, so the two race by
 *  construction and the stream's end frame routinely wins. The window therefore
 *  only has to cover in-process delivery + the store reconcile — not a network
 *  round trip — and one backoff interval is that with room to spare. It costs an
 *  exited tile nothing: the pane keeps its final screen through the wait (the
 *  reset runs only once we commit to re-attaching), and the list removal usually
 *  unmounts the tile inside it, interrupting this fiber before any RPC is sent. */
const EXIT_SETTLE_MS = REATTACH_BACKOFF_MS;

/** How many re-attaches a CLEAN end may buy in one EPISODE.
 *
 *  One. A clean end for a tile whose PTY is still live is a manufactured end —
 *  the deploy-#2 frozen-pane class (kolu#2101), where a stampede ended kaval-side
 *  attach subscriptions without an `overflow` frame and every retry layer, which
 *  retries FAILURES only, read the result as "the PTY exited". Re-attaching once
 *  is the whole of the client's part in that: the server (`reattachingDeltas`)
 *  owns the real repair, and a SECOND clean end in a row means the chain is
 *  manufacturing ends faster than either layer can absorb — something to say out
 *  loud, not to storm against.
 *
 *  **PER EPISODE, not per loop, and no longer fatal (kolu#2101 K1).** Two
 *  changes, one reason: neither counter may ever be the thing that permanently
 *  ends a pane. (i) An attempt that DELIVERS a first frame refills this counter
 *  and the silent-open one — a pane that painted proved the chain end to end, so
 *  a later stumble starts a fresh episode rather than inheriting an old one's
 *  spend; the max-two-then-loud property is per episode, and an episode costs a
 *  real frame to open. (ii) Exhausting it no longer `Effect.die`s. It says the
 *  verdict once, loudly, and DEMOTES the loop to {@link DEMOTED_RETRY_MS} —
 *  see {@link FRUITLESS_CYCLE_VERDICT} for the one loudness policy all three
 *  triggers share, and why the demoted loop is not a new unbounded thing.
 *
 *  A FAILING end keeps its own, deliberately unbounded, retry (below): a
 *  mid-chain padi death heals when kolu-server re-binds, and that loop is what
 *  the W2.2 done-criterion (c) rests on. */
const CLEAN_END_REATTACH_BUDGET = 1;

/** How long an attach attempt has to deliver its FIRST frame before the silence
 *  itself is the verdict (kolu#2101 H3 — the blank-pane residue; re-derived at
 *  K1 after the first derivation was found to execute healthy panes).
 *
 *  **What this deadline actually costs, measured (K1).** The re-attach it
 *  triggers is DESTRUCTIVE, not a free second opinion. `Effect.raceFirst`
 *  interrupts the loser, and interrupting the consume runs the stream's own
 *  finalizers — which IS the unsubscribe (D10/#18) — so the snapshot the host
 *  was midway through serializing is abandoned and the successor starts from
 *  zero. There is no in-flight request left for the re-attach to race. It
 *  follows that this constant is a hard CEILING on legitimate first-frame
 *  latency: a chain whose honest first frame takes longer than it converges
 *  NEVER, because every attempt is torn down at exactly the same mark. Pinned by
 *  `reattachingStream.test.ts`'s "the deadline is a CEILING" case, and the
 *  reason the number below is not simply "when we get bored".
 *
 *  **The derivation.** The shipped 10s came off TRANSPORT margins only — one
 *  fence retry (`STREAM_RETRY_DELAY_MS`, 1s) plus "a hop" — which is the LOCAL
 *  shape. The remote shape is bigger and partly unboundable:
 *
 *   - **hops**: browser → kolu-server → ssh → padi → kaval, four legs, one of
 *     them a wide-area ssh tunnel whose RTT is the user's network, not ours;
 *   - **padi's own re-open ladder**: 150 + 300 + 600 = 1_050ms of deliberate
 *     backoff (`terminalEndpoint/reattachingDeltas.ts`) right after a
 *     reconvergence, before padi has even asked kaval;
 *   - **snapshot serialization**, which scales with SCROLLBACK and which this
 *     module therefore CANNOT bound at all. It is the honest hole in every
 *     derivation here: a pane with a large buffer on a loaded host is slow for a
 *     reason that has nothing to do with the chain being dead.
 *
 *  So the deadline is placed ABOVE the cheap structural repairs rather than
 *  under them, and 45s is where that lands: the heartbeat's worst-case half-open
 *  detection is one interval + one timeout = 15s + 10s = 25s
 *  (`@kolu/surface`'s `heartbeat.ts`), plus one fence retry (1s), plus padi's
 *  ladder (1.05s) ≈ 27s before anything upstream has genuinely run out of
 *  excuses — and the remaining ~18s is the room the unboundable serialization
 *  term gets. Under 25s the deadline PREEMPTS the watchdog it depends on: it
 *  would tear the stream down while the socket cycle that actually repairs a
 *  half-open wire (and J1's epoch wrap, which then fails the orphan into the
 *  retry channel with no clock at all) is still in flight. That inversion — the
 *  belt firing before the braces — is what shipped at 10s.
 *
 *  **The bound this buys.** A genuine park is REPAIRED at 45s (the first
 *  re-attach) and SAID OUT LOUD at 90.3s (the second silent open, plus one
 *  backoff). Slower than the old 20.3s — deliberately, because the old number's
 *  speed was bought by executing panes that were merely slow, and because the
 *  class this deadline still owns has shrunk: J1's epoch wrap now takes the
 *  re-dial class instantly, on the reopen edge, with no clock.
 *
 *  **FIRST frame only — never between frames.** An idle terminal emits nothing
 *  for hours and that is the healthy case: an inter-frame deadline would kill
 *  every quiet pane in the canvas. What this bounds is the one thing that has no
 *  legitimate silent form — an attach that has OPENED and owes a snapshot.
 *
 *  **TWO mechanisms, DISJOINT classes — this deadline is the belt, not the
 *  only strap** (kolu#2101 J1). There are two ways an opened attach can go
 *  silent, and they are covered by different things:
 *
 *   - **The wire RE-DIALLED underneath it.** `@kolu/surface`'s `websocketLink`
 *     counts open EDGES (the wire epoch) and FAILS, itself, every call an edge
 *     superseded — so this class arrives as an ordinary transport failure the
 *     framework fence retries, on the first reopen, with no clock involved. The
 *     deadline does not own it, and no per-stream deadline could have: the class
 *     covers every subscription in the tab, not just this one. It reaches this
 *     module (if at all) as a channel-2 failure that spends NEITHER budget —
 *     asserted, because the budgets are now the only thing between a pane and a
 *     loud verdict.
 *   - **The wire never moved and the UPSTREAM stalled.** A relay that holds the
 *     stream open while its own source says nothing (padi re-binding, kaval
 *     mid-adopt) produces no re-dial, no epoch edge, and no failure anywhere.
 *     Nothing but silence distinguishes it from a healthy idle stream, so a
 *     deadline on the FIRST frame — the one thing an opened attach always owes —
 *     is the only signal left. That is this constant's job, and it is why it
 *     stays.
 *
 *  The two can race (a wake that re-dials while a relay is also stalled) and the
 *  race is harmless: both roads end in channel 2, the same re-subscribe, and the
 *  budget below bounds the second one either way.
 *
 *  BETA-ASSUMPTION(beta.106): an in-flight stream survives a `SocketOpenError`
 *  re-dial UNFAILED — `RpcClient.makeProtocolSocket`'s `retryTransientErrors`
 *  arm returns early from its `tapCause` without broadcasting
 *  `ClientProtocolError`, which is the only thing that fails registered entries,
 *  so an opened stream can hang with no failure signal while the protocol
 *  silently re-dials underneath it. The framework's epoch fix rests on the SAME
 *  measured behavior (it exists because nothing fails), so a bump that made the
 *  re-dial fail its entries would make BOTH the epoch wrap and this deadline's
 *  first bullet redundant — re-measure before re-stamping. MEASURED by
 *  `packages/surface/src/links/socketRedialLaws.test.ts` (laws 2 and 3). */
const FIRST_FRAME_DEADLINE_MS = 45_000;

/** How many re-attaches a SILENT open may buy in one EPISODE.
 *
 *  One, mirroring {@link CLEAN_END_REATTACH_BUDGET} and for the same reason: the
 *  first silent open is a recoverable condition, and re-opening is the whole of
 *  the client's repair. A SECOND silent open in the same episode means the chain
 *  is delivering no frames at all, which re-opening is not going to fix on the
 *  next try either — so the loop SAYS SO (once, loudly) and slows down.
 *
 *  Refilled by any attempt that delivers a first frame, and never fatal — see
 *  {@link CLEAN_END_REATTACH_BUDGET} for both rules and
 *  {@link FRUITLESS_CYCLE_VERDICT} for the shared loudness policy. */
const FIRST_FRAME_REATTACH_BUDGET = 1;

/** How many consecutive re-attach cycles may produce NO first frame before the
 *  loop says so out loud (kolu#2101 K3-client).
 *
 *  **The lane this closes.** The 300ms macro-retry is unbounded BY DESIGN and
 *  stays that way — every member of channel 2 is driven by an external cause
 *  that stops, and punishing a genuine transient with a ceiling is how panes die
 *  for no reason. What it lacked was a VOICE: a persistently wedged chain
 *  churned to console forever and the user saw a blank pane with nothing said.
 *  Measured pre-fix over ten virtual minutes of a sustained mid-chain wedge:
 *  2001 re-opens, 2001 `console.warn` lines, ZERO `console.error`, zero toasts.
 *
 *  **Why a count and where 200 comes from.** The cheapest possible fruitless
 *  cycle is an attach that fails instantly plus one {@link REATTACH_BACKOFF_MS},
 *  so 200 cycles is a floor of 60s of UNBROKEN fruitlessness. That is ~4× the
 *  ~15s host-reconvergence window the H1 lid-close field test measured — the one
 *  legitimately fruitless stretch a healthy install produces — so a wake never
 *  trips it, while a one-or-two-cycle blip (padi's re-open ladder, a server-side
 *  budget exhaustion) is two orders of magnitude short. The counter is
 *  CONSECUTIVE: any delivered frame resets it, so the shape it detects is "this
 *  chain has produced nothing at all for a minute", never "this chain has been
 *  busy for a long time".
 *
 *  **Two triggers, one policy, because there are two fruitless SHAPES.** This
 *  counter catches the FAST one (churn: fail, back off, fail). The budgets above
 *  catch the SLOW one (silence: one attempt costs a whole
 *  {@link FIRST_FRAME_DEADLINE_MS}, so 200 cycles would be hours). Both land in
 *  the same verdict, said ONCE per episode: `console.error` for the operator and
 *  one toast for the user, then the loop DEMOTES to
 *  {@link DEMOTED_RETRY_MS}.
 *
 *  **Deliberately NOT the same N as the server's** (`reattachingDeltas`'
 *  one-frame-oscillation log, kolu#2101 K3-server). That counter watches a lane
 *  where every cycle DELIVERS a frame — the chain demonstrably works and is
 *  merely flapping — so it can afford to be patient and it only writes a log.
 *  This one watches a lane where every cycle delivers NOTHING, which is a pane
 *  the user is staring at; it is the tighter, louder of the two on purpose. */
const FRUITLESS_CYCLE_VERDICT = 200;

/** The re-attach spacing after a verdict — the loud-persistence cadence.
 *
 *  30s, and the floor is not arbitrary: it is above the heartbeat's ~25s
 *  worst-case half-open cycle (`@kolu/surface`'s `heartbeat.ts`), so a demoted
 *  loop never issues more than one attach per watchdog cycle. The repair that
 *  would actually heal a wedged chain — the socket cycle, J1's epoch wrap
 *  failing the orphans into this same retry channel, kolu-server re-binding padi
 *  — gets a full cycle to land between attempts instead of racing them.
 *
 *  **The unboundedness argument (mandated, kolu#2101 K1).** The demoted loop has
 *  no ceiling, and that is deliberate; here is why it cannot become a storm or a
 *  zombie. It is idle-cheap: two RPC opens a minute for one pane, versus 200 in
 *  the same minute before demotion, and each open re-reads live inputs so it
 *  makes progress rather than repeating itself. It is rate-limited in the one
 *  channel that could flood — the verdict is said once per episode, and an
 *  episode can only be re-opened by a real delivered frame, so the log and the
 *  toast cost a success each. It TERMINATES on every outcome that is genuinely
 *  terminal: a gone terminal answers the declared `TerminalNotFound` and ends
 *  the loop outright; an unmounted tile interrupts the fiber, cancelling even a
 *  sleeping backoff. And it HEALS on every outcome that is recoverable, because
 *  each of them lands in this same channel — J1's re-drive, the heartbeat's
 *  socket cycle, padi re-binding, the host reconverging. What is left, the only
 *  state in which this loop spins for hours, is a live PTY behind a chain that
 *  is permanently wedged but never closes: exactly the state the verdict exists
 *  to put a human in front of. The alternative shipped and was worse — an
 *  `Effect.die` that left the tile with no road back at all, not even a slow
 *  one, and no signpost saying so. */
const DEMOTED_RETRY_MS = 30_000;

/** A clean stream end for a tile that has NOT been told its PTY exited. Raised
 *  into the loop's own error channel so it travels the EXISTING abnormal-end path
 *  — `onReattach` (reset + re-arm the snapshot boundary) then the spaced
 *  re-subscribe — rather than a second, parallel recovery route. */
class AttachEndedWhileLive extends Error {
  constructor(label: string) {
    super(
      `${label}: the attach stream ended cleanly while the terminal is still live — re-attaching`,
    );
    this.name = "AttachEndedWhileLive";
  }
}

/** An attach attempt that OPENED and then said nothing at all. Channel 2, like
 *  {@link AttachEndedWhileLive}: it rides the existing road (tapError →
 *  `re-attaching` → `onReattach` → the spaced re-subscribe), because a fresh
 *  subscription on a fresh wire is exactly the repair. */
class AttachFirstFrameDeadline extends Error {
  constructor(label: string, deadlineMs: number) {
    super(
      `${label}: the attach stream opened but delivered no frame within ${deadlineMs}ms — re-attaching`,
    );
    this.name = "AttachFirstFrameDeadline";
  }
}

/** Just the two numbers this module needs off a terminal grid — structural, so
 *  the loop does not take a dependency on the kit's `TerminalGrid` to render a
 *  message about one. */
interface Grid {
  cols: number;
  rows: number;
}

/** The consumer REFUSES this frame: the snapshot answers a grid the pane no
 *  longer has, so painting it would wrap scrollback at the wrong width — damage
 *  a later repaint cannot undo.
 *
 *  A RETURNED value, not a throw, and that is the whole point (kolu#2101 G8). The
 *  refusal is a recoverable race — a resize between the request and the answer,
 *  a `STREAM_RETRY` replaying the original captured grid, another client
 *  attaching at its own size — whose documented repair has always been "reset and
 *  reopen at the current grid". While it was spelled as a `throw` inside the
 *  handler that this loop runs, it was a DEFECT (channel 1): the retry never
 *  fired, the pane died with a `failed unexpectedly` toast whose text still said
 *  "reopening", and the agent underneath kept running into a screen nobody would
 *  ever see again. Returning it puts the channel in the TYPE — the compiler now
 *  routes it, so the two channels cannot be conflated again by an edit that does
 *  not mention them. Anything the handler still THROWS stays a defect, unchanged
 *  and deliberate.
 *
 *  Carries both grids because the message is the only forensic record a user's
 *  screenshot preserves. */
export class StaleSnapshotGrid extends Error {
  constructor(args: {
    terminalId: string;
    /** The grid this attempt ASKED at. Absent only before the first request. */
    requested: Grid | null | undefined;
    /** The grid the pane has NOW. Absent when the pane has been disposed and
     *  released its measurement. */
    current: Grid | null | undefined;
  }) {
    const at = (g: Grid | null | undefined) =>
      g ? `${g.cols}x${g.rows}` : "unmeasured";
    super(
      `terminal ${args.terminalId}: snapshot answered ${at(args.requested)}, pane is now ${at(args.current)} — refusing it and re-attaching at the current grid`,
    );
    this.name = "StaleSnapshotGrid";
  }
}

/** The tile facts this loop reads back before acting on an end. */
export interface AttachTileFacts {
  /** Does this tile KNOW its PTY is gone (a `terminalExit`/metadata arm that has
   *  resolved to non-active, or the terminal's departure from the list)?
   *
   *  Positive fact, deliberately: an UNKNOWN answer (metadata not resolved yet)
   *  must read as "still live", because the two mistakes are not symmetric — a
   *  wrong "live" costs one attach RPC that the server answers `TerminalNotFound`
   *  and the loop then ends, while a wrong "exited" costs a blank pane with a
   *  live title, forever. */
  hasExited: () => boolean;
}

/** Consume a terminal-attach stream that must SURVIVE a mid-chain (padi↔kolu-server)
 *  death — the W2.2 done-criterion (c) — AND a manufactured clean end.
 *
 *  **Failing ends.** The face's own retry fence (`unenrolledStreamCall`)
 *  transparently re-subscribes on a browser↔kolu-server TRANSPORT drop (an
 *  `RpcClientError` → retried forever, the stream never ends). But when the padi
 *  process dies mid-attach, kolu-server's fail-through relay ENDS the browser
 *  stream with an application failure, which the fence's POSITIVE match
 *  deliberately refuses to retry — so without this, the tile would strand until
 *  reload. This is APPLICATION wiring, not framework retry: on an ABNORMAL end we
 *  `onReattach()` (reset xterm + re-arm the snapshot boundary, exactly as the
 *  inner `onRetry` does, so the fresh stream's snapshot replaces stale bytes
 *  without double-painting) and RE-SUBSCRIBE — the retry reconnects end-to-end
 *  once kolu-server re-binds the padi it adopts-or-spawns, and the first frame of
 *  the fresh stream is a fresh snapshot.
 *
 *  **Clean ends (kolu#2101, deploy #2).** A graceful end used to end the story:
 *  the effect SUCCEEDED, `Effect.retry` retries failures only, and the tile was
 *  left to be torn down by the `terminalExit` event. That reading is only sound
 *  when a clean end MEANS the PTY exited — and under the restore stampede it did
 *  not: kaval-side subscriptions ended without an `overflow` frame, padi read
 *  that as a graceful end, and the client sat waiting for an exit event that was
 *  never coming. Blank pane, live title, no verdict, forever. So a clean end is
 *  now classified rather than trusted: if the tile knows its PTY is gone
 *  ({@link AttachTileFacts.hasExited}) the loop ends as before; otherwise the end
 *  is unexpected and buys ONE re-attach through the failure path above
 *  ({@link CLEAN_END_REATTACH_BUDGET}). The server-side half of the same fix
 *  (`padi/src/terminalEndpoint/reattachingDeltas.ts`) makes the manufactured end
 *  unspellable for a live PTY in the first place; this layer is the secondary
 *  defense for every OTHER way an end can be manufactured above it (the relay,
 *  the scope-abort swallow at `surface/src/server.ts`'s `pullOnly`).
 *
 *  **"The terminal is gone" ends the loop, and does not retry.** A re-attach for
 *  a terminal padi no longer has answers with the DECLARED `TerminalNotFound`
 *  (matched structurally — on a stream member it arrives undeclared, see
 *  `rpc/declaredErrors`). That is the typed teardown verdict, so the loop ENDS on
 *  it instead of storming a dead id every 300ms; removing the tile stays with the
 *  ONE authority that owns removal, the list-driven reconcile (`useActiveReconcile`
 *  — `terminalExit` is deliberately toast-only, see `useTerminals`). kaval's own
 *  `PtyNotFound` is NOT classified here and must not be: padi converts it at the
 *  source (a re-open that finds the PTY gone ends the stream gracefully; a fresh
 *  attach for a departed terminal fails `requireActiveTerminal` with
 *  `TerminalNotFound`), so a `PtyNotFound` surfacing on this wire would mean
 *  padi's registry and kaval's table disagree — a real fault that must be loud.
 *
 *  **A REFUSED frame (kolu#2101, deploy #2 incident #3).** `onItem` may hand back
 *  a {@link StaleSnapshotGrid} instead of consuming its frame — the snapshot
 *  answers a grid the pane no longer has. That is channel 2: it fails the
 *  attempt, so the screen is reset and the stream reopened through a
 *  freshly-entered `streamFn` that reads the CURRENT grid, and a pane that has
 *  stopped resizing converges on its first reopen. It reached production as
 *  channel 1 instead — a `throw` inside the handler this loop ran under
 *  `Effect.sync` — which the retry (failures only) never saw: three panes died at
 *  once after a reload, on a one-column layout settle, with a toast that promised
 *  a reopen that could not come. The channel now rides in the RETURN TYPE, where
 *  it cannot be silently flipped again.
 *
 *  **A SILENT open (kolu#2101 H3, narrowed by J1, re-derived at K1).** The three
 *  cases above all rest on an EVENT — a failure, an end, a refused frame. The
 *  wake-window residue had none: a pane sat blank while its host's own logs
 *  showed nothing at all. Two different causes produce that rendering, and only
 *  one of them is still this module's to catch. A wire that RE-DIALLED
 *  underneath the subscription is failed by `@kolu/surface`'s epoch wrap on the
 *  reopen edge — the whole class, every subscription in the tab, no clock, and
 *  it arrives here (if at all) as a plain channel-2 failure that spends no
 *  budget. What is left is the UPSTREAM STALL: a relay holding the stream open
 *  over a source that says nothing, where no re-dial ever happens and silence is
 *  genuinely the only signal. So the deadline stays as the belt for that class
 *  (see {@link FIRST_FRAME_DEADLINE_MS} for the two-mechanism statement and the
 *  45s derivation): an attempt that opens and delivers no first frame within it
 *  fails into channel 2 and re-attaches once; a second silent open in the same
 *  EPISODE says the verdict out loud and slows the loop down, rather than ending
 *  the pane. Only the FIRST frame is bounded — an idle terminal legitimately
 *  says nothing for hours, and an inter-frame deadline would blank every quiet
 *  pane.
 *
 *  **The verdict, and what it is not (kolu#2101 K1/K3-client).** Two budgets and
 *  a fruitless-cycle counter converge on ONE policy: say it once (a
 *  `console.error` for the operator, one toast for the user), then keep
 *  re-attaching at {@link DEMOTED_RETRY_MS}. It is deliberately not an
 *  `Effect.die`: an executed tile has no road back — visibility toggles do not
 *  remount it, only a sleep/wake cycle does, and nothing beside the dead pane
 *  says so — so a false positive there is permanent, while a false positive on
 *  the verdict costs one toast. Both budgets REFILL on a delivered frame,
 *  because a pane that painted has proved the whole chain and the next stumble
 *  is a new episode, not a continuation of an old one's accounting.
 *
 *  `streamFn` is re-entered per attempt (`Stream.suspend` under `retry`), so each
 *  re-attach picks up whatever the caller reads at open time (Terminal.tsx
 *  re-reads the live grid there).
 *
 *  **What this used to be, and what went with it.** A hand-rolled `open()`
 *  recursion over `runStreamScoped`, holding a stopper, a `setTimeout` backoff
 *  handle, an `AbortSignal` and an `abort` listener to clear both — five pieces
 *  of bookkeeping for "retry with a delay, and stop when told". Interruption
 *  replaces all of it: the caller interrupts the fiber, which ends the consume
 *  loop AND cancels a sleeping backoff, because an `Effect.sleep` inside a
 *  retry schedule is interruptible. There is no signal to thread and none to
 *  forget.
 *
 *  A THROW — from `streamFn` OR from `onItem` — is a DEFECT, not a failure, so
 *  `Effect.retry` does not retry it (channel 1 in the module header). It
 *  propagates to the run edge, which reports it loudly and stops the loop. That is
 *  deliberate and is what the caller's measured-grid assertion relies on:
 *  retrying an impossible-state breach every 300ms would wipe the user's screen
 *  three times a second (each retry runs `onReattach`) instead of surfacing the
 *  bug. A condition that SHOULD recover says so by returning
 *  {@link StaleSnapshotGrid}, never by throwing. */
export function consumeReattachingStream<T>(
  streamFn: () => Stream.Stream<T, unknown>,
  /** Consume the frame — or REFUSE it by returning a {@link StaleSnapshotGrid},
   *  which fails the attempt into the re-attach path. A throw here remains a
   *  defect (channel 1). */
  onItem: (item: T) => StaleSnapshotGrid | undefined,
  onReattach: () => void,
  label: string,
  tile: AttachTileFacts,
): Effect.Effect<void, unknown> {
  /** Spent per EPISODE, refilled by a delivered frame — see
   *  {@link CLEAN_END_REATTACH_BUDGET}. Lives in the closure rather than the
   *  schedule because `Stream.suspend` re-enters the stream, not this function. */
  let cleanEndReattaches = 0;

  /** The same, for the silent-open arm — see {@link FIRST_FRAME_REATTACH_BUDGET}. */
  let silentOpenReattaches = 0;

  /** Consecutive channel-2 cycles that produced no frame at all — see
   *  {@link FRUITLESS_CYCLE_VERDICT}. */
  let fruitlessCycles = 0;

  /** Has THIS attempt delivered a frame? Reset at the top of every attempt.
   *  Read by the deadline watcher, by the refill, and by the fruitless counter,
   *  which is why it is one fact and not three. */
  let attemptSawFrame = false;

  /** Is the loop retrying at {@link DEMOTED_RETRY_MS} rather than
   *  {@link REATTACH_BACKOFF_MS}? Set by a verdict, lifted by a frame. */
  let demoted = false;

  /** Has this EPISODE already said its verdict? One line and one toast per
   *  episode, and an episode costs a delivered frame to re-open — see the
   *  rate-limit leg of {@link DEMOTED_RETRY_MS}'s unboundedness argument. */
  let verdictSpoken = false;

  /** The loop's ONE loudness policy: say it once, then slow down — never die.
   *
   *  Three triggers reach here (the two budgets and the fruitless counter) and
   *  they deliberately share one voice, because from the user's chair they are
   *  one condition: this pane is not receiving anything. The toast carries a
   *  STABLE per-label id so a canvas of wedged panes cannot become a wall of
   *  toasts, and so a re-verdict updates in place rather than stacking. */
  const verdict = (reason: string) =>
    Effect.sync(() => {
      demoted = true;
      if (verdictSpoken) return;
      verdictSpoken = true;
      console.error(
        `${label}: ${reason} — kolu keeps re-attaching, now every ${DEMOTED_RETRY_MS / 1_000}s instead of every ${REATTACH_BACKOFF_MS}ms`,
      );
      toast.error(
        `${label}: no output is reaching this pane. kolu is still retrying in the background.`,
        { id: `attach-stalled:${label}` },
      );
    });

  /** A frame ARRIVED: the chain is proven end to end, so this episode is over
   *  and the next stumble starts a fresh one. Both budgets refill, the fruitless
   *  run resets, the demotion lifts, and the verdict re-arms — see
   *  {@link CLEAN_END_REATTACH_BUDGET}. */
  const startFreshEpisode = () => {
    cleanEndReattaches = 0;
    silentOpenReattaches = 0;
    fruitlessCycles = 0;
    demoted = false;
    verdictSpoken = false;
  };

  /** Classify the end of ONE attempt that completed without failing. */
  const classifyCleanEnd = Effect.suspend(() => {
    if (tile.hasExited()) return Effect.void; // the PTY exited: a real end
    // Let the exit facts catch up with the end frame before calling it
    // unexpected — they race over one socket. An unmount lands here, in an
    // interruptible sleep, and stops the loop with nothing sent.
    return Effect.sleep(EXIT_SETTLE_MS).pipe(
      Effect.flatMap(() =>
        Effect.suspend(() => {
          if (tile.hasExited()) return Effect.void;
          // Budget spent: SAY it, then re-attach anyway at the demoted cadence.
          // It used to `Effect.die` here, which executed the tile — the pane had
          // no road back at all and nothing near it said so (kolu#2101 K1).
          const said =
            cleanEndReattaches >= CLEAN_END_REATTACH_BUDGET
              ? verdict(
                  `the attach stream ended cleanly ${cleanEndReattaches + 1} times with the terminal still live — the chain is manufacturing stream ends`,
                )
              : Effect.void;
          cleanEndReattaches++;
          return Effect.flatMap(said, () =>
            Effect.fail(new AttachEndedWhileLive(label)),
          );
        }),
      ),
    );
  });

  /** Classify an attempt that has been open for {@link FIRST_FRAME_DEADLINE_MS}
   *  without a single frame. Same shape as {@link classifyCleanEnd}: a typed
   *  failure either way, plus the shared verdict once the budget is out. */
  const silentOpenVerdict = Effect.suspend(() => {
    const said =
      silentOpenReattaches >= FIRST_FRAME_REATTACH_BUDGET
        ? verdict(
            `the attach stream opened silent ${silentOpenReattaches + 1} times — the chain is delivering no frames (no first frame within ${FIRST_FRAME_DEADLINE_MS}ms)`,
          )
        : Effect.void;
    silentOpenReattaches++;
    return Effect.flatMap(said, () =>
      Effect.fail(new AttachFirstFrameDeadline(label, FIRST_FRAME_DEADLINE_MS)),
    );
  });

  /** ONE attempt: consume the stream, RACED against the first-frame deadline.
   *
   *  `Effect.suspend` so the latch is per-attempt — the retry below re-enters
   *  this, exactly as `Stream.suspend` re-enters `streamFn`.
   *
   *  Deliberately NOT a per-pull timeout (`Stream.timeoutFail` and friends bound
   *  the GAP between elements): those kill an idle pane, which is the healthy
   *  majority. The watcher sleeps ONCE and then reads the latch — set, and it
   *  parks on `Effect.never` until `raceFirst` interrupts it when the consume
   *  settles; unset, and the silence is the verdict. */
  const oneAttempt = Effect.suspend(() => {
    attemptSawFrame = false;
    const consume = Stream.runForEach(Stream.suspend(streamFn), (item) =>
      // `Effect.suspend`, not `Effect.sync`: the handler's REFUSAL has to land in
      // the error channel, and a value returned out of `Effect.sync` would just be
      // a success the loop ignores — the exact conflation this shape replaces. A
      // throw still escapes as a defect, which is channel 1 and stays that way.
      Effect.suspend(() => {
        // A REFUSED frame still counts as a frame: the chain delivered, and the
        // refusal has its own (channel 2) road. Which is also why a refusal
        // refills the budgets — a stale-grid ping-pong is a WRAPPING artifact
        // over a working chain, and must never walk a pane into a verdict meant
        // for a chain that delivers nothing.
        if (!attemptSawFrame) {
          attemptSawFrame = true;
          startFreshEpisode();
        }
        const refused = onItem(item);
        return refused ? Effect.fail(refused) : Effect.void;
      }),
    );
    const firstFrameWatch = Effect.sleep(FIRST_FRAME_DEADLINE_MS).pipe(
      Effect.flatMap(() =>
        attemptSawFrame ? Effect.never : silentOpenVerdict,
      ),
    );
    return Effect.raceFirst(consume, firstFrameWatch);
  });

  return oneAttempt.pipe(
    Effect.flatMap(() => classifyCleanEnd),
    // The typed "this terminal is gone" verdict ENDS the loop — placed INSIDE the
    // retry so it converts to success before the schedule ever sees it.
    Effect.catch((err) =>
      isDeclared(err, TERMINAL_NOT_FOUND)
        ? Effect.sync(() => {
            console.info(`${label}: the terminal is gone — attach loop ended`);
          })
        : Effect.fail(err),
    ),
    // The FRUITLESS run, counted before anything is reported: this attempt
    // failed into channel 2 having delivered nothing at all. Consecutive, so a
    // single frame anywhere resets it (that reset lives in the frame handler,
    // with the refill). See {@link FRUITLESS_CYCLE_VERDICT}.
    Effect.tapError(() =>
      Effect.suspend(() => {
        if (attemptSawFrame) return Effect.void;
        fruitlessCycles++;
        return fruitlessCycles >= FRUITLESS_CYCLE_VERDICT
          ? verdict(
              `${fruitlessCycles} consecutive re-attach cycles have produced no first frame`,
            )
          : Effect.void;
      }),
    ),
    Effect.tapError((err) =>
      Effect.sync(() => {
        // Fresh reset FIRST so the reopened stream's snapshot repaints cleanly.
        // Inside the retry, so it fires once per channel-2 end and never after a
        // graceful one — the same "fired ⇒ a re-subscribe follows" rule the
        // framework fence holds for `onRetry`. Which is also why this line says
        // "re-attaching" and nothing else does: reaching it MEANS the retry
        // below is about to re-subscribe. The cause rides in `err` rather than
        // in prose, because all three channel-2 members land here — a mid-chain
        // death, a refused frame, an unexpected clean end.
        console.warn(`${label}: re-attaching`, err);
        // CONTAINED, and this is the one place containment is right. `onReattach`
        // is the caller's screen hygiene (xterm reset, scroll-lock drop, backfill
        // reset) and it CAN throw — `terminal.reset()` on a terminal xterm has
        // already disposed is the reachable case. A throw here is a defect, and a
        // defect skips the retry (channel 1): the loop would die having just
        // WIPED the pane, which is the blank-pane-over-a-live-agent rendering
        // this module exists to kill, and it would break the promise stated three
        // lines up. So the failed reset is reported loudly and the re-attach goes
        // ahead — the fresh snapshot repaints from scratch anyway, so a reset
        // that did not happen costs at worst one double-painted frame, against a
        // dead pane for certain. Nothing is collapsed to an empty state: the
        // error is surfaced with its cause. The framework's own `containThrow`
        // says the same thing one layer down, but it is not exported to
        // consumers, and adding an export is a gated @kolu/surface change
        // (`.claude/rules/surface.md`) — see this round's sweep report, which
        // records the same defect on `fenceStream`'s `onRetry`.
        try {
          onReattach();
        } catch (resetErr) {
          console.error(
            `${label}: the pre-re-attach reset threw — re-attaching anyway`,
            resetErr,
          );
        }
      }),
    ),
    // The spacing is READ at each recurrence, not baked in: a verdict demotes
    // the loop to {@link DEMOTED_RETRY_MS} and a delivered frame lifts it back
    // to {@link REATTACH_BACKOFF_MS}. `modifyDelay` is the seam for that — the
    // schedule stays one infinite `spaced`, so nothing about interruption
    // (an unmount landing in the sleep) changes.
    Effect.retry(
      Schedule.spaced(REATTACH_BACKOFF_MS).pipe(
        Schedule.modifyDelay(() =>
          Effect.sync(() =>
            Duration.millis(demoted ? DEMOTED_RETRY_MS : REATTACH_BACKOFF_MS),
          ),
        ),
      ),
    ),
  );
}
