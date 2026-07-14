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
 *     upstream respawn: when this spawn's link BLIPS (the upstream stream rejects
 *     mid-chain), rebind to the NEXT live client and keep the downstream stream
 *     alive — replaying a value is harmless, so a hiccup must not tear the
 *     browser's subscription down. A CLEAN upstream end is different: it means the
 *     source finished THIS input on purpose (a one-shot event, a value stream that
 *     completed) while the link is live, so it SURFACES downstream rather than
 *     parking for a respawn that isn't coming (#1661 candidate 3a). The other exit
 *     is the downstream unsubscribing. (This is pulam-web's `forwardInputStream`,
 *     recovered into the shared stack.)
 *
 *   - {@link relayFailThroughStream} — the **delta** path. FAIL THROUGH: forward
 *     the current live client's stream 1:1, propagating its end AND its error,
 *     and NEVER rebind. An upstream link death ends the downstream stream too, so
 *     the client's own end-to-end retry re-subscribes and a scrollback/liveness
 *     snapshot only ever arrives as the FIRST frame of a FRESH stream. Holding a
 *     byte stream open and splicing a replayed snapshot into a live xterm would
 *     corrupt the screen — pulam-web's hold-open forwarder was *exactly wrong*
 *     for attach, and this is its correction.
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
 */

import {
  isDeadTransportError,
  SURFACE_RELAY_TRANSPORT_LOST,
} from "@kolu/surface/client";
import type { UpstreamSource } from "@kolu/surface/project";
import { isAbortReason, iterateUntilAborted } from "@kolu/surface/server";
import { ORPCError } from "@orpc/client";
import type { LiveSpawnHolder, ObservableHolder } from "./hostFanout";

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
 *  — an object whose `.get` is a {@link UpstreamSource} (`(input, { signal }) =>
 *  Promise<AsyncIterable<F>>`, the same client-stream shape `@kolu/surface`'s
 *  projection helpers consume). Narrower than the full oRPC client so a relay can
 *  be handed `(client) => client.surface.attach` directly; typing `.get` as
 *  `UpstreamSource` reuses that one signature rather than re-spelling it. */
