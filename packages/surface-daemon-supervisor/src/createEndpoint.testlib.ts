/**
 * Test helper: {@link createEndpoint} with the OS-fact injects suites would
 * otherwise repeat at every call site — an isHolderLive-backed
 * `readProcessIdentity` (UW4) and the real osfacts-backed `readSocketHolders`
 * (OSF4). Production never imports this module.
 */

import {
  isHolderLive,
  type ProcessIdentity,
  type ReadProcessIdentity,
} from "@kolu/surface-daemon";
import { bakedOsFactsBin } from "osfacts-client";
import {
  createEndpoint as createEndpointCore,
  type EndpointSpec,
} from "./endpoint.ts";
import {
  osfactsSocketHolders,
  type ReadSocketHolders,
} from "./socketHolder.ts";

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

/** The REAL osfacts-backed holder reader — the squatter suites bind real unix
 *  sockets in real child processes, so a fake here would prove nothing about
 *  the path that actually runs. `bakedOsFactsBin` is loud when the nix wrapper
 *  did not bake the binary, which is the honest failure for a suite that
 *  cannot run without it. Resolved lazily so a suite that never recovers a
 *  squatter is not blocked by an unbaked environment. */
export const testReadSocketHolders: ReadSocketHolders = (socketPath) =>
  osfactsSocketHolders(bakedOsFactsBin("KOLU_OSFACTS_BIN"))(socketPath);

export function createEndpointForTest<C, I, M = undefined>(
  spec: Omit<
    EndpointSpec<C, I, M>,
    "readProcessIdentity" | "readSocketHolders"
  > &
    Partial<Pick<EndpointSpec<C, I, M>, "readSocketHolders">>,
) {
  return createEndpointCore({
    readSocketHolders: testReadSocketHolders,
    ...spec,
    readProcessIdentity: testReadProcessIdentity,
  });
}
