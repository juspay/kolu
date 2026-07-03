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
 *     upstream respawn: when this spawn's stream ends or its link blips, rebind
 *     to the NEXT live client and keep the downstream stream alive; the only exit
 *     is the downstream unsubscribing. Replaying a value is harmless, so a hiccup
 *     must not tear the browser's subscription down. (This is pulam-web's
 *     `forwardInputStream`, recovered into the shared stack.)
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

import { isAbortReason, iterateUntilAborted } from "@kolu/surface/server";
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
 *  as a `get(input, { signal }) => Promise<AsyncIterable<F>>`. Narrower than the
 *  full oRPC client so a relay can be handed `(client) => client.surface.attach`
 *  directly without re-spelling the whole surface type. */
export interface ForwardableStream<I, F> {
  get(input: I, opts: { signal?: AbortSignal }): Promise<AsyncIterable<F>>;
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
   *  Omit for a stream whose own first frame is already a fresh snapshot. */
  lead?: F;
}

/**
 * Relay an input-keyed VALUE stream, HELD OPEN across upstream respawns — the impl
 * behind the type-guarded {@link relayHoldOpenStream}, also called directly by the
 * re-serve assembly (which routes by runtime policy). Takes a bare `member` label;
 * the value/delta COMPILE guard lives on the public wrapper, not here.
 *
 * Yields `lead` (if given) on each bind, then forwards the current live client's
 * `select(client).get(input)` frames until that stream ends or its link blips — at
 * which point it does NOT complete the downstream stream but waits (via the
 * holder's `whenChanged`) for the next spawn and rebinds. The ONLY exit is the
 * downstream aborting (unsubscribe). Replaying a value across a hiccup is harmless,
 * so the downstream never sees the upstream drop.
 *
 * KNOWN LIMITATION (#1661 candidate 3a — deferred to W2.2): "did the live client
 * change?" is the sole proxy for "did the link die?". A value stream that ENDS or
 * REJECTS for a PER-INPUT reason (e.g. a bad input) while the SAME client stays
 * live leaves `holder.current === client`, so `whenChanged` never fires and the
 * downstream parks silently until the next respawn. Latent today — padi's value
 * streams (subscribeRepoChange / subscribeFileChange) only wire through here at
 * W2.2, where the recovery semantics (surface-the-error vs re-subscribe) and the
 * link-death race are ratified (pinned as a W2.2 done-criterion in the padi note).
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
    while (!aborted()) {
      const client = holder.current;
      if (client === null) {
        // No live upstream (pre-handshake, or between a drop and the next
        // spawn). HOLD — don't complete the downstream — and wake on the next
        // `.current` change.
        log(`${member}: no live client — holding for next spawn`);
        try {
          await holder.whenChanged(signal);
        } catch (err) {
          // `whenChanged` rejects only on abort (the downstream unsubscribed) →
          // clean return; a non-abort rejection must surface, not be swallowed —
          // matching the sibling `failThroughStreamCore`. (#1661 candidate 3a.)
          if (isAbortReason(err, signal)) return;
          throw err;
        }
        continue;
      }
      if (opts.lead !== undefined) yield opts.lead;
      try {
        for await (const frame of await select(client).get(input, { signal })) {
          yield frame;
        }
        log(`${member}: upstream stream ended — awaiting next spawn`);
      } catch (err) {
        if (aborted()) return;
        log(
          `${member}: upstream link blip — awaiting next spawn: ${(err as Error).message}`,
        );
      }
      // Don't busy-loop back onto the SAME just-dead client: wait for the pump to
      // swap in the next one before rebinding. (A clear to `null` needs no test
      // here — the loop head's `client === null` branch awaits `whenChanged`.)
      if (holder.current === client) {
        try {
          await holder.whenChanged(signal);
        } catch (err) {
          if (isAbortReason(err, signal)) return; // downstream unsubscribed
          throw err;
        }
      }
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

/** Raised when a fail-through stream is subscribed while no upstream is live.
 *  Ending the downstream loudly (rather than a healthy-but-empty stream) is what
 *  makes the client's retry re-subscribe once the link is back — a snapshot only
 *  ever leads a FRESH stream. */
export class NoLiveUpstreamError extends Error {
  constructor(member: string) {
    super(
      `relayFailThroughStream: "${member}" subscribed with no live upstream link — downstream ends so the client re-subscribes end-to-end`,
    );
    this.name = "NoLiveUpstreamError";
  }
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
    const client = holder.current;
    if (client === null) {
      // No live upstream at subscribe — end (loudly) so the client re-subscribes
      // once the link is back, never a healthy-but-empty byte stream.
      log(`${member}: no live client at subscribe — ending downstream`);
      throw new NoLiveUpstreamError(member);
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
      log(
        `${member}: upstream link died — ending downstream: ${(err as Error).message}`,
      );
      throw err;
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
