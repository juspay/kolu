/**
 * Test helper: {@link createEndpoint} with an isHolderLive-backed
 * `readProcessIdentity` inject so suites need not repeat the UW4 field at
 * every call site. Production never imports this module.
 */

import { isHolderLive } from "@kolu/surface-daemon";
import {
  createEndpoint as createEndpointCore,
  type EndpointSpec,
} from "./endpoint.ts";

/** Deterministic fake start times for live pids in unit tests. */
export function testStartUnixUs(pid: number): number {
  return pid * 1_000;
}

export function createEndpointForTest<C, I, M = undefined>(
  spec: Omit<EndpointSpec<C, I, M>, "readProcessIdentity">,
) {
  return createEndpointCore({
    ...spec,
    readProcessIdentity: (pid) =>
      isHolderLive(pid)
        ? { pid, startUnixUs: testStartUnixUs(pid) }
        : undefined,
  });
}
