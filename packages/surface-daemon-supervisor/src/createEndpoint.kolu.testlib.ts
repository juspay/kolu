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
 * It SUPPLIES the reader, it does not default one: the inject is unspellable
 * here, so this helper cannot be handed an explicit `undefined` and cannot
 * defer a missing inject to first use. That is the same rule
 * `createEndpointForTest` states for `readSocketHolders` one file over — a
 * helper that made it optional-with-default would have been arguing against it.
 * A suite that wants a DIFFERENT reader (a fake `unattributed` reading, say)
 * reaches past this adapter for the general `createEndpointForTest` and passes
 * its own, which is also the honest signal that it is not exercising kolu's
 * bake.
 *
 * The holder reader is real; the IDENTITY reader is not. `createEndpointForTest`
 * supplies `testReadProcessIdentity` — synthetic start times (`pid * 1000`) that
 * agree only with gates a suite plants itself (`testStartUnixUs`). A suite that
 * meets a gate written by a REAL daemon must not come through here: the fake
 * disagrees with every genuine start instant, so a two-field gate naming a
 * provably-live holder reads as "no gate of ours names a verified holder" and
 * the takeover silently becomes a refusal. Those suites compose `createEndpoint`
 * with the production injects (`processIdentityAsync` / `osfactsSocketHolders`
 * over `bakedOsFactsBin`), exactly as the daemon's own composition root does.
 */
export function createEndpointForKoluTest<C, I, M = undefined>(
  spec: Omit<
    EndpointSpec<C, I, M>,
    "readProcessIdentity" | "readSocketHolders"
  >,
) {
  return createEndpointForTest<C, I, M>({
    ...spec,
    readSocketHolders: readSocketHoldersForKoluTests,
  });
}
