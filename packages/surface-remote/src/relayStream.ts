/**
 * Per-member stream relay — the two ways a re-serving parent forwards ONE
 * input-keyed stream of a mirrored surface downstream, chosen by the member's
 * declared **forwarding policy** (`value` vs `delta`).
 *
 * A parent that re-serves a remote agent's surface (kolu-server fronting padi;
 * drishti fronting its agent) folds VALUE members (cells, collections, pulses)
 * into local stores and forwards each PROCEDURE through the live client. But a
 * member that carries an INPUT (a per-repo watcher, a per-terminal byte stream)
 * can't be folded with one fixed subscription up front — the parent doesn't know
 * the inputs — so it opens one upstream subscription *per downstream subscriber*.
 * How that per-subscriber stream survives (or doesn't) an upstream link drop is
 * the whole game:
 *
 *   - {@link relayHoldOpenStream} — the **value** path. HOLD OPEN across an
 *     upstream respawn: when this spawn's link BLIPS (the upstream stream fails
 *     mid-chain), rebind to the NEXT live client and keep the downstream stream
 *     alive — replaying a value is harmless, so a hiccup must not tear the
 *     browser's subscription down. A CLEAN upstream end is different: it means the
 *     source finished THIS input on purpose (a one-shot event, a value stream that
 *     completed) while the link is live, so it SURFACES downstream rather than
 *     parking for a respawn that isn't coming (#1661 candidate 3a). The other exit
 *     is the downstream unsubscribing. (This is the retired pulam-web's
 *     `forwardInputStream`, recovered into the shared stack.)
 *
 *   - {@link relayFailThroughStream} — the **delta** path. FAIL THROUGH: forward
 *     the current live client's stream 1:1, propagating its end AND its error, and
 *     NEVER rebind. An upstream link death ends the downstream stream too, so the
 *     client's own end-to-end retry re-subscribes and a scrollback/liveness
 *     snapshot only ever arrives as the FIRST frame of a FRESH stream. Holding a
 *     byte stream open and splicing a replayed snapshot into a live xterm would
 *     corrupt the screen — the retired pulam-web's hold-open forwarder was *exactly
 *     wrong* for attach, and this is its correction. A subscribe WHILE no client is
 *     live WAITS for the next spawn (same as hold-open's pre-connect arm) rather
 *     than failing a retryable end every second — the 1s STREAM_RETRY loop was
 *     logging a bare stack frame for the entire remote-provisioning window (#1963).
 *
 * The split is guarded at the type level for DIRECT callers: {@link
 * relayHoldOpenStream} accepts only a {@link ValueMembers} key and {@link
 * relayFailThroughStream} only a {@link DeltaMembers} key of the same policy, so
 * "hold open a byte stream" is a compile error at such a call site (pinned by
 * `relayStream.test`'s `_typeGuards`). The re-serve ASSEMBLY (`reServeSurface`)
 * instead routes by reading `policy[member]` at RUNTIME — its member keys come
 * from `Object.keys(spec.*)` as `string`, with no literal to guard on — so its
 * enforcement is the runtime `requirePolicy` plus W1's set-equality contract test
 * pinning which members are `delta` (padi's `PADI_FORWARDING_POLICY`). W2.1
 * graduates the machinery; W1 shipped that classification.
 *
 * **Effect note (PLAN D10).** Both relays are now `Stream`-valued and carry NO
 * `AbortSignal`: a downstream unsubscribe is fiber INTERRUPTION, which propagates
 * into the upstream subscription and into the rebind wait through their own
 * finalizers. Every `return` the old async generators used for "the downstream
 * walked away" has no counterpart to write — interruption is not an outcome the
 * relay reports, it is the absence of one.
 */

import {
  isTransportError,
  type StreamingProcedure,
} from "@kolu/surface/client";
import {
  isDeadTransportError,
  isSurfaceRelayTransportLost,
  SurfaceRelayTransportLost,
} from "@kolu/surface/errors";
import type { UpstreamSource } from "@kolu/surface/project";
import { Effect, Stream } from "effect";
import type { ObservableHolder } from "./hostFanout";

