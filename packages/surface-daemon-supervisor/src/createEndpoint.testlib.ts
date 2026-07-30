/**
 * Test helper: {@link createEndpoint} with an isHolderLive-backed
 * `readProcessIdentity` inject so suites need not repeat the UW4 field at
 * every call site. Production never imports this module.
 */

import {
  isHolderLive,
  type ProcessIdentity,
  type ReadProcessIdentity,
} from "@kolu/surface-daemon";
import {
  createEndpoint as createEndpointCore,
  type EndpointSpec,
} from "./endpoint.ts";

/** Deterministic fake start times for live pids in unit tests. */
export function testStartUnixUs(pid: number): number {
  return pid * 1_000;
}

/** isHolderLive-backed identity inject shared by endpoint suites and direct
 *  `acquirePidGate` pins that want the same fake start times. */
export const testReadProcessIdentity: ReadProcessIdentity = (pid) =>
  isHolderLive(pid) ? { pid, startUnixUs: testStartUnixUs(pid) } : undefined;

/** Fixed self identity for unit tests that claim a gate as `process.pid`.
 *  Start time is a constant (not `testStartUnixUs`) so release matching is
 *  independent of the live-pid fake formula. */
export const testSelfIdentity: ProcessIdentity = {
  pid: process.pid,
  startUnixUs: 1_000_000,
};

/** Reader for acquirePidGate tests: `process.pid` → {@link testSelfIdentity},
 *  every other live pid → {@link testReadProcessIdentity}. */
export const testAcquireReadIdentity: ReadProcessIdentity = (pid) =>
  pid === process.pid ? testSelfIdentity : testReadProcessIdentity(pid);

export function createEndpointForTest<C, I, M = undefined>(
  spec: Omit<EndpointSpec<C, I, M>, "readProcessIdentity">,
) {
  return createEndpointCore({
    ...spec,
    readProcessIdentity: testReadProcessIdentity,
  });
}
