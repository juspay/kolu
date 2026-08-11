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
// `./tail.ts`, NOT `./render.ts` — the tail slice is a zero-import leaf, while
// `render.ts` pulls `columnify` in for the roster table. See that file's header.
import { tailLines } from "./tail.ts";

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

// The three named waits — `awaitAgentState` · `awaitOutputSettled` ·
// `awaitOutputMatch` — live at the FOOT of this file now, beside the one engine
// they are each a spelling of ({@link awaitTerminalCondition}). This module
// reads spine → engine → the named waits.

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
 * ({@link awaitOutputMatch}) landed beside {@link awaitOutputSettled}: the two
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
 *   - {@link awaitOutputMatch} passes NO `onExit`, so the exit is only LATCHED:
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
     *  observe: a fence re-subscribe, or the feed dropping for good. */
    readonly onFeedLost: () => void;
    /** What an OBSERVED `terminalExit` does beyond latching it (see above). */
    readonly onExit?: () => void;
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
type ConditionHeld =
  | { readonly fired: "idle" }
  | { readonly fired: "match"; readonly matchedLine: string }
  | { readonly fired: "agent"; readonly agent: AgentInfo };

/** What a met carries: which form fired, how long the wait took, that form's own
 *  evidence — and, when `screenTail` was asked for, `screen`.
 *
 *  `screen` is optional in the TYPE and NOT optional in fact: it is present on
 *  every met of a wait that asked for it, because a read that fails settles a
 *  failing arm instead of a met without it (a met missing the screen its caller
 *  asked for is exactly the collapse-to-empty this repo treats as a defect).
 *  TypeScript cannot tie a payload field to an argument's presence, so the
 *  guarantee is the implementation's and is stated here. */
export type ConditionMet =
  | { fired: "idle"; elapsedMs: number; screen?: string }
  | { fired: "match"; elapsedMs: number; matchedLine: string; screen?: string }
  | { fired: "agent"; elapsedMs: number; agent: AgentInfo; screen?: string };

/** The outcome of a {@link awaitTerminalCondition} — the shared
 *  {@link WaitOutcome} union over {@link ConditionMet}. */
export type TerminalConditionOutcome = WaitOutcome<ConditionMet>;

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
 * The one engine {@link awaitAgentState} / {@link awaitOutputSettled} /
 * {@link awaitOutputMatch} are each a spelling of, and the reason the two
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
 *   - **`screenTail` is an ENRICHMENT of the payload.** The rendered tail is
 *     read while the subscriptions are still live and BEFORE the met settles;
 *     if any byte arrives — or the condition stops holding, or a quiescence
 *     window re-arms and re-fires — while that read is in flight, the screen it
 *     returned is not the screen that settled, so it is DISCARDED and the wait
 *     resumes. So the screen on a met is one taken during the same unbroken
 *     stretch of quiet that met the condition. That is the property a second
 *     `kolu snapshot` process can never have. Asking for it therefore OPENS the
 *     output feed even for an `agent` condition with no conjunct: without a feed
 *     "a byte arrived" is unobservable, and a guarantee a layer cannot see is
 *     not one it may promise.
 *
 * One thing is deliberately NOT special-cased: `idle:<n>` with `settledMs` of
 * `m` runs two independent windows and therefore means "quiet for max(n, m)" —
 * which falls out rather than being written. An `agent` condition with NEITHER
 * modifier opens no attach feed at all, so the plain agent-state wait costs
 * exactly what it always cost.
 *
 * `retryAdvice` is the actionable tail of the `closed` diagnostic (see
 * {@link watchAttachFeed}) and is required, not defaulted: only the caller knows
 * what the thing to re-run is called, and a wrong-but-plausible default is worse
 * than no sentence. Whether the sentence is ever REACHED depends on the
 * configuration — a bare agent wait opens no feed to lose — the same way a
 * `--timeout` a wait never hits is still required to be a real number.
 */
