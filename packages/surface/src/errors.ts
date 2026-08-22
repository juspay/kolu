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

/** The browser socket was RETIRED by the server: a stale tab bound to a previous
 *  server instance was closed with `STALE_PROCESS_CLOSE_CODE` (4001). Terminal by
 *  construction — the retry schedule must STOP and every in-flight and future call
 *  must fail with this (D5/#5). Reconnecting would re-present the same stale `pid`
 *  and be closed again, forever. */
export class SurfaceTransportRetired extends Schema.TaggedError<SurfaceTransportRetired>(
  "@kolu/surface/SurfaceTransportRetired",
)("SurfaceTransportRetired", { reason: Schema.String }) {
  override get message(): string {
    return `surface transport retired: ${this.reason}`;
  }
}

/** A stdio/unix-socket leg was CLOSED (kolu#1719). Permanently dead for that
 *  link — the owner re-dials and gets a NEW link; the dead one never heals.
 *
 *  The link being dead does NOT mean the peer is: two causes reach here and only
 *  one of them is "the subprocess or socket the link rode is gone". The other is
 *  a peer that merely stopped answering the transport's keep-alive inside its
 *  deadline — a box under load, not a box that exited. `reason` distinguishes
 *  them in words, deliberately, because reading the second as the first is the
 *  misdiagnosis kolu#2101 cost an incident on. Re-dialling is the right response
 *  to both, which is why they share one tag. */
export class SurfaceStdioTransportClosed extends Schema.TaggedError<SurfaceStdioTransportClosed>(
  "@kolu/surface/SurfaceStdioTransportClosed",
)("SurfaceStdioTransportClosed", { reason: Schema.String }) {
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
 *  retry loop over one is the reconnect storm #5 records. */
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
