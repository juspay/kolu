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
import { Stream } from "effect";
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
import { padiSurface, type PadiTerminal } from "../surface.ts";
import { activeAgent } from "./terminalVocab.ts";

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
} from "./terminalVocab.ts";

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
 *  It rides {@link watchTerminals}, so the mirror REPLAYS each terminal's
 *  current value on connect: an agent ALREADY in a target bucket matches
 *  immediately (no hang waiting for a transition that already happened) — this
 *  is what makes the two-phase `--until working` THEN `--until
 *  awaiting,waiting` loop robust against the stale-state race. The watched id
 *  is SEEDED into the mirror, so a terminal that exited before the
 *  subscription reconciles to `gone` on the first snapshot instead of hanging.
 *  A watcher failure (the mirror rejecting) PROPAGATES per `runWait`'s
 *  contract — a bug is never folded into `closed`. */
export async function awaitAgentState(
  client: PadiSurfaceClient,
  opts: {
    id: TerminalId;
    targets: ReadonlySet<string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<AgentStateOutcome> {
  return runWait<{ agent: AgentInfo; elapsedMs: number }>(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    (ctx) =>
      watchTerminals(
        client,
        {
          onUpsert: (id, value) => {
            if (id !== opts.id) return;
            const agent = matchingActiveAgent(value, opts.targets);
            if (agent !== null) {
              ctx.settle({ kind: "met", agent, elapsedMs: ctx.elapsedMs() });
            }
          },
          // The terminal we're waiting on left the collection — its PTY exited, so
          // no future frame can carry the target bucket. Resolve gone and unwind
          // rather than hanging until the timeout. Removals of OTHERS are noise.
          onRemove: (id) => {
            if (id !== opts.id) return;
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
          },
        },
        ctx.signal,
        (line) => ctx.recordUpstreamError(line),
        // Seed the watched id so a terminal that exited BEFORE this subscription
        // (in the gap after the caller resolved the id) is reconciled to gone on
        // the first snapshot instead of hanging.
        () => [opts.id],
      ),
  );
}

// ── The attach-feed spine (shared by the two OUTPUT waits) ───────────────────

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

/** The outcome of an output-settled wait — the shared {@link WaitOutcome} union
 *  with the met payload this wait stamps: the idle signal fired, plus how long
 *  the wait took. */
export type OutputSettledOutcome = WaitOutcome<{
  fired: "idle";
  elapsedMs: number;
}>;

/** Block until terminal `id`'s output has been quiet for `idleMs` — the data
 *  layer of the MCP face's `wait_outputSettled`, exported for the e2e pin. It
 *  rides {@link watchAttachFeed} (padiSurface's `terminalAttach` +
 *  `terminalExit` + the `terminals` key set for the lost-feed discrimination) —
 *  a non-verbatim twin of kaval-tui's watcher over `ptyHostSurface`, kept local
 *  per the port-not-extract doctrine. Its siblings are {@link awaitAgentState}
 *  and {@link awaitOutputMatch}: all three are 'block on a padiSurface
 *  condition, return a WaitOutcome' primitives, so all three live in the one
 *  package that owns padiSurface. */
export async function awaitOutputSettled(
  client: PadiSurfaceClient,
  opts: {
    id: string;
    idleMs: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<OutputSettledOutcome> {
  // Fail fast at the boundary — this is an EXPORTED primitive (the MCP schema
  // guards its own caller, but a direct caller could pass 0 / non-finite / a
  // value above the setTimeout ceiling, which would fire a FALSE near-instant
  // `met` off an overflowed idle window). The shared timer-range rule, same as
  // `runWait`'s `timeoutMs` guard.
  if (!isValidTimerMs(opts.idleMs)) {
    throw new RangeError(
      `awaitOutputSettled: idleMs must be between 1 and ${MAX_TIMER_MS} (~24.8 days), got ${opts.idleMs} — a larger window overflows setTimeout and fires a false near-instant met.`,
    );
  }
  return runWait<{ fired: "idle"; elapsedMs: number }>(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    async (ctx) => {
      // The idle window: armed by the snapshot (an already-idle terminal fires
      // after idleMs), reset by every subsequent frame. A STREAM_RETRY
      // resubscribe re-delivers a fresh snapshot, which re-arms the window —
      // quiescence across a reconnect gap is unobservable, so the window
      // honestly restarts.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const disarmIdle = (): void => {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
      };
      const armIdle = (): void => {
        disarmIdle();
        idleTimer = setTimeout(
          () =>
            ctx.settle({
              kind: "met",
              fired: "idle",
              elapsedMs: ctx.elapsedMs(),
            }),
          opts.idleMs,
        );
      };

      try {
        await watchAttachFeed(client, ctx, {
          id: opts.id,
          // Snapshot AND delta frames both (re)arm the window — the snapshot is
          // the replay of the current screen (the moment to start the quiet
          // window), each delta is fresh output resetting it.
          onFrame: armIdle,
          onFeedLost: disarmIdle,
          // The PRECISE exit signal settles at once: an exited terminal has no
          // quiescence left to report, so there is nothing an early settle can
          // invalidate (contrast `awaitOutputMatch`, whose bytes can still be in
          // flight).
          onExit: () =>
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() }),
          retryAdvice: "retry wait_outputSettled",
        });
      } finally {
        // The scaffold clears ITS timeout; the idle window is this watcher's own.
        disarmIdle();
      }
    },
  );
}

// ── The `match:` wait ────────────────────────────────────────────────────────

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

/** The outcome of an output-match wait — the shared {@link WaitOutcome} union
 *  with the met payload this wait stamps: that the pattern fired, how long it
 *  took, and the output line it landed on. */
export type OutputMatchOutcome = WaitOutcome<{
  fired: "match";
  elapsedMs: number;
  matchedLine: string;
}>;

/**
 * Block until terminal `id`'s NEW output matches `pattern`, then resolve `met`
 * with the matched line; or `timeout` after `timeoutMs`, `gone` if the terminal
 * exits without printing it, `interrupted` on `signal` abort, or `closed` if the
 * feed is dropped under us. The sentinel/marker route — agent-agnostic, so it
 * works on a bare shell, a `less`, or an agent nobody wrote a state sensor for.
 *
 * The third sibling of {@link awaitAgentState} / {@link awaitOutputSettled}, and
 * here for the same reason they are: it is a 'block on a padiSurface condition,
 * return a WaitOutcome' primitive, so it belongs in the package that owns
 * padiSurface rather than in whichever CLI happened to need it first. It shares
 * the settle wait's whole subscription spine ({@link watchAttachFeed}) — the
 * retry fence above all, without which a transport blip kills the wait instead
 * of re-subscribing.
 *
 * Three things are specific to matching:
 *
 *   - **Only `delta` frames are scanned.** A `snapshot` frame is the replay of
 *     the screen as it ALREADY was, not bytes that arrived since the call —
 *     matching it would report a marker printed minutes ago as if it had just
 *     landed. (Which is also why the fence's re-subscribe must clear the carry:
 *     the fresh snapshot it delivers is likewise old news.)
 *   - **The match beats the exit.** The exit event is latched, never settled
 *     (see {@link watchAttachFeed}) — a sentinel that printed and was followed
 *     by the process exiting is a MET wait, whatever order the two subscriptions
 *     happen to deliver in. The verdict waits for the ordered attach feed to
 *     end, which is what proves no bytes are left to scan.
 *   - **Each delta is scanned ONCE, in a bounded window.** The scan runs over
 *     `carry + delta` — the new bytes plus at most {@link MATCH_OVERLAP_CAP}
 *     code units of already-scanned tail, which is what keeps a sentinel split
 *     across chunks matchable — never over the whole history. This is a
 *     LIVENESS property, not an optimisation: the search is synchronous on the
 *     event loop that also owns this wait's `--timeout` timer, so per-frame work
 *     that grew with the window let a chatty terminal push the timeout past the
 *     deadline it promises.
 *
 * RESIDUAL, named plainly: `match:` is NOT safe against an untrusted
 * pattern+output pair. The scan is bounded in INPUT, not in TIME — a
 * catastrophically-backtracking pattern (`(a+)+$` and friends) against hostile
 * output still blocks the event loop for the duration of one bounded search,
 * which for such a pattern is effectively unbounded, and `--timeout` cannot fire
 * while it runs. The bound removes the multiplier (one scan per delta over ≤ the
 * overlap plus that delta, instead of a whole-window re-scan every frame), not
 * the exponent. The pattern is the CLI user's own text — their foot — while the
 * output is whatever a program in the terminal chose to print, so the safe use
 * is: your own pattern, and one you know is linear. A caller that must accept a
 * pattern from elsewhere needs a non-backtracking engine (RE2), which this
 * package deliberately does not carry.
 */
export async function awaitOutputMatch(
  client: PadiSurfaceClient,
  opts: {
    id: string;
    pattern: RegExp;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<OutputMatchOutcome> {
  return runWait<{ fired: "match"; elapsedMs: number; matchedLine: string }>(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    async (ctx) => {
      // The overlap: the tail of the output already scanned, bounded by
      // MATCH_OVERLAP_CAP. It is the ONLY history kept — each delta is scanned
      // once, prefixed with this, and never re-scanned.
      let carry = "";
      await watchAttachFeed(client, ctx, {
        id: opts.id,
        onFrame: (frame) => {
          if (frame.kind !== "delta") return;
          const data = frame.data;
          // An empty delta brings no new text: its window would be exactly the
          // carry the previous frame already scanned, for exactly the same
          // verdict. Skipping it keeps "one scan per new byte" true.
          if (data === "") return;
          // The scan window: the new bytes, plus enough already-scanned tail
          // that a sentinel straddling the chunk boundary is still whole.
          const window = carry + data;
          // `search`, not `exec`: it is the one scan that ignores (and restores)
          // a pattern's `lastIndex`, so a `/g`- or `/y`-flagged pattern can't
          // resume mid-window and skip the sentinel — and the caller's RegExp is
          // never mutated. The index is all this wait needs.
          const index = window.search(opts.pattern);
          if (index !== -1) {
            ctx.settle({
              kind: "met",
              fired: "match",
              elapsedMs: ctx.elapsedMs(),
              matchedLine: matchedLineAt(window, index),
            });
            return;
          }
          carry = carryTail(window);
        },
        // A reconnect gap is unobservable output: carrying what we saw before it
        // into the scan of what arrives after would let the two halves forge a
        // sentinel no terminal ever printed.
        onFeedLost: () => {
          carry = "";
        },
        retryAdvice: "re-run the match wait",
      });
    },
  );
}
