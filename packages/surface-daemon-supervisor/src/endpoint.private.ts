/**
 * Package-private endpoint storage — unforgeable handles from {@link createEndpoint}.
 *
 * NOT part of the public package API (no root export, no `./testing` subpath).
 * Only `createEndpoint` may register; only kit modules (converge, recycle) and
 * same-package tests may resolve via relative import of this file.
 */

import type { BindResult } from "./convergence/bindResult.ts";
import type { UnspeakablePeerError } from "./convergence/unspeakable.ts";

/**
 * What the cross-epoch takeover did. TWO arms, because "we did not kill it" is a
 * different fact from "we killed it and the bind failed" and the fold owes an
 * operator the difference:
 *
 *  - `taken-over` — the corroborated pid was re-attested, stopped, and a daemon
 *    of this epoch was spawned in its place. `spawned` is that bind's result,
 *    narrowed to the ONE arm a takeover can produce (there is no survivor left
 *    to adopt and no refusal to report — a takeover that could not spawn throws
 *    out of the endpoint rather than returning).
 *  - `holder-changed` — between the classification and the kill our gate came to
 *    name someone else (or nobody). NOTHING was signalled: a holder we have not
 *    proven unspeakable is a holder we do not touch. The fold reports it and the
 *    caller's next converge decides against a fresh observation.
 */
export type TakeoverResult =
  | {
      readonly kind: "taken-over";
      readonly spawned: Extract<BindResult, { kind: "spawned-fresh" }>;
    }
  | {
      readonly kind: "holder-changed";
      /** Whoever the gate names now — `undefined` when it names no live holder. */
      readonly observed: number | undefined;
    };

/** Private boot methods — only reachable via this module's WeakMap. */
export type EndpointPrivateBinds = {
  ensure(): Promise<void>;
  adoptOrEnsure(): Promise<BindResult>;
  adoptOrSpawnOrRefuse(): Promise<BindResult>;
  /** The corroborated-unspeakable disposition (PLAN D6 / Wave A) — see
   *  {@link TakeoverResult} and `createEndpoint`'s `takeOver`. */
  takeOver(peer: UnspeakablePeerError): Promise<TakeoverResult>;
  /**
   * Drop the held connection (W4.2): when converge returns a non-adopt
   * verdict after a bind that held a resident, release so outcome and
   * `current()` agree.
   */
  releaseHeld(): void;
};

const ENDPOINT_PRIVATE = new WeakMap<object, EndpointPrivateBinds>();

/** Register private binds for a createEndpoint handle. Only createEndpoint calls this. */
export function registerEndpointPrivate(
  handle: object,
  binds: EndpointPrivateBinds,
): void {
  ENDPOINT_PRIVATE.set(handle, binds);
}

/**
 * Resolve private binds for a genuine createEndpoint handle.
 * Throws if `handle` was not produced by createEndpoint (F12).
 */
export function endpointPrivate(handle: object): EndpointPrivateBinds {
  const binds = ENDPOINT_PRIVATE.get(handle);
  if (binds === undefined) {
    throw new Error(
      "endpoint is not a createEndpoint handle — converge/recycle require a genuine Endpoint",
    );
  }
  return binds;
}
