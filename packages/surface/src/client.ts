/**
 * Client-side streaming helpers — the FACE's per-subscription retry fence and
 * the one-shot escape hatch that applies it.
 *
 * `unenrolledStreamCall` is the escape hatch for raw streaming members that
 * don't fit a Cell/Collection/Stream descriptor, and {@link STREAM_RETRY} is the
 * schedule the framework threads through every such call. The transport
 * dispatchers that *build* a client live in the link family (`./links/*`);
 * Solid-specific hooks live in `./solid`.
 *
 * **Where the retry lives, and why here (PLAN D3, review #12).** Effect RPC's
 * `retryTransientErrors` reconnects the SOCKET but re-issues nothing: the close
 * of an established socket fails every in-flight entry with an
 * `RpcClientError` and no layer re-subscribes. So the transparent re-subscribe
 * that `createSubscription`'s change-iff-fired law and D3's "a reconnect snapshot
 * leads a fresh stream" invariant both rest on has to be owned by the FACE, one
 * `Stream.retry` per subscription — never by a link (a link that retried inside
 * itself could not tell one subscriber's supersession from another's).
 *
 * The name `unenrolledStreamCall` is a WARNING. This call does NOT enrol into any
 * `client.health()` fact — it is the deliberately-unenrolled primitive, for a ROOT
 * stream that belongs to no surface (the terminal `attach`), or as the inner
 * factory of a `createSubscription` that owns its OWN `pending`/`error` and joins
 * via `client.enroll`. For a SURFACE-scoped raw stream use `client.rawStream`
 * instead — it enrols structurally and throws if you forget the owner. So a bare
 * `unenrolledStreamCall` at a call site reads as "I am intentionally outside the
 * health fact", never as a forgotten enrol.
 */

import { Effect, Schedule, Schema, Stream } from "effect";
// TYPE-ONLY: `SurfaceCallFailure` has to NAME the transport failure a unary call
// can produce, and that class belongs to Effect RPC. A type import adds no
// runtime edge, so the structural `_tag` match below still stands — this module
// never IMPORTS the class it recognises.
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB } from "./clockNow";
import { containThrow } from "./containThrow";
import {
  type CellSpec,
  type CollectionSpec,
  type ProcedureSpec,
  resolveCellVerbs,
  resolveCollectionVerbs,
  type Surface,
  type SurfaceSpec,
  surfaceTag,
  type WireSchemaAny,
} from "./define";
import { isSurfaceRelayTransportLost, type SurfaceError } from "./errors";
import { IDENTITY_NAMESPACE, IDENTITY_VERB } from "./identity";
import type { SurfaceDispatch } from "./link";
import { LIVENESS_NAMESPACE, LIVENESS_VERB } from "./liveness";
import { registerSubscription } from "./subscriptions";

/** The `_tag` every Effect RPC transport failure carries
 *  (`effect/unstable/rpc/RpcClientError`). Matched STRUCTURALLY rather than with
 *  `instanceof`, for the same reason the oRPC fence brand-checked rather than
 *  duck-typed: the error crosses module instances (a browser bundle with two
 *  copies of `effect`, a relay hop that decodes and re-encodes), and an
 *  `instanceof` against one realm's class silently stops recognising the other's
 *  — which would turn "retry transport errors forever" into "surface a transport
 *  drop to the consumer", the #1564 shape. It also keeps this module free of a
 *  dependency on the rpc subpath, so the FACE does not learn which transport
 *  produced the error. */
const RPC_CLIENT_ERROR_TAG = "RpcClientError";

/** Is `error` a TRANSPORT failure from the wire dispatch — the Effect RPC
 *  `RpcClientError` (socket open/close/read/write, HTTP client, worker, or a
 *  client-side protocol defect)? The Effect-4 successor of "is this NOT an
 *  `ORPCError`", i.e. the class the old fence retried by exclusion. Now matched
 *  POSITIVELY: a declared (D4) error is never mistaken for a transport drop just
 *  because it failed to be recognised. */
export function isTransportError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly _tag?: unknown })._tag === RPC_CLIENT_ERROR_TAG
  );
}