// ── The forwarding policy (surface-generic) ────────────────────────────────

/** The forwarding policy for a surface's input-keyed STREAMING members: each
 *  stream / event is `"value"` (hold-open, replayable across an upstream respawn)
 *  or `"delta"` (fail-through byte stream). This is the streaming-SURVIVAL axis —
 *  cells and collections are always folded as values and procedures always
 *  forwarded, so only streams and events carry a real hold-open-vs-fail-through
 *  choice. A surface's authored policy (e.g. padi's `PADI_FORWARDING_POLICY`,
 *  `... as const satisfies Record<string, ForwardingPolicy>`) structurally
 *  satisfies this, so the re-serve helpers read the SAME classification W1 pinned
 *  — no second declaration to drift. */
export type RelayPolicy = Record<string, "value" | "delta">;

/** The member keys a policy `P` declares `"value"` (hold-open). Deriving the two
 *  member sets from the literal policy is what lets {@link relayHoldOpenStream} /
 *  {@link relayFailThroughStream} reject the wrong member at compile time. */
export type ValueMembers<P extends RelayPolicy> = {
  [K in keyof P]: P[K] extends "value" ? K : never;
}[keyof P] &
  string;

/** The member keys a policy `P` declares `"delta"` (fail-through). */
export type DeltaMembers<P extends RelayPolicy> = {
  [K in keyof P]: P[K] extends "delta" ? K : never;
}[keyof P] &
  string;

// ── The forwardable-stream shape a client exposes per member ──────────────

/** The slice of a live client one member's relay reads: `client.surface.<member>`
 *  — an object whose `.get` is an {@link UpstreamSource} (`(input) => Stream<F>`,
 *  the same client-stream shape `@kolu/surface`'s projection helpers consume).
 *  Narrower than the full surface face so a relay can be handed
 *  `(client) => client.surface.attach` directly; typing `.get` as `UpstreamSource`
 *  reuses that one signature rather than re-spelling it. */
export interface ForwardableStream<I, F> {
  get: UpstreamSource<I, F>;
}

/** What a relay HANDS BACK per member: the surface's own client-stream shape, so
 *  a re-serve can graft it straight onto `StreamImplDeps.source`. */
export type RelayedStream<I, F> = StreamingProcedure<I, F>;

/** Shared options for both relays — a diagnostic sink, default no-op. */
export interface RelayStreamOptions {
  log?: (line: string) => void;
}

// ── relayHoldOpenStream — the VALUE path (hold open across respawns) ────────

export interface RelayHoldOpenOptions<F> extends RelayStreamOptions {
  /** An optional lead frame emitted at the start of each (re)bind — a synthetic
   *  first pulse that makes the downstream requery the current state on subscribe
   *  AND after a reconnect (the fs may have changed while the link was down).
   *  Omit for a stream whose own first frame is already a fresh snapshot.
   *
   *  BOXED as `{ frame: F }` so PRESENCE (the box exists) is disjoint from the
   *  frame's own VALUE: a stream whose frame type `F` itself includes `undefined`
   *  (a `void`/`undefined`-framed value stream) can emit an `undefined` lead by
   *  passing `lead: { frame: undefined }`, and a `!== undefined` box-presence
   *  check still tells it apart from `lead` omitted entirely. The old bare
   *  `lead?: F` collided the two — an `undefined` lead frame read as "no lead". */
  lead?: { frame: F };
}

/** Await the next live client, holding while `.current` is `null`. A plain
 *  EFFECT loop rather than stream recursion, so a link that flaps to `null` and
 *  back any number of times before a spawn lands costs no nesting. Interrupting
 *  the consuming fiber detaches the waiter (see `ObservableHolder.changed`) —
 *  that is the whole of the old `waitForHolderChange`'s abort arm. */
