/**
 * Direct link — the **identity element** of the link family.
 *
 * The wire links (`websocketLink`, `stdioLink`) *separate* the serve side
 * from the consume side: one process serves a router, another connects over
 * a transport. The direct link *fuses* them — there is no wire, so serve and
 * consume collapse into one process. That's why it's shaped differently from
 * its siblings: instead of a transport (a socket, a stream pair), it takes
 * the **served router itself** (what `implementSurface` returns) and builds a
 * caller straight over the handlers. `client.surface.foo(input)` is then a
 * direct, microtask-deferred handler call — no serialization round-trip.
 *
 * This is what lets a project run the exact same consumer code against an
 * in-process implementation that it will later run against a socket/ssh-served
 * one: only the link changes. A single-process deployment, a unit test, or
 * the in-process phase of a not-yet-decoupled service can all hold a
 * `ContractRouterClient<C>` byte-identical to the remote topology they grow
 * into. (Streams declared on the surface come back as async iterables,
 * exactly as the wire-link clients yield them.)
 *
 * Need the server-side mutation `ctx` too (to drive cells/collections from
 * domain code)? Destructure it from `implementSurface` alongside the router:
 * `const { router, ctx } = implementSurface(surface, deps)`.
 */

import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import { createRouterClient } from "@orpc/server";

/** Build a direct (no-wire) client over a served router — the in-process
 *  member of the link family.
 *
 *  ```ts
 *  const { router } = implementSurface(surface, deps);
 *  const client = directLink<typeof surface.contract>(router);
 *  const out = await client.surface.thing.do({ ... });   // direct, no wire
 *  ```
 *
 *  The contract type parameter is supplied at the call site — concrete there
 *  (e.g. `typeof surface.contract`), so it never overflows TS's union budget
 *  the way materializing it over an abstract spec would (the router itself is
 *  typed loosely because `implementSurface`'s surface walk is dynamic). */
export function directLink<C extends AnyContractRouter>(
  router: Parameters<typeof createRouterClient>[0],
): ContractRouterClient<C> {
  return createRouterClient(router) as ContractRouterClient<C>;
}