/** The retry policy shared across transports — the direct port of the oRPC-era
 *  `shouldNotRetryORPCError`: retry a TRANSPORT error, and the ONE named RETRYABLE
 *  relay end ({@link isSurfaceRelayTransportLost} — a re-serve's transient upstream
 *  drop the parent will heal), forever. NEVER retry anything else:
 *
 *   - a DECLARED (D4) procedure error is an application-level failure the server
 *     chose to raise; retrying just repeats it;
 *   - the two PERMANENTLY-dead transport tags (`SurfaceTransportRetired`,
 *     `SurfaceStdioTransportClosed`) are corpses — a retry loop over one is the
 *     reconnect storm review #5 records. They fall out here by construction: they
 *     are tagged surface errors, not `RpcClientError`s.
 *
 * Named once so the per-subscription fence below and any link-level policy can't
 * drift apart. */
export function shouldRetryStreamError(error: unknown): boolean {
  return isTransportError(error) || isSurfaceRelayTransportLost(error);
}

/** The fixed inter-attempt delay. oRPC's `retryDelay: (o) => o.lastEventRetry ?? 1000`
 *  read a SERVER-SUGGESTED SSE backoff off each event; Effect RPC has no counterpart
 *  (the ndjson protocol carries no retry hint), so the schedule is the constant the
 *  old code fell back to. Recorded rather than silently dropped — PLAN D3. */
export const STREAM_RETRY_DELAY_MS = 1000;

/** The retry SCHEDULE applied to every framework-driven streaming call: spaced
 *  {@link STREAM_RETRY_DELAY_MS}, forever, gated on {@link shouldRetryStreamError}.
 *  `Schedule.while` STOPS the schedule for any other failure, so a declared error
 *  propagates to the consumer on its first occurrence.
 *
 *  `Stream.retry` resets the schedule as soon as an element passes through again,
 *  so a healthy stream that drops once an hour never accumulates backoff. */
export const STREAM_RETRY: Schedule.Schedule<number, unknown> = Schedule.while(
  Schedule.spaced(STREAM_RETRY_DELAY_MS),
  ({ input }) => shouldRetryStreamError(input),
);

/** Per-subscription options for {@link fenceStream}. */
export interface StreamFenceOptions {
  /** What this subscription is CALLED in the liveness registry
   *  (`./subscriptions`) — the name a copy-pasted diagnostic snapshot uses to
   *  say which subscription is parked (kolu#2101 J2). Optional and additive; an
   *  unlabelled subscription still registers, under `"(unlabeled)"`
   *  (`UNLABELED_SUBSCRIPTION`), so a coverage gap is visible in the snapshot
   *  instead of being invisible.
   *
   *  Spell it in the `client.health()` vocabulary (`solid/health.ts`), which the
   *  framework's own enrolment sites already use and which this reuses rather
   *  than inventing a second one: a cell/stream is its bare key (`"preferences"`),
   *  a collection's keys-stream is `"<key>.keys"`, a per-key value sub is
   *  `"<key>[<id>]"`, a batched deltas stream is `"<key>.deltas"`. A raw
   *  un-enrolled call at an app call site adds whatever scope makes it
   *  identifiable (kolu: the host key, the terminal id) — two hosts legitimately
   *  hold subscriptions of the same member name. */
  readonly label?: string;
  /** Run BEFORE each re-subscribe (review #8). The consumer clears any derived
   *  state the fresh snapshot will replace — xterm's attach clears the buffer,
   *  padi's watch disarms its idle timer. It fires once per RETRYABLE failure, so
   *  it has PER-ATTEMPT identity: a superseded attempt's tap belongs to that
   *  attempt's own fenced stream, and interrupting the subscription interrupts the
   *  tap with it. It does NOT fire for a failure the fence refuses to retry — that
   *  error is about to reach the consumer, and there is no re-subscribe to prepare
   *  for. */
  readonly onRetry?: () => void;
}

