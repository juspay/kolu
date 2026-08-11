/**
 * The client-side terminal WATCH kit — follow padi's `terminals` collection
 * live, block until one terminal's agent enters a target bucket, block until one
 * terminal's output has been quiet for a window, and block until one terminal's
 * NEW output matches a pattern. Part of the dial kit (re-exported through
 * `@kolu/padi/dial`): a daemon's package owns the client helpers its consumers
 * share.
 *
 * Graduated here from padi-tui (`read.ts`/`render.ts`) the day the kolu MCP
 * face's `wait_agentState` became the VERBATIM second consumer — both drive
 * the same `padiSurface`, so a copy in each would be two lockstep owners of
 * the wait predicate (the unification gate the padi note records). padi-tui
 * imports these back; the CLI-flag grammar (`--until`'s comma parse and its
 * error strings) stays in padi-tui — only the surface-shaped vocabulary and
 * the watch/wait machinery live here.
 *
 * The race/lifecycle boilerplate rides `@kolu/surface/wait`'s `runWait`
 * scaffold; this module owns only the padi-shaped watchers and predicates.
 */

import { unenrolledStreamCall } from "@kolu/surface/client";
import { isDeadTransportError } from "@kolu/surface/errors";
import { isTerminalNotFound, isWatchSubscriptionNotFound } from "../errors.ts";
import { Effect, Stream } from "effect";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  runWait,
  type WaitCtx,
  type WaitMet,
  type WaitOutcome,
} from "@kolu/surface/wait";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiSurfaceClient } from "../dial.ts";
import { errMessage } from "../errText.ts";
import {
  padiSurface,
  type PadiSettleEvent,
  type PadiTerminal,
} from "../surface.ts";
import { activeAgent } from "../terminalVocab.ts";

/** Consume a member `Stream` as an async iterable whose teardown is bound to
 *  `signal`.
 *
 *  A member verb hands back a LAZY `Stream` and there is no `signal` option left
 *  to pass it (D10/#18) — cancellation is fiber interruption, and
 *  `toAsyncIterable`'s `return()` is what performs it. The waits in this module
 *  are driven by a non-Effect scaffold (`runWait`) that speaks AbortSignal, so
 *  the translation happens HERE, once, rather than at each of the two PUMP
 *  sites. Without it an abandoned wait would leave its subscription running for
 *  the life of the connection. The one-shot membership read rides it too, now
 *  that the framework's first-frame readers are Effects with no signal to take
 *  and no fiber here to compose into. */
function iterateUntilAborted<T>(
  stream: Stream.Stream<T, unknown>,
  signal: AbortSignal,
): AsyncIterable<T> {
  const iter = Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();
  const close = (): void => {
    void iter.return?.();
  };
  if (signal.aborted) close();
  else signal.addEventListener("abort", close, { once: true });
  return { [Symbol.asyncIterator]: () => iter };
}

// The pure vocabulary (`activeAgent`, `WAIT_STATES`, `WaitState`,
// `isWaitState`) lives one layer DOWN, in `terminalVocab.ts`, and is
// re-exported here so every consumer's import path is unchanged. It moved
// because `render.ts` — which promises "no I/O, no transport, no tty" — needs
// it, and reaching it through this module dragged the whole dial graph into a
// text formatter. See that file's header.
export {
  activeAgent,
  isWaitState,
  PADI_LINK_CLOSED,
  WAIT_STATES,
  type WaitState,
} from "../terminalVocab.ts";

/** The live agent of a record IF it is in one of the target buckets, else
 *  `null` — THE wait predicate, and its match payload in one. A record with no
 *  live agent (a bare shell, a sleeping/parked terminal, or an agent that
 *  exited) never matches; otherwise its `state` folds through the shared
 *  `agentBucket` and is tested for membership. Returns the matched agent (not a
 *  bare boolean) so the caller that needs it for the `met` outcome doesn't
 *  re-resolve `activeAgent` a second time — one narrowing, one source of truth.
 *
 *  Exported for this package's own tests, and deliberately NOT re-exported
 *  through `dial.ts`: it is a private step of {@link awaitAgentState}, which is
 *  what consumers actually call. The boolean wrapper that used to sit beside it
 *  (`agentMatchesUntil`) rode the dial entry as public surface with no
 *  production caller anywhere in the repo — it only ever threw away the agent
 *  this returns. */
export function matchingActiveAgent(
  v: PadiTerminal,
  targets: ReadonlySet<string>,
): AgentInfo | null {
  const agent = activeAgent(v);
  return agent !== null && targets.has(agentBucket(agent.state)) ? agent : null;
}

/** Handlers a live watch reacts to. `live` is whether the terminal is moving
 *  bytes RIGHT NOW (the `activity` stream's current membership) at the instant
 *  of the record change — annotation only; an activity-only flip emits no line
 *  of its own (it pulses ~1s while bytes move, which would drown the feed), it
 *  just colours the next record line. */
export interface WatchHandlers {
  onUpsert: (id: TerminalId, value: PadiTerminal, live: boolean) => void;
  onRemove: (id: TerminalId) => void;
  /** A terminal STARTED (`live` true) or STOPPED (`live` false) moving bytes —
   *  the `activity` stream's live-set transitions, so byte-activity is visible
   *  on its own, not only as a `●` annotation on a coincident awareness line.
   *  A continuously-busy terminal fires ONE `true` (its idle timer keeps
   *  re-arming), then one `false` when output stops — no ~1s pulse spam.
   *  Optional; a wait ignores it. */
  onActivity?: (id: TerminalId, live: boolean) => void;
}

/** Follow the `terminals` collection live until the link closes (the caller
 *  disposes on Ctrl+C) or `signal` aborts. One `mirrorRemoteSurface` drives
 *  both the `terminals` collection (the rows) and the `activity` stream (the
 *  live dot): the activity frame updates a local live-set the upsert handler
 *  reads, so a printed line reflects whether that terminal was moving bytes at
 *  the time.
 *
 *  `log` is the diagnostic sink for NON-abort upstream failures (a dropped
 *  link, a protocol error). Without it a real connection loss would look like
 *  a clean stop — so a watch passes a stderr sink and treats an un-aborted
 *  settle as a failure.
 *
 *  `initialKeys` seeds the mirror's cross-connect reconciliation: any key it
 *  lists that is ABSENT from the collection's first snapshot fires `onRemove`
 *  at once (the mirror's own departed-while-away sweep). A wait passes the id
 *  it is watching, so a terminal that exited in the gap between id-resolution
 *  and this subscription is reported gone on the first frame rather than
 *  hanging forever. */
