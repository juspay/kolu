/**
 * The surface's SHARED tagged-error vocabulary (D4).
 *
 * Every error that has to be recognised on the far side of a wire hop lives
 * here, as a `Schema.TaggedError`, in ONE module that all three tiers
 * (`@kolu/surface`, `@kolu/surface-map`, `@kolu/surface-remote`) import. That
 * single home is not tidiness — it is the requirement:
 *
 *   - **Recognition across hops.** A re-serving parent decodes an error from its
 *     upstream agent and re-encodes it downstream to the browser. Only a schema
 *     BOTH ends were built from survives serialize → deserialize → re-serialize
 *     with its identity (`_tag`) and its data intact. A per-package copy of the
 *     "same" error would decode as a foreign shape at the middle hop and be
 *     flattened into an opaque defect.
 *   - **One union to decode.** {@link SurfaceErrorSchema} is the closed union of
 *     everything the framework itself can put on the wire; the relay decodes
 *     against it, not against a per-call guess.
 *
 * These replace the `ORPCError` + magic-code discrimination the oRPC stack used
 * (`SURFACE_TRANSPORT_RETIRED`, `SURFACE_STDIO_TRANSPORT_CLOSED`,
 * `SURFACE_RELAY_TRANSPORT_LOST`, and surface-map's three typed rejections).
 * The discriminant is now the `_tag`, checked by the typed predicates below —
 * never a string compared by hand at a call site.
 *
 * A DEFECT is still a defect: an undeclared throw stays an `Effect.die` and is
 * NOT modelled here. This module is the vocabulary of failures the framework
 * declares, i.e. the ones a caller is expected to branch on.
 */

import { Schema } from "effect";

// ── Dead / lost transports ─────────────────────────────────────────────
//
// The three transport failures the retry fence discriminates on. Two are
// PERMANENTLY dead (never retry — the transport itself is gone and a retry
// just re-presents the same corpse); one is a TRANSIENT middle-hop drop the
// re-serving parent will heal, so it is the one the fence retries forever.
// See `isDeadTransportError` / `isSurfaceRelayTransportLost` below.

/** WHICH death a {@link SurfaceTransportRetired} was — the same discriminant
 *  {@link StdioTransportDeath} is, under the same field name, so the two tags
 *  {@link isDeadTransportError} unions are UNIFORMLY branchable (a consumer
 *  reads `death` off the narrowed union without a second per-tag guard). Both
 *  arms are terminal for the wire; they differ only in what happened to it. */
export const RetiredTransportDeath = Schema.Literals([
  /** The SERVER retired this socket — a stale tab bound to a previous server
   *  instance, closed with the app's terminal close code. The far end is alive
   *  and answering; it is this socket it will not talk to. */
  "retiredByServer",
  /** The owner released the link; the request was never sent. Nothing is known
   *  or claimed about the peer. Deliberately the SAME spelling
   *  {@link StdioTransportDeath} uses — one fact, one word, whichever leg. */
  "disposed",
]);

/** The decoded value of {@link RetiredTransportDeath}. */
export type RetiredTransportDeath = typeof RetiredTransportDeath.Type;

/** The browser socket was RETIRED by the server: a stale tab bound to a previous
 *  server instance was closed with `STALE_PROCESS_CLOSE_CODE` (4001). Terminal by
 *  construction — the retry schedule must STOP and every in-flight and future call
 *  must fail with this (D5/#5). Reconnecting would re-present the same stale `pid`
 *  and be closed again, forever.
 *
 *  `death` carries WHICH terminal fact this was, on the same optional key and
 *  under the same wire-skew rule as {@link SurfaceStdioTransportClosed.death}:
 *  absent means "the producer did not classify", never a defaulted guess. */
export class SurfaceTransportRetired extends Schema.TaggedError<SurfaceTransportRetired>(
  "@kolu/surface/SurfaceTransportRetired",
)("SurfaceTransportRetired", {
  reason: Schema.String,
  death: Schema.optionalKey(RetiredTransportDeath),
}) {
  override get message(): string {
    return `surface transport retired: ${this.reason}`;
  }
}