/** Wrap a RAW member stream in the per-subscription retry fence — the ONE place
 *  D3's transparent re-subscribe is implemented.
 *
 *  A retryable failure taps `onRetry`, waits {@link STREAM_RETRY_DELAY_MS}, and
 *  re-runs the WHOLE stream, so the next frame the consumer sees is the member's
 *  fresh snapshot (cells/collections/streams all lead with one — the
 *  handler-enforced contract). Anything else fails the stream, unchanged, so a
 *  declared error still reaches `createSubscription`'s `error()`.
 *
 *  `Stream.retry` re-executes the stream's acquires, which is exactly right here:
 *  for a wire dispatch that means a fresh RPC request over the (by then
 *  reconnected) socket; for the in-process direct dispatch it means calling the
 *  handler again. Neither can produce a half-replayed stream. */
export function fenceStream<A>(
  stream: Stream.Stream<A, unknown>,
  opts?: StreamFenceOptions,
): Stream.Stream<A, unknown> {
  const onRetry = opts?.onRetry;
  // `Stream.suspend` so the registry record is minted when this subscription
  // RUNS, not when its value is built — a fenced stream is a lazy description a
  // consumer may hold for a long time before (or without) running it, and a
  // record for a subscription that never opened would be a lie in the snapshot.
  // One record per RUN, outside the retry, so a re-subscribe updates the
  // existing record's `retries` rather than minting a second one.
  return Stream.suspend(() => {
    const probe = registerSubscription(opts?.label);
    const tapped = Stream.tapError(stream, (error) => {
      // Tap INSIDE the retry so it runs once per attempt, before the delay and
      // the re-subscribe. Guarded on the same predicate the schedule uses, so
      // "fired ⇒ a re-subscribe follows" holds — a consumer that clears its
      // buffer here is never left with a cleared view and no new stream. It is
      // also exactly the definition of the registry's `retries`.
      if (!shouldRetryStreamError(error)) return Effect.void;
      probe.retry(error);
      // CONTAINED, because that promise has to be true of a hook the
      // framework does not own (kolu#2101 G8c). `onRetry` is consumer code —
      // `surfaceClient`'s health hook flips `pending` back on and calls the
      // caller's own `onRetry` under it; kolu's terminal resets an xterm.
      // Run bare in `Effect.sync`, a throw from any of that is a DEFECT, and
      // `Stream.retry` retries FAILURES only: the stream would die HERE,
      // immediately after telling the consumer to clear its view, leaving
      // exactly the cleared-view-and-no-new-stream state this comment
      // promises cannot happen — and, through the health hook, a `pending`
      // that never clears because no frame is ever coming to clear it.
      return onRetry === undefined
        ? Effect.void
        : Effect.sync(() =>
            containThrow(
              "a subscription's onRetry hook",
              onRetry,
              "the re-subscribe below still happens, so a consumer that just cleared its view gets the fresh snapshot it was promised",
            ),
          );
    });
    // The frame tap sits OUTSIDE the retry, so it counts what the CONSUMER
    // received across every attempt — which is the fact "this subscription last
    // heard from the server at T" is about. `onExit` records the end for the
    // same reason the tap is outside: an interrupt (the consumer's owner
    // disposing) is an ordinary end, and only the outer position sees it.
    return Stream.retry(tapped, STREAM_RETRY).pipe(
      Stream.tap(() => Effect.sync(probe.frame)),
      Stream.onExit((exit) => Effect.sync(() => probe.finish(exit))),
    );
  });
}

/** A CLIENT-side STREAMING member ref: the ENCODED input in, a lazy `Stream` out.
 *
 * Two deliberate shifts from the oRPC-era shape (`(input, opts) =>
 * Promise<AsyncIterable<O>>`):
 *
 *   - **No `signal`.** Cancellation is fiber interruption (D10/#18) — the
 *     subscription's scoped fiber is interrupted and the stream's own finalizers
 *     tear the wire subscription down. There is no signal to thread and none to
 *     forget.
 *   - **No `context`.** The retry context was a per-call plugin bag; the fence is
 *     now a `Stream` combinator the caller applies ({@link fenceStream}), so a raw
 *     ref is honestly raw.
 *
 * `I` is the ENCODED side of the member's input schema (D2/#13): the face decodes
 * at the edge, exactly where zod's `.parse`-at-input used to run. */
