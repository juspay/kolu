/**
 * The transport-neutral seam between the surface client FACE and the LINKS.
 *
 * Stage boundary (W2 S3 ∥ S4): the face (`solid/surfaceClient.ts`, Stage 3)
 * consumes a {@link SurfaceDispatch}; every link factory (Stage 4 wire links,
 * Stage 3's in-process direct link) produces one. This file is the single
 * definition both sides compile against, so the two stages cannot drift.
 *
 * Payload side contract (PLAN D2 / review #13): dispatch payloads are the
 * DECODED (`Type`) side of each member's schema. The face accepts the Encoded
 * side publicly, decodes at the edge (applying decoding defaults exactly where
 * zod's `.parse` used to), and hands the decoded value here. Wire dispatchers
 * pass it to Effect RPC's flat client (which encodes for the wire); the direct
 * dispatcher passes it straight to the served handler (which S2 defined as
 * taking the decoded payload) — zero serialization, by construction.
 */

import type { Effect, Stream } from "effect";

/** One flat, tag-keyed dispatch across a surface — the erased seam. Precision
 *  (per-member payload/success/error types) lives in the face's spec-derived
 *  types, never here: a dynamically assembled RpcGroup carries no trustworthy
 *  type information (review #16), so this seam does not pretend to. */
export interface SurfaceDispatch {
  /** Unary member call. Fails with the member's declared tagged error or a
   *  transport error (`RpcClientError`-shaped); defects stay defects. */
  readonly unary: (
    tag: string,
    payload: unknown,
  ) => Effect.Effect<unknown, unknown>;
  /** Streaming member call. The RAW stream — the per-subscription retry fence
   *  (PLAN D3: the face owns it, review #12) is layered ON TOP by the face,
   *  never inside a link. */
  readonly stream: (
    tag: string,
    payload: unknown,
  ) => Stream.Stream<unknown, unknown>;
}

/** Transport status a watchdog can observe. */
export type WireStatus = "connecting" | "open" | "closed";

/** The observability + recovery affordances `createLiveSignal`'s half-open
 *  watchdog needs from a wire transport (review #4): Effect's socket layers
 *  expose none of these to callers, so the websocket link wraps its transport
 *  in this shape. `forceReconnect` is the watchdog's recovery action — it
 *  interrupts the protocol fiber so the link re-dials (re-evaluating its URL
 *  thunk: the pid-echo contract, review #6c). */
export interface WatchableWire {
  readonly status: () => WireStatus;
  readonly onStatus: (cb: (s: WireStatus) => void) => () => void;
  readonly forceReconnect: () => void;
}

// Every dispatch built over a real WIRE transport — by identity. A wire
// transport can silently HALF-OPEN (socket `open` at the OS level, no bytes
// flowing), so a dispatch over it has NO honest transport-liveness of its own;
// that signal must come from a watchdog (`createLiveSignal`). Branding at the
// one seam every wire link crosses means a new wire link inherits the guard by
// construction. `surfaceClient` consults {@link isHalfOpenDispatch} to FAIL
// FAST when handed a bare wire dispatch instead of a watchdog-backed
// `LiveSignalHandle` — the green-dot-over-a-dead-link lie (#1564), one seam
// upstream of the dot. WeakSet by identity: never mutates the value, GC-safe.
const HALF_OPEN_DISPATCHES = new WeakSet<object>();

// The in-process direct dispatch — no transport, cannot half-open, so its
// constant-`true` live leg is honest BY CONSTRUCTION (not by assumption).
const DIRECT_DISPATCHES = new WeakSet<object>();

/** Brand a dispatch as crossing a half-openable wire (every wire link factory
 *  must call this on what it returns). */
export function brandHalfOpenDispatch<D extends object>(dispatch: D): D {
  HALF_OPEN_DISPATCHES.add(dispatch);
  return dispatch;
}

/** True iff `dispatch` crosses a wire that can silently half-open — the face
 *  refuses such a dispatch unless a liveness watchdog backs it. */
export function isHalfOpenDispatch(dispatch: unknown): boolean {
  return (
    typeof dispatch === "object" &&
    dispatch !== null &&
    HALF_OPEN_DISPATCHES.has(dispatch)
  );
}

/** Brand the in-process direct dispatch (its `live` is constant-true honestly). */
export function brandDirectDispatch<D extends object>(dispatch: D): D {
  DIRECT_DISPATCHES.add(dispatch);
  return dispatch;
}

/** True iff `dispatch` is the in-process direct dispatch. */
export function isDirectDispatch(dispatch: unknown): boolean {
  return (
    typeof dispatch === "object" &&
    dispatch !== null &&
    DIRECT_DISPATCHES.has(dispatch)
  );
}