export interface ForwardableStream<I, F> {
  get: UpstreamSource<I, F>;
}

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
 *   - a **non-abort ERROR** (the transport rejected mid-stream — a LINK blip):
 *     do NOT complete the downstream; wait (via the holder's `whenChanged`) for
 *     the next spawn and REBIND. Replaying a value across a hiccup is harmless,
 *     so the browser's subscription survives an upstream respawn.
 *   - a **clean END** (the `for await` completed WITHOUT throwing): the SOURCE
 *     ended THIS input's stream on purpose — a one-shot that fired (`terminalExit`
 *     is a `value`-classified event that yields once then closes) or any value
 *     stream that legitimately finishes — while the link stays live. A transport
 *     death never arrives as a clean end (it rejects), so a clean end is
 *     UNAMBIGUOUSLY a per-input completion, NOT a link death — no race. SURFACE
 *     it: end the downstream (exactly as the fail-through path does) so the
 *     client's own STREAM_RETRY re-subscribes end-to-end if it wants more.
 *
 * This retires candidate-3a's park: previously a clean end while `holder.current
 * === client` fell through to `whenChanged` (which fires only on a client change),
 * so a one-shot completion hung the downstream forever. The clean-end/error split
 * needs no `holder.current` liveness probe — the termination KIND carries the
 * distinction — so the link-death race the note flagged doesn't arise. The ONLY
 * other exit is the downstream aborting (unsubscribe).
 *
 * A per-input REJECT while the link stays live (a source that throws for a bad
 * input) is not reachable for padi's current value members — the pulse sources
 * (`subscribeRepoChange` / `subscribeFileChange`) never reject (their `pollOnEvent`
 * read is total and ends only on abort), and `terminalExit` yields-then-returns —
 * so it would be classed as a link blip (held) today; a future one that needs
 * surfacing would report its per-input failure as a clean end.
 */
export function holdOpenStreamCore<Cl, I, F>(
  member: string,
  holder: ObservableHolder<Cl>,
  select: (client: Cl) => ForwardableStream<I, F>,
  opts: RelayHoldOpenOptions<F> = {},
): (input: I, signal: AbortSignal | undefined) => AsyncGenerator<F> {
  const log = opts.log ?? (() => {});
  return async function* (input, signal) {
    const aborted = (): boolean => signal?.aborted === true;
    // Wait for the pump to (re)set the live client. Returns `true` when it changed
    // (rebind), `false` on a downstream abort (the ONLY thing `whenChanged` rejects
    // with — a non-abort rejection must surface, not be swallowed, matching the
    // sibling `failThroughStreamCore`; #1661 candidate 3a). A generator can't
    // `return` from a helper, so callers do `if (!(await waitNextSpawn())) return`.
    const waitNextSpawn = async (): Promise<boolean> => {
      try {
        await holder.whenChanged(signal);
        return true;
      } catch (err) {
        if (isAbortReason(err, signal)) return false;
        throw err;
      }
    };
    while (!aborted()) {
      const client = holder.current;
      if (client === null) {
        // No live upstream (pre-handshake, or between a drop and the next
        // spawn). HOLD — don't complete the downstream — and wake on the next
        // `.current` change.
        log(`${member}: no live client — holding for next spawn`);
        if (!(await waitNextSpawn())) return;
        continue;
      }
      // Box-PRESENCE, not frame-value: `opts.lead` is a `{ frame }` box (or
      // absent), so this yields a lead whose frame is legitimately `undefined`
      // (a void-framed stream) instead of swallowing it as omission.
      if (opts.lead !== undefined) yield opts.lead.frame;
      try {
        for await (const frame of await select(client).get(input, { signal })) {
          yield frame;
        }
        // Clean end: the source completed THIS input's stream on purpose (a
        // one-shot that fired, a value stream that finished) while the link is
        // live — a transport death rejects, it never ends cleanly. Parking on
        // `whenChanged` (which fires only on a client CHANGE) would hang the
        // downstream forever, so SURFACE the completion — end the downstream and
        // let the client re-subscribe end-to-end if it wants more (#1661
        // candidate 3a, resolved).
        log(`${member}: upstream stream ended (per-input completion) — ending`);
        return;
      } catch (err) {
        if (aborted()) return;
        // A non-abort error is a LINK blip — the pump will swap in the next
        // spawn. HOLD OPEN: don't complete the downstream; rebind below.
        log(
          `${member}: upstream link blip — awaiting next spawn: ${(err as Error).message}`,
        );
      }
      // Don't busy-loop back onto the SAME just-dead client: wait for the pump to
      // swap in the next one before rebinding. (A clear to `null` needs no test
      // here — the loop head's `client === null` branch awaits `whenChanged`.)
      if (holder.current === client && !(await waitNextSpawn())) return;
    }
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
): (input: I, signal: AbortSignal | undefined) => AsyncGenerator<F> {
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
 *  with when its UPSTREAM link to the agent is lost — either subscribed while no
 *  upstream is live, or a mid-stream link death (SR5 — one protocol across the
 *  wire). Ending the downstream LOUDLY (rather than a healthy-but-empty stream)
 *  is what makes the client's retry re-subscribe once the link is back, so a
 *  snapshot only ever leads a FRESH stream.
 *
 *  It is an `ORPCError` with the {@link SURFACE_RELAY_TRANSPORT_LOST} code — the
 *  ONE code the shared retry fence (`shouldNotRetryORPCError`, `@kolu/surface`)
 *  treats as RETRYABLE — so it crosses oRPC with its code PRESERVED (not sanitized
 *  to a generic non-retriable `INTERNAL_SERVER_ERROR`) and the browser's
 *  `STREAM_RETRY` re-subscribes end-to-end. A RAW re-throw of the upstream error
 *  would cross as a NON-retriable error and STRAND the downstream — the bug this
 *  named end fixes. The upstream error, when there is one, is carried on `cause`. */
export class RelayTransportLostError extends ORPCError<
  typeof SURFACE_RELAY_TRANSPORT_LOST,
  unknown
> {
  constructor(
    member: string,
    reason: "no-live-upstream" | "link-died",
    cause?: unknown,
  ) {
    super(SURFACE_RELAY_TRANSPORT_LOST, {
      message:
        reason === "no-live-upstream"
          ? `relayFailThroughStream: "${member}" subscribed with no live upstream link — downstream ends (retryable) so the client re-subscribes end-to-end`
          : `relayFailThroughStream: "${member}" lost its upstream link mid-stream — downstream ends (retryable) so the client re-subscribes end-to-end`,
      cause,
    });
    this.name = "RelayTransportLostError";
  }
}

/** Whether a caught upstream rejection is a genuine MIDDLE-HOP transport loss —
 *  the parent's link to the agent died — as opposed to an APPLICATION error the
 *  agent's handler deliberately raised. Only the former becomes the retryable
 *  {@link RelayTransportLostError}; an application `ORPCError` (`NOT_FOUND`,
 *  `BAD_REQUEST`, an authorization failure, …) must surface UNCHANGED so it crosses
 *  oRPC with its code preserved and stays NON-retryable — otherwise the downstream
 *  retry fence would retry a permanent failure forever (e.g. attaching to a
 *  terminal that is genuinely gone). Transport loss is: an already-named relay end
 *  (a nested re-serve), a permanently-dead transport code the link rejects with, or
 *  a non-`ORPCError` (a raw transport/network reject the client never turned into an
 *  application error). */
function isMiddleHopTransportLoss(err: unknown): boolean {
  // An already-named relay end (a nested re-serve), or a permanently-dead transport
  // code the link rejects with (recognized by `@kolu/surface`'s `isDeadTransportError`,
  // the single home for that code set). A non-`ORPCError` is a raw transport/network
  // reject the client never turned into an application error — also transport-level.
  if (err instanceof RelayTransportLostError) return true;
  if (!(err instanceof ORPCError)) return true;
  return isDeadTransportError(err);
}

/**
 * Relay an input-keyed DELTA (byte / liveness) stream, FAILING THROUGH.
 *
 * Forwards the current live client's `select(client).get(input)` frames 1:1 —
 * propagating the upstream's clean end (e.g. a PTY exit) AND its error (a
 * mid-chain link death) straight to the downstream — and NEVER rebinds to a
 * later spawn. So an upstream drop ends the downstream stream, the client's
 * end-to-end retry re-subscribes, and a scrollback/liveness snapshot only ever
 * arrives as the FIRST frame of a FRESH stream. Splicing a replayed snapshot
 * into a live xterm is thus unrepresentable, not merely discouraged.
 *
 * `member` is constrained to a `"delta"` key of `policy`: passing a `"value"`
 * member is a COMPILE error.
 */
export function failThroughStreamCore<Cl, I, F>(
  member: string,
  holder: LiveSpawnHolder<Cl>,
  select: (client: Cl) => ForwardableStream<I, F>,
  opts: RelayStreamOptions = {},
): (input: I, signal: AbortSignal | undefined) => AsyncGenerator<F> {
  const log = opts.log ?? (() => {});
  return async function* (input, signal) {
    // Already-aborted subscribe — the downstream unsubscribed before the first
    // pull. Clean return, NOT a `RelayTransportLostError`: an abort is teardown, not a
    // dead-link condition, so surfacing an error to a client that already walked
    // away would be spurious (the sibling `holdOpenStreamCore`'s `while (!aborted())`
    // head returns the same way, and the subscribe-handshake abort below is already
    // swallowed via `isAbortReason` — #1661 candidate 10). Checked BEFORE
    // `holder.current` so a teardown racing an upstream drop can't throw.
    if (signal?.aborted === true) return;
    const client = holder.current;
    if (client === null) {
      // No live upstream at subscribe — end (loudly, as the NAMED RETRYABLE
      // transport end) so the client re-subscribes once the link is back, never a
      // healthy-but-empty byte stream.
      log(`${member}: no live client at subscribe — ending downstream`);
      throw new RelayTransportLostError(member, "no-live-upstream");
    }
    // Straight through: forward the upstream 1:1. `iterateUntilAborted` swallows
    // only the downstream-abort rejection; a clean end completes the loop and an
    // UPSTREAM error re-throws here → the downstream iterator rejects → the
    // client's STREAM_RETRY re-subscribes end-to-end. We do NOT catch that error
    // (which would strand the client on a silently-dead stream) and we do NOT
    // rebind (the hold-open anti-pattern that corrupts a live terminal).
    try {
      // The subscribe handshake is INSIDE the try: an abort during `get(...)` (the
      // downstream unsubscribed before the first frame) rejects with the signal's
      // reason, which `isAbortReason` below turns into a clean return — not a throw
      // that would surface a spurious error to the client (#1661 candidate 10).
      const upstream = await select(client).get(input, { signal });
      for await (const frame of iterateUntilAborted(upstream, signal)) {
        yield frame;
      }
      log(`${member}: upstream stream ended — ending downstream`);
    } catch (err) {
      if (isAbortReason(err, signal)) return;
      // An APPLICATION error the agent deliberately raised (NOT_FOUND, BAD_REQUEST,
      // an auth failure, …) is NOT a middle-hop transport loss — surface it UNCHANGED
      // so it crosses oRPC with its code preserved and stays NON-retriable, never
      // retried forever by the downstream fence.
      if (!isMiddleHopTransportLoss(err)) {
        log(
          `${member}: upstream application error — surfacing unchanged: ${(err as Error).message}`,
        );
        throw err;
      }
      // A genuine mid-stream transport death. End the downstream with the NAMED
      // RETRYABLE transport end (carrying the raw upstream error as `cause`), NOT a
      // raw re-throw: a raw error crosses oRPC sanitized to a NON-retriable
      // `INTERNAL_SERVER_ERROR`, which would STRAND the downstream instead of
      // re-subscribing it end-to-end.
      log(
        `${member}: upstream link died — ending downstream: ${(err as Error).message}`,
      );
      throw new RelayTransportLostError(member, "link-died", err);
    }
  };
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
  holder: LiveSpawnHolder<Cl>,
  select: (client: Cl) => ForwardableStream<I, F>,
  opts: RelayStreamOptions = {},
): (input: I, signal: AbortSignal | undefined) => AsyncGenerator<F> {
  if (policy[member] !== "delta") {
    throw new Error(
      `relayFailThroughStream: member "${member}" is not declared "delta" — a value member must be held open, not failed through`,
    );
  }
  return failThroughStreamCore(member, holder, select, opts);
}