export type StreamingProcedure<I, O> = (input: I) => Stream.Stream<O, unknown>;

/** The failures a unary member call can produce that NO spec declared — the
 *  framework's own half of the error channel.
 *
 *  Two families, and keeping them NAMED (rather than widening `E` to `unknown`)
 *  is what lets a consumer `catchTag` its declared errors and still be told, by
 *  the compiler, that a transport death remains unhandled:
 *
 *   - `RpcClientError` — Effect RPC's transport failure (socket open/close/read/
 *     write, a client-side protocol defect). Only a WIRE dispatch produces it; the
 *     in-process `directDispatch` never can.
 *   - {@link SurfaceError} — the framework's tagged vocabulary (`./errors`): the
 *     retired browser socket, a closed stdio leg, a relay's middle-hop drop, and
 *     the keyed-map rejections.
 *
 *  Defects are NOT here, deliberately: an undeclared throw stays an `Effect.die`
 *  (D4) and must not be spellable on the error channel. */
export type SurfaceCallFailure = RpcClientError | SurfaceError;

/** A CLIENT-side UNARY member ref: the ENCODED input in, a lazy `Effect` of the
 *  DECODED result out. The unary counterpart of {@link StreamingProcedure}, and
 *  the ONLY shape a unary member has.
 *
 *  `E` is the member's DECLARED error union alone; the framework's own
 *  {@link SurfaceCallFailure} half is unioned in HERE rather than restated by every
 *  mapped type that mints a row, so no derivation can forget it.
 *
 *  Nothing runs until the effect does, so a caller composes the call into its own
 *  program: `Effect.catchTag` on a declared `_tag`, `Effect.timeout`, a race, a
 *  scoped fiber whose interruption tears the call down. That composability is the
 *  whole point, and it is why the Promise-shaped row this replaced is gone rather
 *  than kept beside it — a `Promise` can only be awaited, and an `await` is the one
 *  thing interruption cannot reach through.
 *
 *  Like {@link StreamingProcedure}, the argument is decoded EAGERLY at the call
 *  site (a bad input throws exactly where `.parse` used to) and only the DISPATCH
 *  is deferred. */
export type UnaryEffect<I, O, E> = (
  input: I,
) => Effect.Effect<O, E | SurfaceCallFailure>;

/** Call a streaming member with the framework's retry fence applied, WITHOUT
 *  enrolling it into any `client.health()` fact. The one-line escape hatch for raw
 *  streaming members that don't fit a Cell/Collection/Stream descriptor —
 *  bidirectional binary attaches, lifecycle events, anything outside the three
 *  primitives. For those that do fit, prefer the matching hook; it wraps
 *  internally. For a SURFACE-scoped raw stream that SHOULD be in the health fact,
 *  use `client.rawStream` (structural, throws outside an owner) — reach for this
 *  only when the stream is deliberately outside a surface's health (a root member)
 *  or is hand-joined via `client.enroll`; the `unenrolled-` prefix makes that
 *  choice legible at the call site.
 *
 *  Returns a LAZY stream: nothing is dispatched until it is run (typically by
 *  `createSubscription`'s scoped fiber). Interrupting that fiber tears the wire
 *  subscription down.
 *
 *  CAPTURED INPUT — the one hazard this helper hides. `input` is read ONCE. The
 *  fence re-subscribes by REPLAYING that captured value, so a stream whose input
 *  carries a LIVE fact (a size, a cursor, a viewport) re-sends a STALE one after
 *  any transport drop — and if the server acts on that input (kolu's terminal
 *  attach resizes the PTY to it), the replay actively moves shared state
 *  backwards. Invisible and harmless while every input is a stable key, which is
 *  why it is recorded here rather than only at the consumer that first hit it.
 *  Either keep the input a stable key, or have the consumer REFUSE an answer that
 *  was computed for the stale fact and reopen the stream — kolu's terminal attach
 *  is the worked example: it remembers the grid it asked at, drops a snapshot
 *  answering any other grid, and its re-attach thunk re-reads the live grid on
 *  every open (`client/src/terminal/Terminal.tsx`). Painting the stale answer and
 *  correcting afterwards does NOT work: the damage (scrollback wrapped at the
 *  wrong width) is already done. */