export async function awaitTerminalCondition(
  client: PadiSurfaceClient,
  opts: {
    readonly id: TerminalId;
    readonly condition: TerminalCondition;
    /** Report met only once output has ALSO been quiet for this long. */
    readonly settledMs?: number;
    /** Stamp the met with this many rendered screen lines. */
    readonly screenTail?: number;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    /** "retry wait_outputSettled" — the tail of the `closed` sentence. */
    readonly retryAdvice: string;
  },
): Promise<TerminalConditionOutcome> {
  const { id, condition, settledMs, screenTail } = opts;
  if (condition.kind === "idle") requireTimerMs("idleMs", condition.idleMs);
  if (settledMs !== undefined) requireTimerMs("settledMs", settledMs);
  if (
    screenTail !== undefined &&
    (!Number.isInteger(screenTail) || screenTail <= 0)
  ) {
    throw new RangeError(
      `screenTail must be a positive whole number of lines, got ${screenTail} — "the last zero lines" would stamp a met with an empty screen that reads like a dead terminal.`,
    );
  }

  return runWait<ConditionMet>(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    async (ctx) => {
      /** The condition's evidence while it holds, else `null`. */
      let held: ConditionHeld | null = null;
      /** The conjunct. Trivially satisfied when no `settledMs` was asked for. */
      let quiet = settledMs === undefined;
      /**
       * The EPOCH of the current met-candidate — bumped by every event that
       * makes an in-flight screen read stale: a byte arriving, a window
       * re-arming, a bucket changing, a feed lost.
       *
       * A boolean re-read of `held`/`quiet` after the read is NOT enough, and
       * that is the subtle version of the bug this whole feature exists to fix.
       * Booleans record *whether*, never *when*: a screen read that outlives its
       * quiescence window sees the window re-arm (`quiet = false`) and re-fire
       * (`quiet = true`) while the read is still in flight, so both cells read
       * `true` again at resolution and a screen taken during the FIRST quiet
       * stretch is stamped onto a met earned by the SECOND — the terminal moved
       * under it and nothing noticed. Comparing a monotone counter compares the
       * moments, not the flags (P1: a value, not a place).
       */
      let epoch = 0;
      /** A screen read is in flight — never two at once. */
      let reading = false;
      /** The tail of the output already scanned by the `match:` form, bounded by
       *  {@link MATCH_OVERLAP_CAP}. The ONLY history the scan keeps. */
      let carry = "";
      /** A read failure that must PROPAGATE rather than become an outcome (a
       *  dead transport poisons the shared connection). Latched, thrown below. */
      let readFailure: unknown;
      /** The in-flight read, so an unwinding wait never leaves one dangling. */
      let pendingRead: Promise<void> = Promise.resolve();

      const settleMet = (
        payload: ConditionHeld,
        screen: string | undefined,
      ): void => {
        const elapsedMs = ctx.elapsedMs();
        const stamp = screen === undefined ? {} : { screen };
        switch (payload.fired) {
          case "idle":
            ctx.settle({ kind: "met", fired: "idle", elapsedMs, ...stamp });
            return;
          case "match":
            ctx.settle({
              kind: "met",
              fired: "match",
              elapsedMs,
              matchedLine: payload.matchedLine,
              ...stamp,
            });
            return;
          case "agent":
            ctx.settle({
              kind: "met",
              fired: "agent",
              elapsedMs,
              agent: payload.agent,
              ...stamp,
            });
            return;
        }
      };

      /** Read the screen for a met that is otherwise ready, then RE-CHECK: a
       *  byte that arrived (or a bucket that dropped) while the read was in
       *  flight means the screen we hold is not the screen that settled, so it
       *  is discarded and the wait resumes.
       *
       *  The payload is re-read from `held` AFTER the round-trip rather than
       *  captured before it, so the met describes the terminal at the instant it
       *  settles — an agent record that moved from `awaiting_user` to `waiting`
       *  under the read is reported as what it is now, beside the screen that
       *  shows it. */
      const stampAndSettle = async (tail: number): Promise<void> => {
        const at = epoch;
        try {
          // `{ signal }` is load-bearing, not hygiene: `runWait`'s timeout
          // SETTLES an outcome and aborts, but does not return until this
          // watcher body resolves — and the body awaits this read. An
          // unbound read against a wedged-but-alive link would therefore hold
          // the whole wait open past the `--timeout` it promises, which is the
          // unbounded-tail hazard `settleOnLostFeed`'s membership read binds
          // itself against for the same reason.
          const text = await Effect.runPromise(
            client.surface.screen.text({ id }),
            { signal: ctx.signal },
          );
          if (ctx.signal.aborted) return;
          // Same epoch ⇒ nothing invalidated the candidate while the read was in
          // flight, so this screen IS the screen that settled.
          if (epoch !== at || held === null || !quiet) return;
          settleMet(held, tailLines(text, tail));
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
       *  for. Called from every handler that can change either half. */
      const check = (): void => {
        if (ctx.signal.aborted || held === null || !quiet || reading) return;
        if (screenTail === undefined) {
          settleMet(held, undefined);
          return;
        }
        reading = true;
        // Chained rather than fired-and-forgotten: the watchers below await it,
        // so a wait that unwinds never leaves a read (or its failure) dangling.
        // A discarded read leaves `reading` false and re-enters through `check`,
        // which only proceeds if BOTH halves hold again — so this cannot spin.
        pendingRead = pendingRead
          .then(() => stampAndSettle(screenTail))
          .then(() => {
            check();
          });
      };

      // The `idle:` condition's window and the `--settled` conjunct's window:
      // two independent countdowns over the same frames, each setting its own
      // half. Both are armed by the attach feed's snapshot (an already-quiet
      // terminal fires after its window) and reset by every subsequent frame.
      const conditionWindow =
        condition.kind === "idle"
          ? quietWindow(condition.idleMs, () => {
              held = { fired: "idle" };
              epoch += 1;
              check();
            })
          : undefined;
      const settledWindow =
        settledMs === undefined
          ? undefined
          : quietWindow(settledMs, () => {
              quiet = true;
              epoch += 1;
              check();
            });

      const arms: Promise<void>[] = [];

      // The OUTPUT feed. Two output condition forms need it to decide the
      // CONDITION; the quiescence conjunct needs it whatever the form; and
      // `screenTail` needs it to know a byte arrived while its read was in
      // flight — without a feed that half of the discard is unobservable, so a
      // bare `--until <buckets> --snapshot N` would stamp a screen the terminal
      // had moved under. An `agent` condition with NEITHER modifier opens none,
      // so the plain agent-state wait costs exactly what it always cost.
      if (
        condition.kind !== "agent" ||
        settledMs !== undefined ||
        screenTail !== undefined
      ) {
        arms.push(
          watchAttachFeed(client, ctx, {
            id,
            onFrame: (frame) => {
              // Any frame invalidates an in-flight screen read: bytes moved.
              epoch += 1;
              // Snapshot AND delta both (re)start a window: the snapshot is the
              // replay of the current screen — the moment to start counting —
              // and each delta is fresh output resetting the count.
              if (conditionWindow !== undefined) {
                held = null;
                conditionWindow.arm();
              }
              if (settledWindow !== undefined) {
                quiet = false;
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
                held !== null
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
                held = {
                  fired: "match",
                  matchedLine: matchedLineAt(window, index),
                };
                check();
                return;
              }
              carry = carryTail(window);
            },
            // State accumulated from a feed we can no longer observe is dropped:
            // a window left armed would fire a FALSE quiet across the reconnect
            // gap, and carrying pre-gap bytes into the scan of post-gap ones
            // would let the two halves forge a sentinel nobody printed. A
            // latched `match` survives — it is a fact about output we DID see.
            onFeedLost: () => {
              epoch += 1;
              conditionWindow?.disarm();
              settledWindow?.disarm();
              if (condition.kind === "idle") held = null;
              quiet = settledMs === undefined;
              carry = "";
            },
            // The exit settles `gone` for every form EXCEPT `match`, whose bytes
            // may still be in flight on the (separately-ordered) attach feed — a
            // sentinel that printed must win, so there the exit is only latched
            // and the feed's END is the proof no bytes are left. Nothing an
            // early settle could invalidate exists for the other forms.
            ...(condition.kind === "match"
              ? {}
              : {
                  onExit: () =>
                    ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() }),
                }),
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
                // an agent that has gone back to work.
                held = agent === null ? null : { fired: "agent", agent };
                // A record change invalidates an in-flight screen read the same
                // way a byte does: the met it would stamp is a different met.
                epoch += 1;
                check();
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
  );
}

// ── The three named waits — one engine, three spellings ─────────────────────
//
// Each is the engine with one condition and no modifiers. They stay named
// because they are what the other faces call (the MCP face's `wait_agentState` /
// `wait_outputSettled`, padi-tui's `cmdWait`) and because each carries its own
// `closed` retry advice — the sentence naming the thing to re-run.

/** The engine's outcome, narrowed to the ONE met arm a given condition can
 *  fire — the wrappers' shared step.
 *
 *  A wrapper KNOWS which arm its condition produces, and this is where that
 *  knowledge is checked rather than asserted: a dispatch that ever fired the
 *  wrong arm would otherwise hand a caller a payload of a shape its type
 *  promises it cannot have, silently. The cast is contained here, behind the
 *  check that makes it true. */
function metFired<F extends ConditionMet["fired"]>(
  outcome: TerminalConditionOutcome,
  fired: F,
  wait: string,
): WaitOutcome<Extract<ConditionMet, { fired: F }>> {
  if (outcome.kind === "met" && outcome.fired !== fired) {
    throw new Error(
      `${wait}: a ${fired} condition fired "${outcome.fired}" — impossible unless the engine's condition dispatch broke.`,
    );
  }
  return outcome as WaitOutcome<Extract<ConditionMet, { fired: F }>>;
}

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
  const outcome = metFired(
    await awaitTerminalCondition(client, {
      id: opts.id,
      condition: { kind: "agent", targets: opts.targets },
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      retryAdvice: "re-run the agent-state wait",
    }),
    "agent",
    "awaitAgentState",
  );
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
  return metFired(
    await awaitTerminalCondition(client, {
      id: opts.id,
      condition: { kind: "idle", idleMs: opts.idleMs },
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      retryAdvice: "retry wait_outputSettled",
    }),
    "idle",
    "awaitOutputSettled",
  );
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
