/**
 * The bounded-wait scaffold — the typed-outcome race every "block until a
 * condition lands on a surface stream" consumer needs, extracted the day its
 * THIRD hand-rolled copy appeared (padi-tui's `awaitAgentState`, kaval-tui's
 * `awaitOutputCondition`, and the kolu MCP face's composite `wait_*` tools —
 * the unification gate the padi note records).
 *
 * The sibling of `first-frame.ts`: a client-side stream-consumption
 * discipline with zero imports — a bounded algorithm leaf, not a volatility
 * receptacle. What it owns is exactly the boilerplate the copies shared:
 *
 *   - the outcome union ({@link WaitOutcome}) — generic ONLY over the `met`
 *     payload; `gone`/`timeout`/`interrupted`/`closed` are one shape all
 *     consumers speak;
 *   - the race lifecycle ({@link runWait}) — abort-chain the caller's signal,
 *     arm the timeout, first-writer-wins settle, unwind every watcher, and
 *     resolve the fallback (a caller abort is `interrupted`; a link that
 *     settled with no outcome is `closed`, carrying the first latched
 *     upstream diagnostic);
 *   - the outcome→JSON projection ({@link waitOutcomeJson}) — the four terminal
 *     arms serialize identically for both structured `--json`/tool faces, so
 *     that vocabulary lives here beside the union; only the per-face `met` shape
 *     is injected.
 *
 * What it deliberately does NOT own: the condition *watchers*. Each consumer's
 * watcher binds its own surface contract (kaval's `ptyHostSurface` attach
 * feed, padi's `terminals` mirror) — non-verbatim twins that stay local, the
 * same port-not-extract doctrine as the attach scaffold.
 *
 * RECORDED FOLLOW-UP (#1865 surface review, finding 3): `ctx.signal` is a raw
 * signal with a doc contract ("thread it into every subscription") — a watcher
 * that forgets both leaks its subscription and hangs `runWait` past settle.
 * The perfection move is inverting the seam to `ctx.subscribe(streamFactory)`
 * so forgetting is unspellable; deferred because today's three consumers also
 * READ `ctx.signal.aborted` to classify expected stream ends (the kaval/padi
 * lost-feed discrimination), which a subscribe-only surface must re-house.
 */

/** Node's `setTimeout` caps its delay at the signed 32-bit max (~24.8 days); a
 *  larger delay does NOT wait longer — it silently CLAMPS to 1ms and fires
 *  almost immediately. So a timeout/idle window above this is rejected loud at
 *  the boundary rather than "succeeding" in a millisecond: a fail-fast guard,
 *  never a silent coercion. */
export const MAX_TIMER_MS = 2_147_483_647;

/** Is `ms` a delay `setTimeout` can honor as written — positive, finite, and
 *  within the 32-bit overflow ceiling? The one home for the timer-range rule
 *  every wait consumer's `--timeout`/idle-window flows through. */
export function isValidTimerMs(ms: number): boolean {
  return Number.isFinite(ms) && ms > 0 && ms <= MAX_TIMER_MS;
}

/** "That window is outside the timer's range", in the ONE wording every face
 *  says it in.
 *
 *  The rule ({@link isValidTimerMs}) and the ceiling ({@link MAX_TIMER_MS}) were
 *  already single-sourced; the SENTENCE was not, and it had drifted three ways —
 *  which is the same defect one layer up, and the one `kolu wait`/`debrief`
 *  already deduped once between themselves.
 *
 *  `effect` names what an out-of-range value would do to THAT flag ("fires a
 *  false timeout", "reports a false settle"), which is the only part that
 *  legitimately differs; `got` is what the user actually typed, rendered by the
 *  caller because only it knows whether that was `60000` or `"99999h"`. */
export function timerRangeMessage(
  flag: string,
  effect: string,
  got: string,
): string {
  return `--${flag} must be between 1 and ${MAX_TIMER_MS} milliseconds (~24.8 days) — a larger value overflows the timer and ${effect} almost immediately, got ${got}.`;
}