export function unenrolledStreamCall<I, O>(
  procedure: StreamingProcedure<I, O>,
  input: I,
  opts?: StreamFenceOptions,
): Stream.Stream<O, unknown> {
  return fenceStream(
    Stream.suspend(() => procedure(input)),
    opts,
  );
}

// ── The nested member face ─────────────────────────────────────────────
//
// The wire namespace is FLAT (`surface/<member>/<verb>`), but the shape a
// consumer reads and writes is nested — and deliberately so: `surface.notes.get`
// is how every existing consumer, every reserved probe (`probeSurfaceLive`,
// `probeSurfaceIdentity`, `probeSurfaceClockNow`) and the mirror walk address a
// member. So the face re-nests the flat tags ONCE, here, over the erased
// {@link SurfaceDispatch}: `face.surface[member][verb]`.
//
// **Every leaf is Effect-native.** A streaming verb hands back a lazy `Stream`; a
// unary verb hands back a lazy `Effect`. Neither runs until its consumer runs it,
// which is what lets a consumer COMPOSE a member call — catch a declared `_tag`,
// race it, bound it, let interruption tear it down — instead of awaiting a value
// the runtime can no longer reach.
//
// **Which side of the schema each position speaks (D2/#13).** The rule is not
// "everything is encoded" — it is:
//
//   - a position whose value the CLIENT ALSO HOLDS or INTERPRETS is DECODED. A
//     cell's `set`/`patch` payload is merged into a local-authority store by the
//     spec's own `patch(current, patch)` and seeded from the spec's own
//     `default` — both decoded — so a client that accepted the encoded side would
//     have to hold two representations of one value and would feed the wrong one
//     to the declared merge. Same for a collection's key: the client uses it as an
//     identity in its own key set.
//   - a position that is purely an ARGUMENT forwarded to the server — a
//     procedure's input, a stream's or event's input — is ENCODED, and this face
//     DECODES it at the edge. That is exactly where zod's `.parse`-at-input used
//     to run, and exactly where the divergence bites: a decoding default makes a
//     key omittable on the wire but required after decode, so typing it decoded
//     would demand an argument the wire does not need (#13).
//
// Either way the value handed to `SurfaceDispatch` is the DECODED one, which is
// what both dispatchers want: the direct dispatcher passes it straight to a
// handler S2 typed on the decoded payload, and a wire dispatcher passes it to
// Effect RPC's flat client, which encodes it for the wire.

/** The nested member face over a surface: `face.surface[member][verb]`.
 *
 *  Deliberately STRUCTURAL rather than spec-derived. Per-member precision lives
 *  in the bound `.cells`/`.collections`/`.streams`/`.events`/`.procedures` faces
 *  the Solid client builds ON TOP of this one (D2: type the face from the spec).
 *  This layer's job is addressing, not typing — and a second precise mapped type
 *  over the same spec is exactly the union-budget blowup D2 exists to avoid. */
export interface SurfaceFace {
  /** The member nesting: a unary verb is a {@link UnaryEffect}, a streaming verb a
   *  {@link StreamingProcedure}. Both are lazy descriptions — nothing is
   *  dispatched until the consumer runs the value it was handed. */
  readonly surface: Record<string, Record<string, unknown>>;
}

/** The structural shape of a served-surface client a PROJECTING FACE needs.
 *  The concrete client is what {@link buildSurfaceFace} mints (a wire link's
 *  face, the Solid client's `.rpc`, a `directDispatch`) —
 *  `.surface.<key>.<verb>(...)`, where a streaming verb returns a `Stream` and a
 *  unary one an `Effect`. Both are lazy: nothing dispatches until the face runs
 *  the value it was handed.
 *
 *  A loosening of {@link SurfaceFace} rather than a reuse of it, because a face
 *  string-indexes then *calls* the leaves (`client.surface[key].get(...)`),
 *  which `SurfaceFace`'s `unknown` leaves forbid; and re-materializing the
 *  precise `SurfaceClientOf<S>` overflows TS's union budget (the TS2590 dodge).
 *  Hence a callable-leaved structural shape: permissive enough that a concrete
 *  `SurfaceClientOf<S>` assigns without a cast, yet callable at the leaf.
 *
 *  It lives HERE, beside the `SurfaceFace` it loosens and the builder that MINTS
 *  the value it describes, rather than in whichever face read it first — and it
 *  is the framework's rather than either adapter's because both adapters need
 *  exactly it, and a second structural spelling of one shape is a place two
 *  faces can disagree about what a client is. */