export async function watchTerminals(
  client: PadiSurfaceClient,
  handlers: WatchHandlers,
  signal?: AbortSignal,
  log?: (line: string) => void,
  initialKeys?: () => Iterable<TerminalId>,
): Promise<void> {
  // The `activity` stream's current membership — the set of terminals moving
  // bytes right now — built up from the mirror's own `activity` frames below.
  // It starts EMPTY and stays that way until the first frame: padi builds a
  // FRESH per-subscription activity tracker whose first frame is always the
  // empty set (a new subscriber can't learn which terminals were ALREADY busy —
  // bytes are only counted from the deltas that arrive AFTER it subscribes), so
  // there is nothing a pre-seed subscription could recover. An already-busy
  // terminal simply lights on its next output chunk.
  const live = new Set<TerminalId>();
  // The activity stream feeds ONLY `onActivity` and the `live` boolean coloring
  // that upsert reads — so a consumer that wants neither (the `wait` paths pass
  // only `onUpsert`/`onRemove` and ignore the `live` arg) pays nothing for it.
  // Gate the whole subscription on `onActivity`: an unbounded `wait_agentState`
  // over `--host` would otherwise hold a second ssh-piped stream open and churn
  // a discarded `new Set` per ~1s activity pulse for its entire lifetime, all to
  // drive a no-op callback. When gated off, `live` stays empty and upsert's
  // `live.has(id)` is a harmless constant `false` (the coloring was unused).
  const wantsActivity = handlers.onActivity !== undefined;
  await mirrorRemoteSurface(
    padiSurface,
    client,
    {
      collections: {
        terminals: {
          // Guard the consumer callbacks at this funnel: a throwing handler must
          // not escape into the mirror's internal loop and wedge the whole watch —
          // contain it to the one frame and surface it via `log`.
          upsert: (id, value) => {
            try {
              handlers.onUpsert(id, value, live.has(id));
            } catch (err) {
              log?.(
                `terminals upsert handler failed: ${(err as Error).message}`,
              );
            }
          },
          remove: (id) => {
            try {
              handlers.onRemove(id);
            } catch (err) {
              log?.(
                `terminals remove handler failed: ${(err as Error).message}`,
              );
            }
          },
          // A key here that the first snapshot doesn't re-assert departed before
          // we subscribed — the mirror fires `onRemove` for it once (see
          // `awaitAgentState`).
          ...(initialKeys !== undefined ? { initialKeys } : {}),
        },
      },
      streams: wantsActivity
        ? {
            activity: {
              input: {},
              onFrame: (ids) => {
                const next = new Set(ids);
                // Emit a transition for each terminal that STARTED or STOPPED
                // moving bytes since the last frame, so byte-activity shows on
                // its own line. `live` starts empty and fills from these frames.
                // Guard the callback so a throwing consumer can't wedge the loop.
                const fire = (id: TerminalId, isLive: boolean): void => {
                  try {
                    handlers.onActivity?.(id, isLive);
                  } catch (err) {
                    log?.(`activity handler failed: ${(err as Error).message}`);
                  }
                };
                for (const id of next) if (!live.has(id)) fire(id, true);
                for (const id of live) if (!next.has(id)) fire(id, false);
                live.clear();
                for (const id of next) live.add(id);
              },
            },
          }
        : {},
    },
    { signal, log },
  ).done;
}

// The named waits — `awaitAgentState` · `awaitOutputSettled` — live at the FOOT
// of this file now, beside the one engine they are each a spelling of
// ({@link awaitTerminalCondition}). This module reads spine → engine → the
// named waits. (The `match:` form has no wrapper: `kolu wait` is its only
// consumer and calls the engine directly.)

// ── The attach-feed spine (shared by every wait that watches OUTPUT) ─────────

/** One frame of the `terminalAttach` feed, as an output wait reads it — the
 *  member's OWN discriminated union (`surface.ts` → `terminalAttach.outputSchema`,
 *  mirrored by `TerminalAttachFrame` in `endpoint.ts`), narrowed to the fields
 *  both waits read. The settle wait needs only that a frame ARRIVED, the match
 *  wait needs a `delta`'s bytes, and neither has any use for
 *  `topLine`/`reflowEpoch` — so the spine hands the frame across at exactly that
 *  width, dropping the snapshot's backfill seed but NOT its identity.
 *
 *  The arms are LITERALS, not a bare `kind: string`, because the whole match
 *  wait hangs off one comparison (`frame.kind !== "delta"`). Typed loosely, a
 *  rename or a typo of that literal compiles clean and silently disables all
 *  scanning — a `match:` wait that can never fire, reported to its caller as a
 *  plain timeout. Spelled as a union, the compiler rejects any `kind` the wire
 *  does not carry, and the `!== "delta"` site narrows the remainder to
 *  `snapshot` instead of to `unknown-shaped`. `data` is non-optional on both
 *  arms because the wire puts it on both; there is no frame whose bytes are
 *  absent, so no reader has to invent an empty one. */
type AttachFrame =
  | { readonly kind: "snapshot"; readonly data: string }
  | { readonly kind: "delta"; readonly data: string };

/**
 * Subscribe terminal `id`'s output feed (and its exit event) for the duration of
 * a {@link runWait}, and settle the outcomes the FEED itself decides — `gone`
 * when the terminal is no longer there, `closed` when padi dropped a feed whose
 * terminal is still live. The CONDITION stays the caller's: every frame goes to
 * `onFrame`, which settles `met` once it has seen enough.
 *
 * Factored out when the THIRD 'block on a padiSurface condition' primitive
 * (the `match:` scan) landed beside {@link awaitOutputSettled}: the two
 * differ only in what they do with a frame, and the subscription discipline
 * underneath is one thing — the part that is easy to get quietly wrong, and the
 * exact part a hand-rolled copy in a composition root got wrong:
 *
 *   - **The retry fence.** Both members ride `unenrolledStreamCall`
 *     (`.claude/rules/streaming.md` rule 1), so a transport blip transparently
 *     re-subscribes instead of killing the wait. Consuming a member's `Stream`
 *     directly silently loses reconnect handling — no error, just a wait that
 *     dies on a blip. UN-enrolled deliberately: one terminal's re-attach must
 *     never flicker padi's connection-health gate (the Leak-A carve-out).
 *   - **`onFeedLost` — the state a feed we can no longer observe made stale.**
 *     Fired INSIDE the fence on every retry (before the delay, so "fired ⇒ a
 *     re-subscribe with a fresh snapshot follows" holds) and again when the feed
 *     drops for good. The settle wait disarms its idle window with it (a window
 *     armed by the last pre-drop frame would fire a FALSE `met` across the
 *     reconnect gap); the match wait clears its buffer with it (bytes from
 *     either side of an unobservable gap must not concatenate into a sentinel
 *     nobody printed).
 *   - **The lost-feed discrimination.** A feed that ends with no outcome is
 *     either "the terminal exited" (→ `gone`) or "we were dropped while it is
 *     still live" (→ `closed`, loud — never a fabricated `gone`), told apart by
 *     the live `terminals` key set. A DEAD transport is neither: it poisons the
 *     shared connection, so it PROPAGATES out of `runWait` instead of being
 *     folded into a benign `closed`.
 *
 * `onExit` is the one thing the two waits genuinely disagree about, so it is a
 * caller decision rather than a mode flag here:
 *
 *   - {@link awaitOutputSettled} SETTLES `gone` on it: an exited terminal can
 *     never go quiet in a way its caller would want reported, and settling early
 *     costs it nothing.
 *   - the `match:` FORM passes NO `onExit`, so the exit is only LATCHED:
 *     a sentinel that printed may still be in flight on the ordered attach feed
 *     when the (separately-subscribed, separately-ordered) exit event lands, and
 *     a match that actually printed must WIN. The feed's END is the proof that
 *     no bytes are left, and it always comes: padi drops an exited terminal from
 *     its registry, so the attach relay's next re-open answers not-found and the
 *     stream ends.
 *
 * Either way the latch feeds the discrimination: an exit we OBSERVED is proof
 * the terminal is gone, so the feed's end needs no membership round-trip and an
 * unreadable key set can no longer downgrade a real exit to `closed`.
 *
 * `retryAdvice` is the actionable tail of the `closed` diagnostic — "retry X",
 * where only the wait itself knows what X is called (`wait_outputSettled` names
 * the MCP tool its sibling backs). A dropped feed is re-runnable, and saying so
 * is the difference between a diagnostic and a dead end.
 */
