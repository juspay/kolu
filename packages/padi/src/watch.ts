/**
 * The client-side terminal WATCH kit — follow padi's `terminals` collection
 * live, block until one terminal's agent enters a target bucket, and block
 * until one terminal's output has been quiet for a window. Part of the dial kit
 * (re-exported through `@kolu/padi/dial`): a daemon's package owns the client
 * helpers its consumers share.
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
import { isWatchSubscriptionNotFound } from "./errors.ts";
import { Effect, Stream } from "effect";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  runWait,
  type WaitOutcome,
} from "@kolu/surface/wait";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiSurfaceClient } from "./dial.ts";
import {
  activeAgent,
  padiSurface,
  type PadiSettleEvent,
  type PadiTerminal,
} from "./surface.ts";

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

/** The coarse agent buckets a wait accepts as targets — the `agentBucket`
 *  fold's vocabulary minus `other` (an `other` bucket never matches a real
 *  agent, so accepting it would only ever time out). A wait compares against
 *  the *bucket*, never the raw `AgentInfo['state']` literals, so the one fold
 *  in `@kolu/terminal-vocab/agentProjection` stays the single source of truth
 *  (see `.claude/rules/dock-fleet-mirror.md`). */
export const WAIT_STATES = [
  "working",
  "awaiting",
  "waiting",
] as const satisfies readonly Exclude<
  ReturnType<typeof agentBucket>,
  "other"
>[];

export type WaitState = (typeof WAIT_STATES)[number];

/** The live agent of a record IF it is in one of the target buckets, else
 *  `null` — the wait's match payload. A record with no live agent (a bare
 *  shell, a sleeping/parked terminal, or an agent that exited) never matches;
 *  otherwise its `state` folds through the shared `agentBucket` and is tested
 *  for membership. Returns the matched agent (not a bare boolean) so a caller
 *  that needs it for the `met` outcome doesn't re-resolve `activeAgent` a second
 *  time — one narrowing, one source of truth. */
export function matchingActiveAgent(
  v: PadiTerminal,
  targets: ReadonlySet<string>,
): AgentInfo | null {
  const agent = activeAgent(v);
  return agent !== null && targets.has(agentBucket(agent.state)) ? agent : null;
}

/** Whether a terminal's agent is in one of the target buckets — the wait
 *  predicate, spelled over {@link matchingActiveAgent} so the narrowing lives
 *  once. */
export function agentMatchesUntil(
  v: PadiTerminal,
  targets: ReadonlySet<string>,
): boolean {
  return matchingActiveAgent(v, targets) !== null;
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

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

/** The outcome of an output-settled wait — the shared {@link WaitOutcome} union
 *  with the met payload this wait stamps: the idle signal fired, plus how long
 *  the wait took. */
export type OutputSettledOutcome = WaitOutcome<{
  fired: "idle";
  elapsedMs: number;
}>;

/** Block until terminal `id`'s output has been quiet for `idleMs` — the data
 *  layer of the MCP face's `wait_outputSettled`, exported for the e2e pin. The
 *  watcher binds padiSurface's members (`terminalAttach` + `terminalExit` + the
 *  `terminals` key set for the lost-feed discrimination) — a non-verbatim twin
 *  of kaval-tui's watcher over `ptyHostSurface`, kept local per the
 *  port-not-extract doctrine. Its sibling is {@link awaitAgentState}: both are
 *  'block on a padiSurface condition, return a WaitOutcome' primitives, so both
 *  live in the one package that owns padiSurface. */
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

      let feedError: string | undefined;

      // The output feed ended before any outcome and without an abort we caused.
      // Same discrimination as kaval-tui's wait: the terminal exited (its id has
      // left the `terminals` key set → `gone`), or the feed was dropped while
      // the PTY is still live (→ `closed`, loud). The idle timer is DISARMED
      // first — leaving it armed would fire a FALSE `met` off the last frame of
      // a feed we can no longer observe.
      const settleOnLostFeed = async (): Promise<void> => {
        disarmIdle();
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
            `the daemon ended ${opts.id}'s output feed while its terminal is still live — retry wait_outputSettled.`,
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
              // DISARM on resubscribe: a STREAM_RETRY reconnect (retryDelay
              // ~1000ms) can exceed idleMs (e.g. 800), so an idle window armed
              // by the LAST pre-drop frame would otherwise fire a FALSE `met`
              // during the reconnect gap — declaring the turn settled off a feed
              // we lost. Clearing it here means the window only ever restarts
              // from the fresh snapshot the reconnect delivers (quiescence
              // across an unobservable gap is not quiescence). The fence's
              // per-subscription `onRetry` tap (S3/#8) is where this now rides —
              // same guarantee, and it still has per-attempt identity.
              onRetry: disarmIdle,
            },
          );
          // Snapshot AND delta frames both (re)arm the window — the snapshot is
          // the replay of the current screen (the moment to start the quiet
          // window), each delta is fresh output resetting it.
          for await (const _frame of iterateUntilAborted(stream, ctx.signal))
            armIdle();
          if (!ctx.signal.aborted) await settleOnLostFeed();
        } catch (err) {
          // An abort (the window fired, a timeout, a cancelled request) is the
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
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
            return;
          }
        } catch {
          // Losing the exit event is NOT fatal: a real exit also ends the
          // terminalAttach feed → settleOnLostFeed → gone (consumeOutput is the
          // backstop). An abort is likewise the expected end. Mirrors kaval-tui's
          // consumeExit non-recording rationale.
        }
      };

      try {
        await Promise.all([consumeOutput(), consumeExit()]);
      } finally {
        // The scaffold clears ITS timeout; the idle window is this watcher's own.
        disarmIdle();
      }
    },
  );
}