export type SurfaceClientCallable = {
  // biome-ignore lint/suspicious/noExplicitAny: the per-key call shape is the consumer's typed client; opaque here.
  surface: Record<string, Record<string, (...args: any[]) => any>>;
};

/** A live connection a projecting face OWNS for some span — the client plus the
 *  release the face is responsible for.
 *
 *  Both faces hold exactly this; they differ only in the SPAN (one command for a
 *  CLI, a subscription's lifetime for MCP) and in whether they can use
 *  `onClose`. One shape, so a host can write ONE factory that feeds both faces —
 *  which is the thing the shared verb table and the shared expose map exist to
 *  make possible, and which two independent spellings whose `dispose` return
 *  types had silently diverged had already taken away. */
export interface OwnedSurfaceConnection<Client = SurfaceClientCallable> {
  client: Client;
  /** Release whatever the factory opened. May be async: a socket close is a
   *  promise on one face and a no-op on the other. */
  dispose: () => void | Promise<void>;
  /** Subscribe to this connection's transport dropping — the served daemon
   *  exited, or its socket closed. Fires at most once.
   *
   *  OPTIONAL because it is a property of the TRANSPORT, not of the factory: an
   *  in-process dispatch has no transport to drop, so it has no honest value to
   *  supply — and a face that never redials (a CLI dials, does one thing and
   *  exits) has no use for one. It is NOT a knob: a factory that CAN reach its
   *  close must supply it, and what an absent hook costs the MCP face is spelled
   *  out on that face's own alias. */
  onClose?: (cb: () => void) => void;
}

/** Decode an ENCODED argument at the face edge, or pass a DECODED one through.
 *  `undefined` schema ⇒ the member declares no payload (`Schema.Void`), so the
 *  dispatch payload is `undefined`. */
function decoderFor(
  schema: WireSchemaAny | undefined,
): (input: unknown) => unknown {
  if (schema === undefined) return () => undefined;
  return Schema.decodeUnknownSync(schema);
}

/** A UNARY member ref. Decodes the argument eagerly (a bad input throws at the
 *  call site, exactly as `.parse` did) and defers only the dispatch, so the
 *  returned effect is a pure description a caller may retry, race, time out or
 *  interrupt. */
function unaryRef(
  dispatch: SurfaceDispatch,
  tag: string,
  payload: WireSchemaAny | undefined,
  decodeInput: boolean,
): (input?: unknown) => Effect.Effect<unknown, unknown> {
  const decode = decodeInput ? decoderFor(payload) : undefined;
  return (input) => {
    const arg = decode ? decode(input) : input;
    return dispatch.unary(tag, arg);
  };
}

/** A STREAMING member ref. The argument is decoded EAGERLY (a bad input throws at
 *  the call site, exactly as `.parse` did) and the resulting stream is LAZY, so a
 *  re-subscribe under the retry fence replays the already-validated payload rather
 *  than re-validating it per attempt. */
function streamRef(
  dispatch: SurfaceDispatch,
  tag: string,
  payload: WireSchemaAny | undefined,
  decodeInput: boolean,
): (input?: unknown) => Stream.Stream<unknown, unknown> {
  const decode = decodeInput ? decoderFor(payload) : undefined;
  return (input) => {
    const arg = decode ? decode(input) : input;
    return dispatch.stream(tag, arg);
  };
}