async function watchAttachFeed<Met extends WaitMet>(
  client: PadiSurfaceClient,
  ctx: WaitCtx<Met>,
  opts: {
    readonly id: string;
    /** Every frame of the feed, in order — where the caller's condition lives. */
    readonly onFrame: (frame: AttachFrame) => void;
    /** Drop whatever state was accumulated from a feed we can no longer
     *  observe: a fence re-subscribe, or the feed dropping for good. Both are
     *  told the same thing on purpose — when this fires, the spine has NOT yet
     *  discriminated an exited terminal from a dropped feed over a live one, so
     *  the only sound reaction to either is to forget what can no longer be
     *  observed. A caller that wants to act on the terminal being GONE has
     *  {@link onTerminalGone}, which fires only once that is PROVEN. */
    readonly onFeedLost: () => void;
    /** What an OBSERVED `terminalExit` does beyond latching it (see above). */
    readonly onExit?: () => void;
    /** The terminal is PROVEN gone — the ordered feed has ended (so every byte
     *  it will ever produce has been delivered) AND either its exit was observed
     *  or its id has left the `terminals` key set. Fired immediately BEFORE the
     *  `gone` settle, so a caller holding a condition that a dead terminal
     *  satisfies vacuously can claim it first (`settle` is first-writer-wins).
     *
     *  This is the ONLY place that evidence exists. {@link onFeedLost} fires
     *  before the discrimination, so acting on it would let a LIVE terminal's
     *  dropped feed — the `closed` arm — mint a met; and `onExit` fires on a
     *  SEPARATELY ordered subscription, so it can arrive before the bytes that
     *  decide the condition. */
    readonly onTerminalGone?: () => void;
    /** The actionable tail of the `closed` line ("retry wait_outputSettled"). */
    readonly retryAdvice: string;
  },
): Promise<void> {
  let feedError: string | undefined;
  // Did `terminalExit` fire? Latched, never assumed: see the `onExit` note.
  let sawExit = false;

  // The output feed ended before any outcome and without an abort we caused.
  // Same discrimination as kaval-tui's wait: the terminal exited (we saw its
  // exit, or its id has left the `terminals` key set → `gone`), or the feed was
  // dropped while the PTY is still live (→ `closed`, loud). The caller's stale
  // state is dropped FIRST — an idle window left armed would fire a FALSE `met`
  // off the last frame of a feed we can no longer observe.
  const settleOnLostFeed = async (): Promise<void> => {
    opts.onFeedLost();
    // An observed exit already answers the question the key set is read for.
    if (sawExit) {
      opts.onTerminalGone?.();
      ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
      return;
    }
    try {
      // Bind the read to ctx.signal: this membership read rides the SAME
      // retry-mounted client as the attach feed (STREAM_RETRY, retry
      // Infinity), so without it a wedged-but-alive link would retry forever
      // and the read would never return — hanging runWait past a later
      // timeout/cancel settle (WaitCtx's threading contract, and the exact
      // unbounded-tail hazard the scaffold's recorded follow-up names). An
      // abort rejects the read into the catch below, where the settle is a
      // first-writer no-op.
      //
      // The one-shot read rides this module's OWN abort→interruption bridge
      // (`iterateUntilAborted`) rather than `firstFrameOrThrow`: that reader is
      // an `Effect` now and takes no signal, and `runWait` — the non-Effect
      // scaffold this whole wait is driven by — has no fiber to compose it
      // into. Same contract, same message: a first frame or a loud failure.
      let keys: readonly string[] | undefined;
      for await (const frame of iterateUntilAborted(
        client.surface.terminals.keys(undefined),
        ctx.signal,
      )) {
        keys = frame;
        break;
      }
      if (keys === undefined) {
        throw new Error(
          "padi terminals keys yielded no snapshot frame — link or protocol failure.",
        );
      }
      if (!keys.includes(opts.id as (typeof keys)[number])) {
        opts.onTerminalGone?.();
        ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
        return;
      }
    } catch (err) {
      // A DEAD transport is not a healthy feed-end — it poisons the shared
      // connection, so it must PROPAGATE (out of runWait → the tool throws →
      // surface-mcp's `withClient` resets the connection so the NEXT wait
      // redials). Folding it into `closed` here leaves the caller reusing a
      // dead socket forever. A healthy-transport lost feed (a slow-consumer
      // drop) still settles `closed` below.
      if (isDeadTransportError(err)) throw err;
      const m = errMessage(err);
      feedError ??= m;
      ctx.recordUpstreamError(m);
    }
    ctx.settle({
      kind: "closed",
      error:
        feedError ??
        `the daemon ended ${opts.id}'s output feed while its terminal is still live — ${opts.retryAdvice}.`,
    });
  };

  const consumeOutput = async (): Promise<void> => {
    try {
      const stream = unenrolledStreamCall(
        (input: { id: string }) => client.surface.terminalAttach.get(input),
        { id: opts.id },
        {
          // Named per PTY for the liveness registry (kolu#2101 J2).
          label: `terminalAttach[${opts.id}] (padi watch)`,
          // The fence's per-subscription `onRetry` tap (S3/#8): a STREAM_RETRY
          // reconnect (retryDelay ~1000ms) can outlast the caller's own window,
          // so anything the caller accumulated from the pre-drop feed is dropped
          // here — the state only ever restarts from the fresh snapshot the
          // reconnect delivers (see the `onFeedLost` note above).
          onRetry: opts.onFeedLost,
        },
      );
      for await (const frame of iterateUntilAborted(stream, ctx.signal)) {
        opts.onFrame(frame);
      }
      if (!ctx.signal.aborted) await settleOnLostFeed();
    } catch (err) {
      // An abort (the condition landed, a timeout, a cancelled request) is the
      // expected end. A DEAD transport rejects non-retryably through
      // STREAM_RETRY's fence and PROPAGATES (poisons the shared connection —
      // see settleOnLostFeed). Any other non-abort error is a dropped feed →
      // settle loud.
      if (!ctx.signal.aborted) {
        if (isDeadTransportError(err)) throw err;
        const m = errMessage(err);
        feedError ??= m;
        ctx.recordUpstreamError(m);
        await settleOnLostFeed();
      }
    }
  };

  const consumeExit = async (): Promise<void> => {
    try {
      const stream = unenrolledStreamCall(
        (input: { id: string }) => client.surface.terminalExit.get(input),
        { id: opts.id },
        { label: `terminalExit[${opts.id}] (padi watch)` },
      );
      for await (const _msg of iterateUntilAborted(stream, ctx.signal)) {
        sawExit = true;
        opts.onExit?.();
        return;
      }
    } catch {
      // Losing the exit event is NOT fatal: a real exit also ends the
      // terminalAttach feed → settleOnLostFeed → gone (consumeOutput is the
      // backstop). An abort is likewise the expected end. Mirrors kaval-tui's
      // consumeExit non-recording rationale.
    }
  };

  await Promise.all([consumeOutput(), consumeExit()]);
}

/** The outcome of a standing-subscription wait — the shared {@link WaitOutcome}
 *  with the drained batch as its met payload. */
export type WatchEventsOutcome = WaitOutcome<{
  events: readonly PadiSettleEvent[];
  dropped: number;
  ackAfter: number;
  elapsedMs: number;
}>;