/** WHICH death a {@link SurfaceStdioTransportClosed} was — the discriminant, so
 *  a consumer that puts words on a screen never has to read `reason` to tell two
 *  of them apart. All three are permanently dead for that link and re-dialling is
 *  the right response to each, which is why they share ONE tag; they are not the
 *  same fact about the PEER, and reading `keepAliveUnanswered` as `streamEnded`
 *  is the misdiagnosis kolu#2101 cost an incident on. */
export const StdioTransportDeath = Schema.Literals([
  /** The peer stopped answering the transport's keep-alive inside its deadline.
   *  It may still be ALIVE and merely too busy to answer — a box under load, not
   *  a box that exited. This is NOT evidence that it exited. (The mechanism, and
   *  why a duplex leg may read that timeout this way at all, is argued once — in
   *  `keepAliveWentUnanswered` in `links/wire.ts`.) */
  "keepAliveUnanswered",
  /** The subprocess or socket the link rode is gone: the stream ended or the
   *  pipe broke. The far end really is unreachable. */
  "streamEnded",
  /** The owner released the link; the request was never sent. Nothing is known
   *  or claimed about the peer. */
  "disposed",
]);

/** The decoded value of {@link StdioTransportDeath}. */
export type StdioTransportDeath = typeof StdioTransportDeath.Type;

/** A stdio/unix-socket leg was CLOSED (kolu#1719). Permanently dead for that
 *  link — the owner re-dials and gets a NEW link; the dead one never heals.
 *
 *  The link being dead does NOT mean the peer is. {@link StdioTransportDeath}
 *  carries which death it was, and each arm says what it means about the far
 *  end; `reason` is the human sentence beside it. Code branches on `death` —
 *  never on the prose, per this module's own header.
 *
 *  `death` is an OPTIONAL key for WIRE SKEW, not as a knob: this tag crosses a
 *  re-serve relay hop, and a peer built before the field existed encodes a
 *  payload without it. Absent therefore means exactly "the producer did not
 *  classify" — the truth about such a payload, never a defaulted guess at one
 *  (`errors.test.ts` pins the tolerant decode). Every producer in this tree sets
 *  it. */
export class SurfaceStdioTransportClosed extends Schema.TaggedError<SurfaceStdioTransportClosed>(
  "@kolu/surface/SurfaceStdioTransportClosed",
)("SurfaceStdioTransportClosed", {
  reason: Schema.String,
  death: Schema.optionalKey(StdioTransportDeath),
}) {
  override get message(): string {
    return `surface stdio transport closed: ${this.reason}`;
  }
}

/** The ONE RETRYABLE framework error. A re-serving parent's fail-through relay ends
 *  its downstream stream with this when its UPSTREAM link to the agent is lost (no
 *  live upstream at subscribe, or a mid-stream link death), so the consumer
 *  re-subscribes end-to-end and a fresh snapshot leads the new stream. It is the
 *  dual of the two dead-transport tags above: those are permanently dead, this one
 *  is a transient middle-hop drop the parent will heal.
 *
 *  It exists precisely BECAUSE it must survive the relay hop: the parent decodes a
 *  transport death from upstream and re-encodes THIS downstream. Both ends share
 *  this class, so the browser recognises it by `_tag`, not by a magic code. */
export class SurfaceRelayTransportLost extends Schema.TaggedError<SurfaceRelayTransportLost>(
  "@kolu/surface/SurfaceRelayTransportLost",
)("SurfaceRelayTransportLost", { reason: Schema.String }) {
  override get message(): string {
    return `surface relay transport lost: ${this.reason}`;
  }
}

// ── Keyed-map rejections (`@kolu/surface-map`) ─────────────────────────
//
// Declared HERE rather than in `@kolu/surface-map` for the relay-rehydration
// requirement above: a map entry's stream crosses the same parent hop as every
// other surface error, so the parent must be able to decode and re-encode these
// against the same union. Location is structure — the shared vocabulary is a
// property of the wire, not of the package that happens to raise it.

/** The wire `mapKey` is not its own canonical encoding. A LENIENT codec (one that
 *  trims / case-folds / aliases on decode) would otherwise let a non-canonical
 *  spelling reach a real member while the republish loop publishes on the CANONICAL
 *  spelling — two channel names for one member, so the non-canonical subscriber's
 *  stream holds open and never receives an update. */