/** Build the nested member face over a dispatch — the addressing layer every
 *  higher client (the Solid bundle, the mirror, a projection) is built on.
 *
 *  The walk reads `surface.tagPrefix` off the surface value, so it never learns
 *  whether it is facing a standalone surface or a composed sibling; the reserved
 *  `system/*` members are minted from the same prefix by the same
 *  {@link surfaceTag}, so the face and the served group can only ever agree. */
export function buildSurfaceFace<S extends SurfaceSpec>(
  surface: Surface<S>,
  dispatch: SurfaceDispatch,
): SurfaceFace {
  const spec = surface.spec;
  const prefix = surface.tagPrefix;
  // Null prototype for the same reason S2's handler record has one: member names
  // are arbitrary strings, so a member named `toString` must not resolve to an
  // inherited function nobody bound.
  const ns: Record<string, Record<string, unknown>> = Object.create(null);
  const member = (name: string): Record<string, unknown> => {
    const existing = ns[name];
    if (existing !== undefined) return existing;
    const fresh: Record<string, unknown> = Object.create(null);
    ns[name] = fresh;
    return fresh;
  };
  const tagOf = (name: string, verb: string) => surfaceTag(prefix, name, verb);

  /** Mint one UNARY verb — a lazy `Effect` at the member's wire tag. */
  const mintUnary = (
    name: string,
    verb: string,
    payload: WireSchemaAny | undefined,
    decodeInput: boolean,
  ): void => {
    member(name)[verb] = unaryRef(
      dispatch,
      tagOf(name, verb),
      payload,
      decodeInput,
    );
  };

  /** Mint one STREAMING verb — a lazy `Stream` at the member's wire tag. */
  const mintStream = (
    name: string,
    verb: string,
    payload: WireSchemaAny | undefined,
    decodeInput: boolean,
  ): void => {
    member(name)[verb] = streamRef(
      dispatch,
      tagOf(name, verb),
      payload,
      decodeInput,
    );
  };

  for (const [key, raw] of Object.entries(spec.cells ?? {})) {
    const cell = raw as CellSpec<unknown, unknown, unknown>;
    // A cell's VALUE and PATCH are decoded on both legs (see the rule above).
    for (const verb of resolveCellVerbs(cell)) {
      if (verb === "get") mintStream(key, verb, undefined, false);
      else mintUnary(key, verb, undefined, false);
    }
  }

  for (const [key, raw] of Object.entries(spec.collections ?? {})) {
    const coll = raw as CollectionSpec<unknown, unknown, unknown>;
    for (const verb of resolveCollectionVerbs(coll)) {
      // Every collection payload is built from DECODED keys/values by the caller
      // (`{ key }`, `{ key, value }`, `[{ key, value }, …]`), so nothing here
      // decodes — the shapes are assembled, not parsed.
      if (verb === "keys" || verb === "get" || verb === "deltas")
        mintStream(key, verb, undefined, false);
      else mintUnary(key, verb, undefined, false);
    }
  }

  for (const [key, raw] of Object.entries(spec.streams ?? {})) {
    const s = raw as { inputSchema: WireSchemaAny };
    mintStream(key, "get", s.inputSchema, true);
  }

  for (const [key, raw] of Object.entries(spec.events ?? {})) {
    const e = raw as { inputSchema: WireSchemaAny };
    mintStream(key, "get", e.inputSchema, true);
  }

  for (const [nsName, verbs] of Object.entries(spec.procedures ?? {})) {
    for (const [verb, raw] of Object.entries(verbs)) {
      const p = raw as ProcedureSpec<unknown, unknown>;
      mintUnary(nsName, verb, p.input, true);
    }
  }

  // The three framework-reserved members, at the SAME tags `defineSurface`
  // claimed them at. They live in the `system` namespace, which an app may also
  // populate with its own verbs — `member()` merges rather than replaces, and a
  // duplicate VERB is already a boot-time collision in `defineSurface`.
  mintUnary(LIVENESS_NAMESPACE, LIVENESS_VERB, undefined, false);
  mintUnary(IDENTITY_NAMESPACE, IDENTITY_VERB, undefined, false);
  mintUnary(CLOCK_NOW_NAMESPACE, CLOCK_NOW_VERB, undefined, false);

  return { surface: ns };
}