/** Block until the named standing subscription has settle events, then drain and
 *  return them; or `timeout` after `timeoutMs`.
 *
 *  The third sibling of {@link awaitAgentState} / {@link awaitOutputSettled}, and
 *  the one that differs in kind: those two watch a LIVE condition and see only
 *  what happens while the call is open, so anything between two calls is
 *  unobservable. This one drains a padi-side BUFFER, so the gaps between calls
 *  are not holes — which is the whole reason a supervisor can stop hand-rolling
 *  watcher processes.
 *
 *  **The subscribe-then-drain order is load-bearing.** The pulse is taken FIRST
 *  and its baseline frame read BEFORE the drain, so an event landing in the
 *  window between them still rings a pulse the wait is already listening for.
 *  Draining first and subscribing after would drop exactly that event into the
 *  gap — the same shape of hole this whole feature exists to close.
 *
 *  A missed pulse is survivable by construction: the buffer, not the pulse, is
 *  the authority, so the worst case is waiting out the timeout and finding the
 *  events on the next call. */
export async function awaitWatchEvents(
  client: PadiSurfaceClient,
  opts: {
    name: string;
    /** The `ackAfter` from the caller's last SUCCESSFULLY-received batch — the
     *  acknowledgement. Omit on a first call. Until an ack comes back, padi
     *  keeps handing the same events over, which is what makes a lost reply cost
     *  a repeat rather than an event. */
    after?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<WatchEventsOutcome> {
  return runWait<{
    events: readonly PadiSettleEvent[];
    dropped: number;
    ackAfter: number;
    elapsedMs: number;
  }>({ timeoutMs: opts.timeoutMs, signal: opts.signal }, async (ctx) => {
    const drainNow = async (): Promise<boolean> => {
      // A procedure ref is an `Effect` (D10/#18); `runWait` is the non-Effect
      // scaffold this wait is driven by, so the crossing happens here.
      //
      // `after` acknowledges the batch the CALLER told us it processed on its
      // last successful call. This wait cannot acknowledge on its own behalf: it
      // hands its batch to an MCP tool whose reply may never reach the agent, so
      // "received" is a fact only the agent's NEXT call can assert.
      const drained = await Effect.runPromise(
        client.surface.watch.drain({
          name: opts.name,
          ...(opts.after === undefined ? {} : { after: opts.after }),
        }),
      );
      if (drained.events.length === 0 && drained.dropped === 0) return false;
      ctx.settle({
        kind: "met",
        events: drained.events,
        dropped: drained.dropped,
        ackAfter: drained.ackAfter,
        elapsedMs: ctx.elapsedMs(),
      });
      return true;
    };

    let baseline: number | undefined;
    try {
      const stream = unenrolledStreamCall(
        (input: { name: string }) => client.surface.watchPulse.get(input),
        { name: opts.name },
        { label: `watchPulse[${opts.name}] (padi watch)` },
      );
      for await (const frame of iterateUntilAborted(stream, ctx.signal)) {
        if (baseline === undefined) {
          // The subscription is live from here on. Drain now: anything already
          // buffered settles immediately, and anything arriving from this moment
          // rings a pulse this loop will see.
          baseline = frame.seq;
          if (await drainNow()) return;
          continue;
        }
        // A ring. Re-drain; a pulse that races an empty buffer (another consumer
        // drained first) just keeps waiting rather than settling a false empty.
        if (frame.seq !== baseline) {
          baseline = frame.seq;
          if (await drainNow()) return;
        }
      }
      // The pulse feed ended without an outcome and without an abort we caused.
      // The subscription itself may be perfectly healthy, so this is `closed`
      // (retryable) and never `gone` — a lost feed is not a lost subscription.
      if (!ctx.signal.aborted) {
        ctx.settle({
          kind: "closed",
          error: `the daemon ended the pulse feed for subscription "${opts.name}" — retry watch_next; buffered events are not lost.`,
        });
      }
    } catch (err) {
      if (ctx.signal.aborted) return;
      // A DEAD transport poisons the shared connection and must PROPAGATE so the
      // MCP face resets it before the next call (see `awaitOutputSettled`).
      if (isDeadTransportError(err)) throw err;
      // "NO SUCH SUBSCRIPTION" MUST NOT BECOME "closed". `closed` means the
      // notification channel dropped over a queue that is still there, and every
      // caller is told to simply retry — which for an unopened (or typo'd, or
      // padi-restart-cleared) name is an infinite loop being reassured its
      // events are safe. This is the exact confusion `WatchSubscriptionNotFound`
      // was declared to prevent, and folding it in here would have re-created it
      // one layer up. Propagate so the caller sees the name it must re-open.
      if (isWatchSubscriptionNotFound(err)) throw err;
      const m = errMessage(err);
      ctx.recordUpstreamError(m);
      ctx.settle({ kind: "closed", error: m });
    }
  });
}

// ── The `match:` scan ────────────────────────────────────────────────────────

/** How much ALREADY-SCANNED output is carried into the next scan — the OVERLAP
 *  that lets a sentinel split across a chunk boundary still match, and the ONLY
 *  history the match wait keeps.
 *
 *  It is deliberately not a rolling 64KiB buffer that is re-searched whole on
 *  every delta (what this wait, and kaval-tui's `awaitOutputCondition` twin,
 *  used to do). That shape makes each frame's scan cost grow with the WINDOW
 *  rather than with the new bytes, so a chatty terminal multiplies whatever the
 *  pattern costs per character by 64Ki, every frame, on the event loop that owns
 *  the wait's own `--timeout` timer. Scanning `carry + delta` instead keeps the
 *  work proportional to the output actually produced.
 *
 *  4096 is in UTF-16 CODE UNITS — `String.length`/`slice` units, i.e. 4KiB of
 *  ASCII and less text than that for non-ASCII output. Stated in the unit the
 *  code actually counts in rather than as "bytes", which it never was; the trim
 *  ({@link carryTail}) additionally refuses to cut a surrogate pair in half, so
 *  the carry is always a well-formed string. Any realistic sentinel is orders of
 *  magnitude shorter, so a marker straddling a chunk boundary is still caught. */
const MATCH_OVERLAP_CAP = 1 << 12;

/** The trailing {@link MATCH_OVERLAP_CAP} code units of `window` — the carry the
 *  next scan is prefixed with, keeping a sentinel that spans deltas matchable.
 *
 *  The cut moves one unit earlier when it would land INSIDE a surrogate pair: a
 *  carry that led with an orphaned low surrogate would put a character no
 *  terminal printed at the head of the next scan, and could hide a sentinel that
 *  begins with an astral character. */
function carryTail(window: string): string {
  if (window.length <= MATCH_OVERLAP_CAP) return window;
  let start = window.length - MATCH_OVERLAP_CAP;
  const head = window.charCodeAt(start);
  // A low surrogate at the cut has its high partner in the unit just before it
  // (start ≥ 1 here, since window is longer than the cap).
  if (head >= 0xdc00 && head <= 0xdfff) start -= 1;
  return window.slice(start);
}

/** Strip VT control sequences (OSC + CSI) and `\r` so a `matchedLine` reads
 *  cleanly in a caller's human/JSON output. The match itself runs against the
 *  RAW bytes (so an escape between two letters can't hide a sentinel from the
 *  pattern); this only tidies the REPORTED line. OSC is stripped too because a
 *  shell prompt's title-set (`\x1b]0;…\x07`/ST-terminated) routinely leads a
 *  line, and a CSI-only strip would leave those bytes raw in the reported line.
 *  Ported from kaval-tui. */
function cleanLine(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … (BEL- or ST-terminated)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\r/g, "")
    .trim();
}

/** The (cleaned) line of `window` containing the match at `index` — so the
 *  caller can report WHICH output line tripped the pattern. Ported from
 *  kaval-tui. The line is read out of the SCANNED window, so a line whose head
 *  predates the carry is reported from the window's start; the reported line is
 *  a diagnostic, and the carry is far longer than any line worth reading. */
function matchedLineAt(window: string, index: number): string {
  const start = window.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nl = window.indexOf("\n", index);
  return cleanLine(window.slice(start, nl === -1 ? window.length : nl));
}

// ── The engine — one condition, two orthogonal modifiers ────────────────────

/**
 * What a wait BLOCKS ON, as data — the three forms `kolu wait --until` spells,
 * with the argv grammar that tells them apart left in the CLI where it belongs.
 *
 *   `idle`   no output byte for `idleMs`. Agent-agnostic: a bare shell, a
 *            `less`, an agent nobody wrote a state sensor for.
 *   `match`  NEW output matched `pattern` — the sentinel/marker route, likewise
 *            agent-agnostic.
 *   `agent`  the terminal's detected agent reached one of `targets`. The PRECISE
 *            route: it distinguishes "the turn ended" from "the model paused
 *            mid-thought", which no quiescence window can.
 */
export type TerminalCondition =
  | { readonly kind: "idle"; readonly idleMs: number }
  | { readonly kind: "match"; readonly pattern: RegExp }
  | { readonly kind: "agent"; readonly targets: ReadonlySet<string> };

/** The condition's own evidence while it HOLDS — the met payload before the
 *  wait stamps its clock and (when asked) the screen onto it. Its `fired` tag is
 *  what makes the three forms tellable apart downstream by ONE discriminant
 *  rather than by guessing from which field is present. */
export type ConditionHeld =
  | { readonly fired: "idle" }
  | { readonly fired: "match"; readonly matchedLine: string }
  | { readonly fired: "agent"; readonly agent: AgentInfo };

/** What a met carries: the condition's own evidence, how long the wait took —
 *  and, when `captureScreen` was asked for, the terminal's rendered `screen`.
 *
 *  DERIVED from {@link ConditionHeld} rather than re-declared: the three arms
 *  were spelled twice and had already drifted (one copy `readonly`, the other
 *  not), which is two statements of one fact waiting to disagree about a third.
 *
 *  `screen` is optional in the TYPE and NOT optional in fact: it is present on
 *  every met of a wait that asked for it, because a read that fails settles a
 *  failing arm instead of a met without it (a met missing the screen its caller
 *  asked for is exactly the collapse-to-empty this repo treats as a defect).
 *  TypeScript cannot tie a payload field to an argument's presence, so
 *  {@link awaitTerminalCondition} CRASHES rather than settling such a met, and
 *  the guarantee is checked where it lives instead of by each consumer. */
export type ConditionMet = Stamped<ConditionHeld>;

/** Stamp the wait's own facts onto a condition's evidence, DISTRIBUTIVELY —
 *  `H extends unknown ?` is what keeps the result a three-arm union rather than
 *  one intersection carrying a union inside it. That distinction is not
 *  cosmetic: a `switch (outcome.kind)` narrows a union and does not narrow an
 *  intersection, so the non-distributive spelling silently costs every consumer
 *  its exhaustive outcome switch. */
type Stamped<H> = H extends unknown
  ? H & { readonly elapsedMs: number; readonly screen?: string }
  : never;

/** The outcome of a {@link awaitTerminalCondition} — the shared
 *  {@link WaitOutcome} union over {@link ConditionMet}. */
export type TerminalConditionOutcome = WaitOutcome<ConditionMet>;

/** The met arm a given condition form can fire — 1:1 with `TerminalCondition`'s
 *  `kind` by construction, so a wrapper that passes a literal condition gets its
 *  own narrow outcome back and needs no runtime re-narrowing. This replaced a
 *  `metFired` helper that checked at RUNTIME what the types already know. */
export type MetOf<C extends TerminalCondition> = WaitOutcome<
  Extract<ConditionMet, { fired: C["kind"] }>
>;

/** The shared timer-range rule at an EXPORTED primitive's boundary. The MCP
 *  schema and the CLI parse each guard their own caller, but a direct caller
 *  could pass 0 / non-finite / a value above the `setTimeout` ceiling, and an
 *  overflowed window fires a FALSE near-instant `met`. `what` names the option
 *  so the crash says which one was wrong. */
function requireTimerMs(what: string, ms: number): void {
  if (!isValidTimerMs(ms)) {
    throw new RangeError(
      `${what} must be between 1 and ${MAX_TIMER_MS} (~24.8 days), got ${ms} — a larger window overflows setTimeout and fires a false near-instant met.`,
    );
  }
}

/** A re-armable quiescence window. `arm()` restarts the countdown, `disarm()`
 *  cancels it, and `onQuiet` fires when `ms` pass with neither.
 *
 *  Spelled once because a wait can run TWO of them at the same time — the
 *  `idle:` CONDITION's window and the `--settled` CONJUNCT's — and they differ
 *  only in what they set when they fire. */
function quietWindow(
  ms: number,
  onQuiet: () => void,
): { readonly arm: () => void; readonly disarm: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return {
    arm: () => {
      disarm();
      timer = setTimeout(onQuiet, ms);
    },
    disarm,
  };
}

/**
 * THE wait: block until `condition` holds on terminal `id` — optionally only
 * once its output has ALSO been quiet for `settledMs`, and optionally stamping
 * the met with the rendered tail of its screen.
 *
 * The one engine {@link awaitAgentState} and {@link awaitOutputSettled} are
 * each a spelling of (and `kolu wait --until match:` calls directly), and the reason the two
 * modifiers exist here rather than in a driving loop above: **a caller outside
 * this process cannot close their races.** The three-call orchestrator loop —
 * wait for the turn to end, then wait for quiet, then read the screen — has a
 * hole between each pair of calls, and output moving in one of them is exactly
 * the case the loop is trying to detect (kolu#2139: a nudge preempted a
 * subagent three minutes into its run, because "the agent's bucket is `waiting`"
 * was read as "the agent is done"). Both modifiers are evaluated against the
 * SAME live subscriptions the condition is:
 *
 *   - **`settledMs` is a CONJUNCT on the condition**, not a second wait after
 *     it. A met needs the condition to hold AND no output byte to have arrived
 *     for `settledMs`; bytes moving (a subagent's footer, a background shell)
 *     keep the wait open, and a condition that stops holding — an agent's bucket
 *     dropping back to `working` — re-enters the wait rather than latching. It
 *     composes with every form: `match:DONE` + `settledMs` means "the sentinel
 *     printed and the terminal then went quiet", which is a stronger and equally
 *     meaningful signal.
 *   - **`captureScreen` is an ENRICHMENT of the payload.** The terminal's
 *     rendered screen is read while the subscriptions are still live and BEFORE
 *     the met settles; if the met CANDIDATE changed while that read was in
 *     flight, the screen it returned is not the screen that settled, so it is
 *     discarded and read again.
 *
 * **What "changed" means is the whole of the stamp's correctness**, and it is
 * narrower than "a byte arrived". The candidate changes when `held` or `quiet`
 * does — nothing else — because those two ARE the met. Bumping the generation on
 * every frame instead looks stricter and is strictly worse: with no conjunct,
 * `quiet` is permanently satisfied and a `match`/`agent` `held` does not fall
 * back, so every frame would invalidate a read that nothing can ever make valid
 * — a chattering terminal would drive one `screen.text` round-trip per discard,
 * for as long as the wait runs, with no fixed point and no backoff. Tying the
 * generation to the candidate makes each retry wait for something that must be
 * re-earned: a window that must re-fire, or a bucket that must re-enter.
 *
 * So the guarantee has two honest halves, and the difference is the caller's:
 *   - **with `settledMs`** the screen is one taken inside the same unbroken
 *     stretch of quiet that met the condition — the property `kolu debrief`
 *     sells, and a second `kolu snapshot` process can never have;
 *   - **without it** the screen is the terminal as of the condition landing.
 *     No quiet was asked for, so none is claimed.
 *
 * One thing is deliberately NOT special-cased: `idle:<n>` with `settledMs` of
 * `m` runs two independent windows and therefore means "quiet for max(n, m)" —
 * which falls out rather than being written. An `agent` condition with no
 * `settledMs` opens no attach feed at all, so the plain agent-state wait costs
 * exactly what it always cost.
 *
 * `retryAdvice` is the actionable tail of the `closed` diagnostic (see
 * {@link watchAttachFeed}) and is required, not defaulted: only the caller knows
 * what the thing to re-run is called, and a wrong-but-plausible default is worse
 * than no sentence. Whether the sentence is ever REACHED depends on the
 * configuration — a bare agent wait opens no feed to lose — the same way a
 * `--timeout` a wait never hits is still required to be a real number.
 *
 * The `screen` is the WHOLE rendered buffer. Bounding it to N lines is the
 * caller's rendering decision (`kolu wait --snapshot N` slices with
 * `@kolu/padi/render`'s `tailLines`), and it is not even a wire saving — this
 * read passes no `startLine`/`endLine`, so the buffer has already crossed the
 * transport before any slice could run.
 */
export async function awaitTerminalCondition<C extends TerminalCondition>(
  client: PadiSurfaceClient,
  opts: {
    readonly id: TerminalId;
    readonly condition: C;
    /** Report met only once output has ALSO been quiet for this long. */
    readonly settledMs?: number;
    /** Stamp the met with the terminal's rendered screen. */
    readonly captureScreen?: boolean;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    /** "retry wait_outputSettled" — the tail of the `closed` sentence. */
    readonly retryAdvice: string;
  },
): Promise<MetOf<C>> {
  const { id, condition, settledMs, captureScreen } = opts;
  if (condition.kind === "idle") requireTimerMs("idleMs", condition.idleMs);
  if (settledMs !== undefined) requireTimerMs("settledMs", settledMs);
  // `runWait` is generic over the met payload and cannot know which ARM this
  // condition dispatches to; the engine does, because each form's `held` is
  // written by exactly one branch below. So the narrowing is asserted ONCE here,
  // inside the module that owns the dispatch, instead of by a runtime
  // check-and-cast in every wrapper (`metFired`, deleted).
  return runWait<ConditionMet>(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    async (ctx) => {
      /**
       * THE MET-CANDIDATE, as one value: the condition's evidence while it holds
       * (`held`), the conjunct (`quiet`), and the GENERATION the pair is on.
       *
       * One cell rather than three `let`s, because the generation exists to say
       * *when* the other two last changed and a counter kept in step by hand at
       * five call sites is the same discipline-not-structure shape it was
       * introduced to replace. {@link update} is the only way any of it moves, so
       * "bump the generation and re-check" is mechanical instead of remembered.
       *
       * Why a generation at all: booleans record *whether*, never *when*. A
       * screen read that outlives its quiescence window sees the window re-arm
       * (`quiet` false) and re-fire (`quiet` true) while the read is in flight,
       * so a boolean re-check passes and a screen from the FIRST quiet stretch
       * is stamped onto a met earned by the SECOND. Comparing generations
       * compares the moments (P1: a value, not a place).
       */
      let candidate: {
        readonly held: ConditionHeld | null;
        readonly quiet: boolean;
        readonly epoch: number;
      } = { held: null, quiet: settledMs === undefined, epoch: 0 };

      /** The conjunct's ground state, spelled once — what `quiet` falls back to
       *  when a feed we can no longer observe invalidates it. */
      const quietGround = settledMs === undefined;

      /** Are these the SAME met-candidate — would they stamp the same met?
       *
       *  Not deep equality of the record: equality of the thing a screen read is
       *  racing. The `terminals` mirror re-publishes a terminal's record for any
       *  awareness refresh (a git poll, a PR check, a foreground sample), and
       *  most of those leave the agent exactly where it was. Treating each as a
       *  candidate CHANGE would invalidate every in-flight read on a busy roster
       *  with nothing to re-earn — the same missing fixed point the per-frame
       *  bump had, reached through the other subscription. */
      const sameCandidate = (
        a: ConditionHeld | null,
        b: ConditionHeld | null,
      ): boolean => {
        if (a === null || b === null) return a === b;
        if (a.fired !== b.fired) return false;
        switch (a.fired) {
          case "idle":
            return true;
          case "match":
            return a.matchedLine === (b as typeof a).matchedLine;
          case "agent": {
            const other = (b as typeof a).agent;
            return a.agent.kind === other.kind && a.agent.state === other.state;
          }
        }
      };

      /** The ONLY way the candidate moves: replace it, bump the generation when
       *  it actually MOVED, and re-check.
       *
       *  A change that can only make the candidate false still bumps — an
       *  in-flight read must be discarded either way. A re-assertion of the same
       *  candidate does not: the freshest evidence is still written (a met
       *  should describe the terminal as it is), but nothing was invalidated, so
       *  nothing is discarded and no read is re-issued. */
      const update = (
        next: Partial<{ held: ConditionHeld | null; quiet: boolean }>,
      ): void => {
        const held = next.held !== undefined ? next.held : candidate.held;
        const quiet = next.quiet !== undefined ? next.quiet : candidate.quiet;
        if (quiet === candidate.quiet && sameCandidate(held, candidate.held)) {
          candidate = { ...candidate, held };
          return;
        }
        candidate = { held, quiet, epoch: candidate.epoch + 1 };
        check();
      };

      /** A screen read is in flight — never two at once. */
      let reading = false;
      /** The tail of the output already scanned by the `match:` form, bounded by
       *  {@link MATCH_OVERLAP_CAP}. The ONLY history the scan keeps. */
      let carry = "";
      /** A read failure that must PROPAGATE rather than become an outcome (a
       *  dead transport poisons the shared connection). Latched, thrown below. */
      let readFailure: unknown;
      /** The in-flight stamp loop, so an unwinding wait never leaves one
       *  dangling. Assigned once per arming (the loop owns its own retries), so
       *  awaiting it once at the foot of the wait is sound. */
      let pendingRead: Promise<void> = Promise.resolve();

      /** Stamp the met. The payload spreads FLAT — `ConditionMet` is
       *  `ConditionHeld & {elapsedMs, screen?}` by construction, so the
       *  three-arm switch this replaced was `(payload) => payload` written as
       *  thirty lines that had to be edited again for every new field. */
      const settleMet = (
        payload: ConditionHeld,
        screen: string | undefined,
      ): void => {
        // The engine's own invariant, checked where it LIVES rather than
        // re-verified by every face that asks for a screen: a met of a wait that
        // asked for one always carries it. A failed read settles `gone`/`closed`
        // instead, so reaching here without a screen is a broken engine — and a
        // `runWait` watcher that throws propagates verbatim.
        if (captureScreen === true && screen === undefined) {
          throw new Error(
            `awaitTerminalCondition: ${id} met with captureScreen set but no screen — the engine's own invariant, not an empty terminal.`,
          );
        }
        ctx.settle({
          kind: "met",
          ...payload,
          elapsedMs: ctx.elapsedMs(),
          ...(screen === undefined ? {} : { screen }),
        });
      };

      /**
       * The screen-stamp loop: read, compare generations, retry while the
       * candidate still holds. ONE promise that owns its own retries, so "at
       * most one read in flight" and "the read is finished before the wait
       * returns" are the same fact rather than three mechanisms (a guard flag, a
       * promise chain, and a self-re-entrant callback) agreeing by accident.
       *
       * The payload is re-read from the candidate AFTER the round-trip rather
       * than captured before it, so the met describes the terminal at the
       * instant it settles — an agent record that moved from `awaiting_user` to
       * `waiting` under the read is reported as what it is now, beside the
       * screen that shows it.
       *
       * It TERMINATES because {@link update} bumps only on a real candidate
       * change, and every such change must be re-earned before the loop's guard
       * passes again: a quiescence window must re-fire, or a bucket must
       * re-enter. See the header for why "bump on every frame" has no fixed
       * point.
       */
      const stampLoop = async (): Promise<void> => {
        try {
          while (
            !ctx.signal.aborted &&
            candidate.held !== null &&
            candidate.quiet
          ) {
            const at = candidate.epoch;
            // `{ signal }` is load-bearing, not hygiene: `runWait`'s timeout
            // SETTLES an outcome and aborts, but does not return until this
            // watcher body resolves — and the body awaits this loop. An unbound
            // read against a wedged-but-alive link would hold the whole wait
            // open past the `--timeout` it promises, the unbounded-tail hazard
            // `settleOnLostFeed`'s membership read binds itself against too.
            const text = await Effect.runPromise(
              client.surface.screen.text({ id }),
              { signal: ctx.signal },
            );
            if (ctx.signal.aborted) return;
            // The candidate moved under the read — this screen is not the screen
            // that settled. Drop it and read the new one.
            if (candidate.epoch !== at) continue;
            if (candidate.held === null) return;
            settleMet(candidate.held, text);
            return;
          }
        } catch (err) {
          if (ctx.signal.aborted) return;
          // The terminal ended between the condition landing and its screen
          // being read — `gone`, the same answer the feeds give, never a
          // retryable `closed`.
          if (isTerminalNotFound(err)) {
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
            return;
          }
          const message = errMessage(err);
          ctx.recordUpstreamError(message);
          // A DEAD transport poisons the shared connection and must PROPAGATE so
          // the MCP face resets it before the next call (see `watchAttachFeed`).
          // The settle is only how the subscriptions are unwound; the latched
          // failure is thrown below and wins over the outcome.
          if (isDeadTransportError(err)) readFailure = err;
          ctx.settle({
            kind: "closed",
            error: `could not read ${id}'s screen at the met — ${message}`,
          });
        } finally {
          reading = false;
        }
      };

      /** Both halves hold — settle, reading the screen first if one was asked
       *  for. Called from {@link update}, and from nowhere else. */
      function check(): void {
        if (ctx.signal.aborted || candidate.held === null || !candidate.quiet) {
          return;
        }
        if (captureScreen !== true) {
          settleMet(candidate.held, undefined);
          return;
        }
        if (reading) return;
        reading = true;
        pendingRead = stampLoop();
      }

      // The `idle:` condition's window and the `--settled` conjunct's window:
      // two independent countdowns over the same frames, each setting its own
      // half. Both are armed by the attach feed's snapshot (an already-quiet
      // terminal fires after its window) and reset by every subsequent frame.
      const conditionWindow =
        condition.kind === "idle"
          ? quietWindow(condition.idleMs, () => {
              update({ held: { fired: "idle" } });
            })
          : undefined;
      const settledWindow =
        settledMs === undefined
          ? undefined
          : quietWindow(settledMs, () => {
              update({ quiet: true });
            });

      const arms: Promise<void>[] = [];

      // The OUTPUT feed — needed by the two output condition FORMS to decide the
      // condition, and by the quiescence conjunct whatever the form. An `agent`
      // condition with no conjunct opens none, so the plain agent-state wait
      // costs exactly what it always cost — and `captureScreen` alone does NOT
      // open one: with no half for a frame to change, a feed would observe bytes
      // that cannot invalidate anything (see the header's fixed-point note).
      if (condition.kind !== "agent" || settledMs !== undefined) {
        arms.push(
          watchAttachFeed(client, ctx, {
            id,
            onFrame: (frame) => {
              // Snapshot AND delta both (re)start a window: the snapshot is the
              // replay of the current screen — the moment to start counting —
              // and each delta is fresh output resetting the count. Each arming
              // goes through `update`, so the generation moves exactly when a
              // half does and never merely because a byte arrived.
              if (conditionWindow !== undefined) {
                update({ held: null });
                conditionWindow.arm();
              }
              if (settledWindow !== undefined) {
                update({ quiet: false });
                settledWindow.arm();
              }
              // A latched match is not re-decided. Scanning on would re-derive
              // `matchedLine` from `carry + data` — a carry frozen at the match
              // and bytes that arrived much later — and splice two non-adjacent
              // stretches of output into a line no terminal ever printed. The
              // sentinel already fired; later output can only break the
              // conjunct, which the window above already handles.
              if (
                condition.kind !== "match" ||
                frame.kind !== "delta" ||
                candidate.held !== null
              ) {
                return;
              }
              const data = frame.data;
              // An empty delta brings no new text: its window would be exactly
              // the carry the previous frame already scanned, for exactly the
              // same verdict. Skipping it keeps "one scan per new byte" true.
              if (data === "") return;
              // The scan window: the new bytes, plus enough already-scanned tail
              // that a sentinel straddling the chunk boundary is still whole.
              const window = carry + data;
              // `search`, not `exec`: it is the one scan that ignores (and
              // restores) a pattern's `lastIndex`, so a `/g`- or `/y`-flagged
              // pattern can't resume mid-window and skip the sentinel — and the
              // caller's RegExp is never mutated. The index is all this needs.
              const index = window.search(condition.pattern);
              if (index !== -1) {
                // A match LATCHES: unlike a bucket, a sentinel that printed
                // cannot un-print, so later output only breaks the conjunct.
                update({
                  held: {
                    fired: "match",
                    matchedLine: matchedLineAt(window, index),
                  },
                });
                return;
              }
              carry = carryTail(window);
            },
            // State accumulated from a feed we can no longer observe is dropped:
            // a window left armed would fire a FALSE quiet across the reconnect
            // gap, and carrying pre-gap bytes into the scan of post-gap ones
            // would let the two halves forge a sentinel nobody printed. A
            // latched `match` survives — it is a fact about output we DID see.
            //
            // This handler NEVER claims quiet. A lost feed is not evidence that
            // the terminal is quiet — it is evidence we cannot SEE it, and the
            // two are opposites. The spine has not discriminated yet when this
            // fires: a feed that ended because the PTY exited (`gone`) and a
            // feed dropped from under a still-running terminal (`closed`) arrive
            // here identically, so claiming quiet would let a LIVE terminal's
            // dropped feed mint a met — a false done-signal, the exact class of
            // lie this whole feature exists to remove. The vacuous-quiet case
            // that IS legitimate rides `onExit`, where the evidence is an
            // observed exit rather than an absence of observation.
            onFeedLost: () => {
              conditionWindow?.disarm();
              settledWindow?.disarm();
              carry = "";
              update({
                ...(conditionWindow !== undefined ? { held: null } : {}),
                quiet: quietGround,
              });
            },
            // The exit settles `gone` for every form EXCEPT `match`, whose bytes
            // may still be in flight on the (separately-ordered) attach feed — a
            // sentinel that printed must win, so there the exit is only LATCHED
            // and the feed's END is the proof no bytes are left. Nothing an
            // early settle could invalidate exists for the other forms.
            ...(condition.kind === "match"
              ? {}
              : {
                  onExit: () =>
                    ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() }),
                }),
            // A PROVEN-gone terminal discharges a `match` wait's conjunct: the
            // ordered feed has ended, so every byte it will ever produce is in,
            // and the process is dead, so none will follow — the strongest
            // possible form of the quiet `--settled` asks for. Claimed ONLY for
            // an already-latched sentinel; a match that never printed leaves
            // `held` null and the `gone` below stands.
            //
            // Without it, `--until match:DONE --settled 500` against the
            // ordinary `echo DONE; exit` shape settles `gone` (exit 3) where the
            // same wait WITHOUT `--settled` settles `met` (exit 0) — a modifier
            // sold as a conjunct silently converting a success into a
            // terminal-died failure that no input could ever satisfy.
            //
            // It hangs off THIS hook and not off `onExit` because the exit event
            // rides its own subscription and can be delivered before the delta
            // carrying the sentinel; and not off `onFeedLost` because that fires
            // before the spine has told `gone` from `closed`, where claiming
            // quiet would let a live terminal's dropped feed mint a met.
            ...(condition.kind === "match"
              ? {
                  onTerminalGone: () => {
                    if (candidate.held !== null) update({ quiet: true });
                  },
                }
              : {}),
            retryAdvice: opts.retryAdvice,
          }),
        );
      }

      // The AGENT feed — the `terminals` mirror, which REPLAYS each terminal's
      // current value on connect, so an agent ALREADY in a target bucket matches
      // immediately rather than hanging for a transition that already happened.
      if (condition.kind === "agent") {
        const targets = condition.targets;
        arms.push(
          watchTerminals(
            client,
            {
              onUpsert: (upserted, value) => {
                if (upserted !== id) return;
                const agent = matchingActiveAgent(value, targets);
                // Both directions: a bucket that STOPS matching re-enters the
                // wait. Without that, `--settled` would be waiting for quiet on
                // an agent that has gone back to work. A record change also
                // invalidates an in-flight screen read — the met it would stamp
                // is a different met — which `update` handles for us.
                update({
                  held: agent === null ? null : { fired: "agent", agent },
                });
              },
              // The terminal we're waiting on left the collection — its PTY
              // exited, so no future frame can carry the target bucket. Resolve
              // gone rather than hanging. Removals of OTHERS are noise.
              onRemove: (removed) => {
                if (removed !== id) return;
                ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
              },
            },
            ctx.signal,
            (line) => ctx.recordUpstreamError(line),
            // Seed the watched id so a terminal that exited BEFORE this
            // subscription (in the gap after the caller resolved the id) is
            // reconciled to gone on the first snapshot instead of hanging.
            () => [id],
          ),
        );
      }

      try {
        await Promise.all(arms);
        // The subscriptions have unwound; a read they started may not have.
        await pendingRead;
      } finally {
        // The scaffold clears ITS timeout; these windows are this wait's own.
        conditionWindow?.disarm();
        settledWindow?.disarm();
      }
      // A dead transport is a BUG-shaped failure, not an outcome: `runWait`
      // propagates a watcher's rejection verbatim, and it wins over the `closed`
      // that was only settled to unwind the subscriptions.
      if (readFailure !== undefined) throw readFailure;
    },
  ) as Promise<MetOf<C>>;
}

