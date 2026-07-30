/**
 * KOLU's bake, for kolu's suites — the ONE place this repo's osfacts env var is
 * spelled inside a package that is shared with drishti.
 *
 * `createEndpoint.testlib.ts` deliberately takes the env-var NAME rather than
 * knowing one: `@kolu/surface-daemon-supervisor` is shared spine, and a helper
 * that spelled `KOLU_OSFACTS_BIN` would put a consumer's name inside it. That
 * left every kolu suite re-supplying the name, so it appeared eight times
 * across the package's own tests and the six-line adapter around it was
 * copy-pasted verbatim into two files. This module is that adapter, once.
 *
 * Production never imports it. A drishti-side equivalent would be four lines
 * over `DRISHTI_OSFACTS_BIN`, which is the point of the split.
 */

import {
  createEndpointForTest,
  testReadSocketHolders,
} from "./createEndpoint.testlib.ts";
import type { EndpointSpec } from "./endpoint.ts";

/** kolu's suites, so kolu's bake. */
const KOLU_OSFACTS_ENV = "KOLU_OSFACTS_BIN";

/** The REAL osfacts-backed holder reader, on kolu's baked binary. */
export const readSocketHoldersForKoluTests =
  testReadSocketHolders(KOLU_OSFACTS_ENV);

/**
 * {@link createEndpointForTest} with kolu's holder reader already supplied.
 *
 * A suite that wants a different one (a fake `unattributed` reading, say) still
 * passes its own. The choice is read with `??` rather than resolved by spread
 * order on purpose: `Partial` permits an EXPLICIT `readSocketHolders: undefined`
 * (no `exactOptionalPropertyTypes` in this repo), and a `{ default, ...spec }`
 * spread would let that undefined win — turning the miss into
 * `spec.readSocketHolders is not a function`, deep inside a recovery.
 */
export function createEndpointForKoluTest<C, I, M = undefined>(
  spec: Omit<
    EndpointSpec<C, I, M>,
    "readProcessIdentity" | "readSocketHolders"
  > &
    Partial<Pick<EndpointSpec<C, I, M>, "readSocketHolders">>,
) {
  return createEndpointForTest<C, I, M>({
    ...spec,
    readSocketHolders: spec.readSocketHolders ?? readSocketHoldersForKoluTests,
  });
}