function awaitLiveClient<Cl>(
  holder: ObservableHolder<Cl>,
  onWait: () => void,
): Effect.Effect<Cl> {
  return Effect.gen(function* () {
    if (holder.current !== null) return holder.current;
    onWait();
    let client = holder.current;
    while (client === null) {
      yield* holder.changed;
      client = holder.current;
    }
    return client;
  });
}

/** Resolve a live client's member stream for relaying, or throw a LOUD structural
 *  mismatch. A live client that doesn't expose the member (a version-skewed agent, a
 *  policy/spec drift, a wiring bug) is NOT a middle-hop transport loss — resolving it
 *  BEFORE the upstream subscription keeps the resulting error out of the transport-loss
 *  catch, which would otherwise see a `TypeError` from the relay's own `undefined.get`
 *  property lookup, classify it as transport loss (any untagged throw), and wrap it as
 *  the RETRYABLE relay end — retried forever behind a misleading "link died" log
 *  instead of failing loud. Thrown inside the relay's own effect it becomes a DEFECT
 *  (D4: an undeclared throw is a defect), which the downstream fence never retries, so
 *  a genuine structural bug surfaces as a failure — mirroring the fail-loud member
 *  checks the cell/procedure forward paths already do. */
function requireUpstream<Cl, I, F>(
  select: (client: Cl) => ForwardableStream<I, F>,
  client: Cl,
  member: string,
): ForwardableStream<I, F> {
  const stream = select(client);
  if (!stream || typeof stream.get !== "function") {
    throw new Error(
      `relayStream: live client exposes no "${member}" stream member to relay — structural client/surface mismatch, not a transport loss`,
    );
  }
  return stream;
}

/**
 * Relay an input-keyed VALUE stream, HELD OPEN across upstream respawns — the impl
 * behind the type-guarded {@link relayHoldOpenStream}, also called directly by the
 * re-serve assembly (which routes by runtime policy). Takes a bare `member` label;
 * the value/delta COMPILE guard lives on the public wrapper, not here.
 *
 * Yields `lead` (if given) on each bind, then forwards the current live client's
 * `select(client).get(input)` frames. How the upstream's TERMINATION is handled
 * splits by KIND, which is the candidate-3a resolution (W2.2):
 *
 *   - a **FAILURE** (the transport failed mid-stream — a LINK blip): do NOT complete
 *     the downstream; wait (via the holder's `changed`) for the next spawn and
 *     REBIND. Replaying a value across a hiccup is harmless, so the browser's
 *     subscription survives an upstream respawn.
 *   - a **clean END** (the upstream stream completed WITHOUT failing): the SOURCE
 *     ended THIS input's stream on purpose (`terminalExit` is a `value`-classified
 *     event that yields once then closes) or any value stream that legitimately
 *     finishes — while the link stays live. A transport death never arrives as a
 *     clean end (it fails), so a clean end is UNAMBIGUOUSLY a per-input completion,
 *     NOT a link death — no race. SURFACE it: end the downstream (exactly as the
 *     fail-through path does) so the client's own STREAM_RETRY re-subscribes
 *     end-to-end if it wants more.
 *
 * This retires candidate-3a's park: previously a clean end while `holder.current
 * === client` fell through to a wait that fires only on a client change, so a
 * one-shot completion hung the downstream forever. The clean-end/failure split
 * needs no `holder.current` liveness probe — the termination KIND carries the
 * distinction — so the link-death race the note flagged doesn't arise. The ONLY
 * other exit is the downstream unsubscribing (fiber interruption).
 *
 * A per-input FAILURE while the link stays live (a source that fails for a bad
 * input) is not reachable for padi's current value members — the pulse sources
 * (`subscribeRepoChange` / `subscribeFileChange`) never fail (their `pollOnEvent`
 * read is total and ends only on interruption), and `terminalExit` yields-then-ends
 * — so it would be classed as a link blip (held) today; a future one that needs
 * surfacing would report its per-input failure as a clean end.
 *
 * The returned stream's failure channel is `never`: every upstream failure is
 * absorbed into a rebind, so the only ways it terminates are a clean upstream end
 * and interruption.
 */
