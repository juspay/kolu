/**
 * Package-private endpoint storage — unforgeable handles from {@link createEndpoint}.
 *
 * NOT part of the public package API (no root export, no `./testing` subpath).
 * Only `createEndpoint` may register; only kit modules (converge, recycle) and
 * same-package tests may resolve via relative import of this file.
 */

import type { BindResult } from "./convergence/bindResult.ts";

/** Private boot methods — only reachable via this module's WeakMap. */
export type EndpointPrivateBinds = {
  ensure(): Promise<void>;
  adoptOrEnsure(): Promise<BindResult>;
  adoptOrSpawnOrRefuse(): Promise<BindResult>;
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