// ── The two named waits — one engine, two spellings ─────────────────────────
//
// Each is the engine with one condition and no modifiers. They stay named
// because they are what the other faces call (the MCP face's `wait_agentState` /
// `wait_outputSettled`, padi-tui's `cmdWait`) and because each carries its own
// `closed` retry advice — the sentence naming the thing to re-run.
//
// Neither re-narrows the engine's outcome at runtime: `MetOf<C>` resolves the
// arm statically from the condition literal each passes, so the `metFired`
// helper that used to check-and-cast here — an "impossible unless the dispatch
// broke" guard for a fact the types already carry — is gone.

/** The outcome of an agent-state wait — the shared {@link WaitOutcome} union
 *  with the met payload this wait stamps: the matched agent, plus how long the
 *  wait took. */
export type AgentStateOutcome = WaitOutcome<{
  agent: AgentInfo;
  elapsedMs: number;
}>;

/** Block until one terminal's agent enters a target bucket, then resolve
 *  `met`; or `timeout` after `timeoutMs`, `gone` if the terminal is removed
 *  first (its PTY exited, so the bucket can never land), `interrupted` on
 *  `signal` abort, or `closed` if the link settles without any of those. Pure
 *  data layer (no tty, no `process.exit`) so it is testable over a real
 *  socket — padi-tui's `cmdWait` and the MCP face's `wait_agentState` are the
 *  thin glue mapping the outcome to their own output frames.
 *
 *  The met payload keeps its two fields and does NOT gain the engine's `fired`
 *  tag: it is the MCP tool's documented `met: {agent, elapsedMs}` frame, and a
 *  key added here would land on that wire. A caller that wants the tag calls
 *  {@link awaitTerminalCondition} directly, which `kolu wait` does. */