export function holdOpenStreamCore<Cl, I, F>(
  member: string,
  holder: ObservableHolder<Cl>,
  select: (client: Cl) => ForwardableStream<I, F>,
  opts: RelayHoldOpenOptions<F> = {},
): (input: I) => Stream.Stream<F, never> {
  const log = opts.log ?? ((): void => {});
  return (input) => {
    const bind = (): Stream.Stream<F, never> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* awaitLiveClient(holder, () =>
            // No live upstream (pre-handshake, or between a drop and the next
            // spawn). HOLD — don't complete the downstream — and wake on the
            // next `.current` change.
            log(`${member}: no live client — holding for next spawn`),
          );
          // Resolve the member OUTSIDE the forwarding stream — a client that
          // doesn't expose it is a structural mismatch that must fail loud (a
          // defect), not be caught below as a "link blip" and held open forever
          // waiting for a rebind that can never fix a missing member.
          const upstream = requireUpstream(select, client, member);
          const forwarded = upstream.get(input).pipe(
            // Clean end: the source completed THIS input's stream on purpose (a
            // one-shot that fired, a value stream that finished) while the link
            // is live — a transport death FAILS, it never ends cleanly. Waiting
            // for a client CHANGE would hang the downstream forever, so SURFACE
            // the completion and let the client re-subscribe end-to-end if it
            // wants more (#1661 candidate 3a, resolved).
            Stream.onEnd(
              Effect.sync(() =>
                log(
                  `${member}: upstream stream ended (per-input completion) — ending`,
                ),
              ),
            ),
            // A FAILURE is a LINK blip — the pump will swap in the next spawn.
            // HOLD OPEN: don't complete the downstream; rebind below. (Only the
            // typed failure channel is caught: interruption is not a failure, so
            // a torn-down subscription never rebinds.)
            Stream.catch((err: unknown) =>
              Stream.unwrap(
                Effect.gen(function* () {
                  log(
                    `${member}: upstream link blip — awaiting next spawn: ${errorText(err)}`,
                  );
                  // Don't busy-loop back onto the SAME just-dead client: wait for
                  // the pump to swap in the next one before rebinding. (A clear to
                  // `null` needs no test here — `awaitLiveClient` holds on it.)
                  if (holder.current === client) yield* holder.changed;
                  return bind();
                }),
              ),
            ),
          );
          // Box-PRESENCE, not frame-value: `opts.lead` is a `{ frame }` box (or
          // absent), so this emits a lead whose frame is legitimately `undefined`
          // (a void-framed stream) instead of swallowing it as omission.
          return opts.lead !== undefined
            ? Stream.concat(Stream.make(opts.lead.frame), forwarded)
            : forwarded;
        }),
      );
    return Stream.suspend(bind);
  };
}

/**
 * Relay an input-keyed VALUE stream, HELD OPEN across upstream respawns —
 * {@link holdOpenStreamCore} behind the value-policy compile guard. `member` is
 * constrained to a `"value"` key of `policy`; passing a `"delta"` member is a
 * COMPILE error — a byte stream can't be held open here.
 */
export function relayHoldOpenStream<P extends RelayPolicy, Cl, I, F>(
  policy: P,
  member: ValueMembers<P>,
  holder: ObservableHolder<Cl>,
  select: (client: Cl) => ForwardableStream<I, F>,
  opts: RelayHoldOpenOptions<F> = {},
): (input: I) => Stream.Stream<F, never> {
  // Defence in depth behind the type bound: an `as`-cast caller can't smuggle a
  // delta member through and get it silently held open — fail loud instead.
  if (policy[member] !== "value") {
    throw new Error(
      `relayHoldOpenStream: member "${member}" is not declared "value" — a fail-through member cannot be held open`,
    );
  }
  return holdOpenStreamCore(member, holder, select, opts);
}