/** The met payload's constraint: any object WITHOUT its own `kind`. The
 *  outcome union spreads `Met` flat into the `met` arm (`{ kind: "met" } &
 *  Met` — what keeps kaval-tui's met frame byte-identical), so a payload
 *  carrying `kind` would silently intersect to `never`; `kind?: never` turns
 *  that collision into a NAMED type error at the consumer instead. */
export type WaitMet = object & { kind?: never };

/** The outcome of a bounded wait — the one union all consumers speak, generic
 *  only over the `met` payload each stamps for itself:
 *   - `met` — the condition landed (payload spread flat into the arm);
 *   - `gone` — the watched subject exited, so the condition can never land;
 *   - `timeout` — the wait elapsed its cap;
 *   - `interrupted` — the CALLER's signal aborted the wait (a Ctrl+C, a
 *     cancelled MCP request);
 *   - `closed` — the link settled without any of those (a dropped feed);
 *     `error` carries the first latched upstream diagnostic.
 *  The `interrupted`/`closed` split is decided by {@link runWait} from the
 *  caller's signal, so the outcome alone carries the full result. */
export type WaitOutcome<Met extends WaitMet> =
  | ({ kind: "met" } & Met)
  | { kind: "gone"; elapsedMs: number }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "interrupted" }
  | { kind: "closed"; error?: string };

/** Serialize a {@link WaitOutcome} to the driver-facing JSON frame both
 *  structured wait faces emit (the kolu MCP `wait_*` tools, `kaval-tui wait
 *  --json`) — a uniform `result` discriminant on EVERY outcome, never exit-code
 *  archaeology. The four terminal arms (`timeout`/`gone`/`interrupted`/
 *  `closed`) serialize identically for every consumer, so they live here ONCE
 *  beside the union they mirror; only the `met` arm's per-face shape differs, so
 *  it is the injected `metJson` callback — kolu-mcp nests the payload under
 *  `met`, kaval spreads `fired`/`matchedLine` flat.
 *
 *  Inside the generic, TS intersects the met arm's `{ kind: "met" }` with the
 *  BOUND's `kind?: never` and collapses it to `never`, so the discriminated
 *  switch can't be written on `outcome` directly — the ONE re-spell of the
 *  runtime union (met payload opaque) lives here too, not re-copied per face.
 *  Every CONCRETE Met satisfies WaitMet (no `kind`), so the cast never changes a
 *  real shape. */
export function waitOutcomeJson<Met extends WaitMet>(
  id: string,
  outcome: WaitOutcome<Met>,
  metJson: (met: Met) => Record<string, unknown>,
): Record<string, unknown> {
  const o = outcome as
    | ({ kind: "met" } & Record<string, unknown>)
    | { kind: "gone"; elapsedMs: number }
    | { kind: "timeout"; elapsedMs: number }
    | { kind: "interrupted" }
    | { kind: "closed"; error?: string };
  switch (o.kind) {
    case "met": {
      const { kind: _kind, ...met } = o;
      return { id, result: "met", ...metJson(met as Met) };
    }
    case "timeout":
      return { id, result: "timeout", elapsedMs: o.elapsedMs };
    case "gone":
      return { id, result: "gone", elapsedMs: o.elapsedMs };
    case "interrupted":
      return { id, result: "interrupted" };
    case "closed":
      return {
        id,
        result: "closed",
        ...(o.error !== undefined ? { error: o.error } : {}),
      };
  }
}

/** What {@link runWait} hands its watchers — the settle race, the abort signal
 *  every subscription must chain to, the shared elapsed clock, and the
 *  upstream-error latch feeding the `closed` fallback. */
export interface WaitCtx<Met extends WaitMet> {
  /** First-writer-wins: the first settle fixes the outcome and aborts
   *  {@link WaitCtx.signal} so every sibling watcher unwinds. */
  settle(outcome: WaitOutcome<Met>): void;
  /** Aborted the instant anything settles (or the caller's signal fires) —
   *  thread it into every stream subscription the watchers open. */
  readonly signal: AbortSignal;
  /** Milliseconds since the wait started — for stamping met/gone outcomes. */
  elapsedMs(): number;
  /** Latch a diagnostic for the `closed` fallback (first one wins) — a
   *  dropped-link reason, a protocol error. Recording is NOT settling. */
  recordUpstreamError(line: string): void;
}