export async function awaitAgentState(
  client: PadiSurfaceClient,
  opts: {
    id: TerminalId;
    targets: ReadonlySet<string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<AgentStateOutcome> {
  const outcome = await awaitTerminalCondition(client, {
    id: opts.id,
    condition: { kind: "agent", targets: opts.targets } as const,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    retryAdvice: "re-run the agent-state wait",
  });
  // The `fired` tag is dropped rather than passed through — see the note above.
  return outcome.kind === "met"
    ? { kind: "met", agent: outcome.agent, elapsedMs: outcome.elapsedMs }
    : outcome;
}

/** The outcome of an output-settled wait — the shared {@link WaitOutcome} union
 *  with the met payload this wait stamps: the idle signal fired, plus how long
 *  the wait took. */
export type OutputSettledOutcome = WaitOutcome<{
  fired: "idle";
  elapsedMs: number;
}>;

/** Block until terminal `id`'s output has been quiet for `idleMs` — the data
 *  layer of the MCP face's `wait_outputSettled`, exported for the e2e pin. */
export async function awaitOutputSettled(
  client: PadiSurfaceClient,
  opts: {
    id: string;
    idleMs: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<OutputSettledOutcome> {
  return awaitTerminalCondition(client, {
    id: opts.id,
    condition: { kind: "idle", idleMs: opts.idleMs } as const,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    retryAdvice: "retry wait_outputSettled",
  });
}

// There is NO `awaitOutputMatch` wrapper. The `match:` form has exactly one
// consumer — `kolu wait --until match:<regex>` — and that consumer now calls
// {@link awaitTerminalCondition} directly, because it is also the consumer of
// the two modifiers. A named wrapper would be public dial surface with no
// production caller, which is precisely why `agentMatchesUntil` was deleted (see
// {@link matchingActiveAgent}); the MCP face states its own position at
// `kolu-mcp/src/wait.ts` — "v1 is the idle signal only; `match:` stays
// CLI-only" — so there is no second face waiting for one either. The two
// wrappers that DO remain are the two that have callers whose wire shapes depend
// on them.