export class MapKeyNonCanonical extends Schema.TaggedError<MapKeyNonCanonical>(
  "@kolu/surface/MapKeyNonCanonical",
)("MapKeyNonCanonical", {
  wireKey: Schema.String,
  canonicalKey: Schema.String,
}) {
  override get message(): string {
    return (
      `surface-map: wire key "${this.wireKey}" is not its own canonical encoding ` +
      `(expected "${this.canonicalKey}") — the codec must be re-encode-stable so ` +
      "subscribe and publish agree on one channel name"
    );
  }
}

/** A UNARY call named a key that is not a member of the map. (A STREAM call on an
 *  absent key is a typed END, never an error frame — membership loss mid-stream is
 *  ordinary, and only a one-shot call cannot end gracefully.) */
export class MapKeyUnknown extends Schema.TaggedError<MapKeyUnknown>(
  "@kolu/surface/MapKeyUnknown",
)("MapKeyUnknown", { mapKey: Schema.String }) {
  override get message(): string {
    return `surface-map: key "${this.mapKey}" is not a member`;
  }
}

/** The named key IS a member, but its entry is in a terminal FAULT state, so there
 *  is no link to forward the call to. `failure` is the rendered fault, carried as a
 *  string because the fault's own shape is app-owned and must not leak into the
 *  framework's wire union. */
export class MapEntryFailed extends Schema.TaggedError<MapEntryFailed>(
  "@kolu/surface/MapEntryFailed",
)("MapEntryFailed", { mapKey: Schema.String, failure: Schema.String }) {
  override get message(): string {
    return `surface-map: entry "${this.mapKey}" is failed: ${this.failure}`;
  }
}

// ── The closed union ───────────────────────────────────────────────────

/** Every error the FRAMEWORK itself can put on the wire, as one schema. A relay hop
 *  decodes against this union and re-encodes the decoded value, which is what keeps
 *  a `_tag` (and its data) intact across serialize → deserialize → re-serialize.
 *  App-declared procedure errors are NOT in here — they are declared per procedure
 *  on `ProcedureSpec.error` and travel on that procedure's own error channel. */
export const SurfaceErrorSchema = Schema.Union([
  SurfaceTransportRetired,
  SurfaceStdioTransportClosed,
  SurfaceRelayTransportLost,
  MapKeyNonCanonical,
  MapKeyUnknown,
  MapEntryFailed,
]);

/** The decoded union of {@link SurfaceErrorSchema}. */
export type SurfaceError = typeof SurfaceErrorSchema.Type;

// ── Typed predicates ───────────────────────────────────────────────────
//
// The RECOGNITION twins of the classes above, colocated with them so "which tags
// mean the transport itself died" lives in exactly one place, next to the
// declarations and the retry fence they stay in lockstep with. Every one is a
// TYPE GUARD: a call site narrows rather than re-checking `_tag` by hand.

/** Is `error` any framework-declared surface error? */
export function isSurfaceError(error: unknown): error is SurfaceError {
  return (
    error instanceof SurfaceTransportRetired ||
    error instanceof SurfaceStdioTransportClosed ||
    error instanceof SurfaceRelayTransportLost ||
    error instanceof MapKeyNonCanonical ||
    error instanceof MapKeyUnknown ||
    error instanceof MapEntryFailed
  );
}

/** Is `error` a PERMANENTLY dead transport — the retired browser socket or the
 *  closed stdio leg? These must never be retried: the transport is gone, and a
 *  retry loop over one is the reconnect storm #5 records.
 *
 *  Both arms of this union carry `death` — {@link RetiredTransportDeath} on one,
 *  {@link StdioTransportDeath} on the other — so a consumer that has narrowed to
 *  this type can read the discriminant directly. That symmetry is the point: a
 *  union where only one member declared the field would force every branching
 *  consumer through a second, per-tag guard, and the one consumer that puts
 *  words on a screen would inevitably read `reason` instead. */
export function isDeadTransportError(
  error: unknown,
): error is SurfaceTransportRetired | SurfaceStdioTransportClosed {
  return (
    error instanceof SurfaceTransportRetired ||
    error instanceof SurfaceStdioTransportClosed
  );
}