/**
 * Run a bounded wait: chain the caller's signal, arm the timeout, run the
 * consumer's `watchers` until they unwind, then resolve the settled outcome —
 * or the fallback: `interrupted` when the CALLER's signal aborted,
 * else `closed` carrying the first latched upstream error.
 *
 * `watchers` receives the {@link WaitCtx} and must resolve once its
 * subscriptions have unwound (they end when `ctx.signal` aborts). A watcher
 * that THROWS/rejects is a BUG, not an outcome: the rejection PROPAGATES out
 * of `runWait` verbatim — it is never folded into `closed`, which is reserved
 * for the link settling without an outcome. (An expected end — the feed
 * dropping, the subject exiting — is the watcher's to catch and `settle`.)
 *
 * `timeoutMs` must satisfy {@link isValidTimerMs} when present — an
 * over-ceiling timeout would overflow `setTimeout` and fire a FALSE timeout
 * in ~1ms, so it throws loud instead.
 */
export async function runWait<Met extends WaitMet>(
  opts: { timeoutMs?: number; signal?: AbortSignal },
  watchers: (ctx: WaitCtx<Met>) => Promise<void>,
): Promise<WaitOutcome<Met>> {
  if (opts.timeoutMs !== undefined && !isValidTimerMs(opts.timeoutMs)) {
    throw new RangeError(
      `runWait: timeoutMs must be between 1 and ${MAX_TIMER_MS} (~24.8 days) — a larger delay overflows setTimeout and fires a false timeout almost immediately, got ${opts.timeoutMs}.`,
    );
  }
  const start = Date.now();
  const elapsedMs = (): number => Date.now() - start;

  const abort = new AbortController();
  // Chain the caller's signal (a Ctrl+C, a cancelled request) into the
  // internal abort so an interrupt unwinds every watcher the same way a
  // settle does. The listener's lifetime is bound to the INTERNAL controller
  // (`{ signal: abort.signal }`), which the `finally` below always aborts —
  // so it is removed on EVERY arm. `{ once: true }` alone would remove it
  // only when the caller's signal fires, i.e. never on the common
  // met/gone/timeout/closed arms, accumulating one dangling listener per
  // wait on a long-lived shared signal — the exact leak class this leaf
  // exists to prevent.
  if (opts.signal !== undefined) {
    if (opts.signal.aborted) abort.abort();
    else
      opts.signal.addEventListener("abort", () => abort.abort(), {
        signal: abort.signal,
      });
  }

  let outcome: WaitOutcome<Met> | undefined;
  let upstreamError: string | undefined;
  // First-writer-wins: the timeout timer and every watcher race to set the
  // outcome; `??=` keeps the first and the abort stops the rest.
  const settle = (o: WaitOutcome<Met>): void => {
    outcome ??= o;
    abort.abort();
  };

  const timer =
    opts.timeoutMs === undefined
      ? undefined
      : setTimeout(
          () => settle({ kind: "timeout", elapsedMs: elapsedMs() }),
          opts.timeoutMs,
        );

  try {
    await watchers({
      settle,
      signal: abort.signal,
      elapsedMs,
      recordUpstreamError: (line) => {
        upstreamError ??= line;
      },
    });
  } finally {
    // `clearTimeout(undefined)` is a documented no-op. The trailing abort
    // unwinds any subscription still chained to ctx.signal — the no-outcome
    // (link settled) and watcher-rejection paths reach here without one.
    clearTimeout(timer);
    abort.abort();
  }

  // A settled outcome is the normal result. The fallback covers watchers that
  // unwound without one: a caller abort is `interrupted`; anything else is a
  // dropped link — `closed`, with the first latched diagnostic.
  return (
    outcome ??
    (opts.signal?.aborted
      ? { kind: "interrupted" }
      : { kind: "closed", error: upstreamError })
  );
}
