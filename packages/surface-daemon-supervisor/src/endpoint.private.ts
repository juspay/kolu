/**
 * Package-private endpoint storage — unforgeable handles from {@link createEndpoint}.
 * Not re-exported from the package root (F4 / F12).
 */

import type { BindResult } from "./convergence/bindResult.ts";
import type { DrainBudgetHandle } from "./convergence/budget.ts";
import type { ConvergenceProbe } from "./convergence/converge.ts";
import type {
  ConvergencePolicy,
  DrainCapability,
} from "./convergence/policy.ts";
import type { Logger } from "@kolu/surface-daemon";

/** Private boot methods — only reachable via this module's WeakMap. */
export type EndpointPrivateBinds = {
  ensure(): Promise<void>;
  adoptOrEnsure(): Promise<BindResult>;
  adoptOrSpawnOrRefuse(): Promise<BindResult>;
};

export type EndpointPrivateFace<Cap extends DrainCapability = DrainCapability> =
  EndpointPrivateBinds & {
    readonly policy: ConvergencePolicy<Cap>;
    probe: () => Promise<ConvergenceProbe<Cap> | null>;
    readonly budget: Cap extends "drainable"
      ? DrainBudgetHandle
      : DrainBudgetHandle | null;
    readonly log: Logger;
  };

const ENDPOINT_PRIVATE = new WeakMap<object, EndpointPrivateBinds>();

/** Register private binds for a createEndpoint handle. */
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

/** Test harness: register spy binds on an object used as an Endpoint stand-in. */
export function registerTestEndpointBinds(
  handle: object,
  binds: EndpointPrivateBinds,
): void {
  registerEndpointPrivate(handle, binds);
}