// ── relayFailThroughStream — the DELTA path (end downstream on upstream drop) ─

/** The NAMED, RETRYABLE transport end a fail-through relay ends its downstream
 *  with on a mid-stream UPSTREAM link death (SR5 — one protocol across the wire).
 *  Pre-spawn (no live upstream) waits for the next spawn instead of failing
 *  (#1963). Ending the downstream LOUDLY (rather than a healthy-but-empty stream)
 *  is what makes the client's retry re-subscribe once the link is back, so a
 *  snapshot only ever leads a FRESH stream.
 *
 *  It IS the framework's {@link SurfaceRelayTransportLost} — the ONE tag the shared
 *  retry fence (`shouldRetryStreamError`, `@kolu/surface/client`) treats as
 *  RETRYABLE. Subclassing rather than re-declaring is what makes it survive the
 *  relay hop: both ends were built from the SAME schema, so it serializes,
 *  deserializes and RE-serializes with its `_tag` and `reason` intact and the
 *  browser's per-subscription fence re-subscribes end-to-end. A RAW re-fail of the
 *  upstream error would cross as an unrecognised (hence non-retryable) failure and
 *  STRAND the downstream — the bug this named end fixes. The upstream error is
 *  carried on `cause`, which does NOT cross the wire (it is diagnosis for THIS
 *  process's logs; `reason` is the part both ends read). */
export class RelayTransportLostError extends SurfaceRelayTransportLost {
  constructor(member: string, cause?: unknown) {
    super({
      reason: `relayFailThroughStream: "${member}" lost its upstream link mid-stream — downstream ends (retryable) so the client re-subscribes end-to-end`,
    });
    this.name = "RelayTransportLostError";
    this.cause = cause;
  }
}

/** Render an unknown failure for a log line / a `reason` field. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Whether a caught upstream failure is a genuine MIDDLE-HOP transport loss — the
 *  parent's link to the agent died — as opposed to an APPLICATION error the agent's
 *  handler deliberately raised. Only the former becomes the retryable {@link
 *  RelayTransportLostError}; a DECLARED (D4) tagged error must surface UNCHANGED so
 *  it crosses with its `_tag` preserved and stays NON-retryable — otherwise the
 *  downstream retry fence would retry a permanent failure forever (e.g. attaching to
 *  a terminal that is genuinely gone).
 *
 *  Transport loss is: an already-named relay end (a nested re-serve), a
 *  permanently-dead transport tag the link fails with, Effect RPC's own
 *  `RpcClientError`, or an UNTAGGED failure — the exact successor of the oRPC-era
 *  "not an `ORPCError`" arm, which read a raw transport/network rejection the client
 *  never turned into an application error. A tagged failure that is none of the
 *  three transport tags is, by construction, something a schema DECLARED. */
function isMiddleHopTransportLoss(err: unknown): boolean {
  if (isSurfaceRelayTransportLost(err)) return true;
  if (isDeadTransportError(err)) return true;
  if (isTransportError(err)) return true;
  return !isTaggedFailure(err);
}

/** Does this failure carry a schema `_tag` — i.e. did SOMEONE declare it? */
function isTaggedFailure(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { readonly _tag?: unknown })._tag === "string"
  );
}

/**
 * Relay an input-keyed DELTA (byte / liveness) stream, FAILING THROUGH — the impl
 * behind the type-guarded {@link relayFailThroughStream}.
 *
 * Forwards the current live client's `select(client).get(input)` frames 1:1 —
 * propagating the upstream's clean end (e.g. a PTY exit) AND its failure (a
 * mid-chain link death) straight to the downstream — and NEVER rebinds to a later
 * spawn. So an upstream drop ends the downstream stream, the client's end-to-end
 * retry re-subscribes, and a scrollback/liveness snapshot only ever arrives as the
 * FIRST frame of a FRESH stream. Splicing a replayed snapshot into a live xterm is
 * thus unrepresentable, not merely discouraged.
 */