/** Narrower than {@link isDeadTransportError}: the retired-browser-socket tag only.
 *  The stale-tab classifier and the tests that pin "a 4001 close produces exactly
 *  one close and zero re-dials" discriminate on this alone. */
export function isSurfaceTransportRetired(
  error: unknown,
): error is SurfaceTransportRetired {
  return error instanceof SurfaceTransportRetired;
}

/** Narrower than {@link isDeadTransportError}: the closed-stdio-leg tag only. A
 *  re-serve CONSUMER dialling with a raw client (no retry fence) uses it — with
 *  {@link isSurfaceRelayTransportLost} — to recognise a transport-loss end and
 *  re-subscribe across a reconnect window. */
export function isSurfaceStdioTransportClosed(
  error: unknown,
): error is SurfaceStdioTransportClosed {
  return error instanceof SurfaceStdioTransportClosed;
}

/** Is `error` the relay's RETRYABLE middle-hop transport-loss end? Deliberately
 *  tight: the relay re-throws genuine application errors UNCHANGED, so this tag is
 *  ALWAYS a benign transport-loss end and never an app error. */
export function isSurfaceRelayTransportLost(
  error: unknown,
): error is SurfaceRelayTransportLost {
  return error instanceof SurfaceRelayTransportLost;
}

// ── What an ARBITRARY failure says ───────────────────────────────────────
//
// Not a declared error at all, which is why it sits at the foot of this module
// rather than in the union above: this is the derivation every face falls back
// to when the value it caught is not one of the framework's own — a defect, a
// scaffold's throw, a plain object someone failed with. It lives HERE because
// "what did this failure SAY" is failure vocabulary, and this module is where
// this stack keeps that; every projecting face folds a caught failure into its
// own answer through it, so all of them word one failure the same way.

/** The best sentence an arbitrary thrown value has in it — the one place this
 *  stack decides what an unknown failure SAYS, so a face that folds a caught
 *  failure into its own answer words it exactly as its request edge would.
 *
 *  `e instanceof Error ? e.message : String(e)` was ALMOST right and wrong for
 *  the two shapes Effect actually delivers here:
 *
 *    - a `Data.TaggedError` is an `Error` whose `message` is `""` — its identity
 *      lives in `_tag` — so it reached consumers as a bare prefix;
 *    - a failure declared as a plain object is not an `Error` at all, and
 *      `String(e)` renders it `[object Object]`.
 *
 *  Both are exactly the failures worth reading, so each falls back to the next
 *  most specific thing the value KNOWS about itself — never to a placeholder.
 *
 *  (`@kolu/surface-mcp` re-exports it under the name it shipped.) */
export function messageOf(e: unknown): string {
  if (e instanceof Error) {
    if (e.message !== "") return e.message;
    const tag = (e as { _tag?: unknown })._tag;
    return typeof tag === "string" && tag !== "" ? tag : e.name;
  }
  if (typeof e === "object" && e !== null) {
    // `String(e)` is NOT the answer for an object — it is the `[object Object]`
    // this function exists to stop — so name the value the way a value can
    // always be named: its constructor and the fields it actually has.
    try {
      return JSON.stringify(e) ?? describeObject(e);
    } catch (unstringifiable) {
      // NOT only a cycle. `stringify` also refuses a `BigInt` anywhere in the
      // tree, and it EVALUATES every own enumerable getter — so a property that
      // throws on read throws from here, carrying a real and unrelated reason
      // ("network timeout while computing x"). Discarding it would swallow the
      // most specific thing known about the failure inside the one function
      // whose whole job is to find that. It rides along with the shape.
      return `${describeObject(e)} (unstringifiable: ${messageOf(unstringifiable)})`;
    }
  }
  return String(e);
}

/** Name an object JSON cannot render: its constructor and its own keys. Never
 *  `[object Object]` — the point is that the reader learns WHAT failed even when
 *  it cannot learn the whole value.
 *
 *  `||`, not `??`: an anonymous class expression HAS a constructor and its
 *  `.name` is `""`, which would render a nameless `{ a, b }`. */
function describeObject(e: object): string {
  const name = e.constructor?.name || "Object";
  return `${name} { ${Object.keys(e).join(", ")} }`;
}