export function failThroughStreamCore<Cl, I, F>(
  member: string,
  holder: ObservableHolder<Cl>,
  select: (client: Cl) => ForwardableStream<I, F>,
  opts: RelayStreamOptions = {},
): (input: I) => Stream.Stream<F, unknown> {
  const log = opts.log ?? ((): void => {});
  // Rate-limit the "waiting for spawn" diagnostic: many delta members subscribe
  // at once when a host is added, and each would otherwise emit the same line.
  // ONE human-meaningful line per member per episode is enough (#1963) — reset
  // after bind so a re-provision hours later still logs once.
  let loggedWaiting = false;
  return (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Wait for a live upstream when none is present yet (provisioning /
        // between respawns). FAILING here used to force the browser's 1s
        // STREAM_RETRY loop, and the server logged each failure with a bare
        // stack frame for the whole multi-minute building window (#1963).
        // Waiting is the same pre-connect arm hold-open already uses: the
        // stream produces no frames until a spawn lands, then fails through 1:1
        // from there. Mid-stream link death still ends the downstream with the
        // NAMED RETRYABLE end below.
        const client = yield* awaitLiveClient(holder, () => {
          if (loggedWaiting) return;
          loggedWaiting = true;
          log(
            `${member}: no live upstream yet — waiting for spawn (expected while provisioning)`,
          );
        });
        // Bound: the next wait (a re-provision after a later drop) logs once again.
        loggedWaiting = false;
        // Resolve the member OUTSIDE the forwarding stream — a missing member is a
        // structural mismatch that must fail loud (a defect), never fall into the
        // transport-loss catch below.
        const upstream = requireUpstream(select, client, member);
        return upstream.get(input).pipe(
          Stream.onEnd(
            Effect.sync(() =>
              log(`${member}: upstream stream ended — ending downstream`),
            ),
          ),
          Stream.catch((err: unknown) => {
            // An APPLICATION error the agent deliberately raised (a declared,
            // tagged failure) is NOT a middle-hop transport loss — surface it
            // UNCHANGED so it crosses with its `_tag` preserved and stays
            // NON-retryable, never retried forever by the downstream fence.
            if (!isMiddleHopTransportLoss(err)) {
              log(
                `${member}: upstream application error — surfacing unchanged: ${errorText(err)}`,
              );
              return Stream.fail(err);
            }
            // A genuine mid-stream transport death. End the downstream with the
            // NAMED RETRYABLE transport end (carrying the raw upstream error as
            // `cause`), NOT a raw re-fail: a raw failure crosses as an
            // unrecognised — hence non-retryable — error, which would STRAND the
            // downstream instead of re-subscribing it end-to-end.
            log(
              `${member}: upstream link died — ending downstream: ${errorText(err)}`,
            );
            return Stream.fail(new RelayTransportLostError(member, err));
          }),
        );
      }),
    );
}

/**
 * Relay an input-keyed DELTA (byte / liveness) stream, FAILING THROUGH —
 * {@link failThroughStreamCore} behind the delta-policy compile guard. `member`
 * is constrained to a `"delta"` key of `policy`; passing a `"value"` member is a
 * COMPILE error.
 */
export function relayFailThroughStream<P extends RelayPolicy, Cl, I, F>(
  policy: P,
  member: DeltaMembers<P>,
  holder: ObservableHolder<Cl>,
  select: (client: Cl) => ForwardableStream<I, F>,
  opts: RelayStreamOptions = {},
): (input: I) => Stream.Stream<F, unknown> {
  if (policy[member] !== "delta") {
    throw new Error(
      `relayFailThroughStream: member "${member}" is not declared "delta" — a value member must be held open, not failed through`,
    );
  }
  return failThroughStreamCore(member, holder, select, opts);
}
