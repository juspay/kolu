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
import { bakedOsFactsBin, osfactsSocketHolders } from "osfacts-client";
import {
  createEndpoint as createEndpointCore,
  type EndpointSpec,
} from "./endpoint.ts";
import type { ReadSocketHolders } from "./socketHolder.ts";

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

/**
 * The REAL osfacts-backed holder reader, for a suite that exercises the
 * squatter recovery — those bind real unix sockets in real child processes, so
 * a fake would prove nothing about the path that actually runs.
 *
 * It takes the ENV VAR NAME rather than baking one, for the same reason
 * `readSocketHolders` is injected on `EndpointSpec` at all: this package is
 * shared spine, and a helper that spelled `KOLU_OSFACTS_BIN` would put a
 * consumer's name inside it — one file over from the production code that
 * carefully does not. Each consumer's suite passes its own.
 *
 * Resolution is lazy (per call, not per construction) so a suite that never
 * reaches a holder read is not blocked by an unbaked environment.
 */
export function testReadSocketHolders(envVar: string): ReadSocketHolders {
  return (socketPath) =>
    osfactsSocketHolders(bakedOsFactsBin(envVar))(socketPath);
}

/** The default `readSocketHolders` for a suite that did not name one: a loud
 *  refusal rather than a silent kolu-specific assumption. A suite that reaches
 *  it is a suite whose endpoint really does read socket holders, and it must
 *  say which binary to read them with. */
const unInjectedSocketHolders: ReadSocketHolders = async (socketPath) => {
  throw new Error(
    `createEndpointForTest: this suite reached a socket-holder read for ${socketPath} without injecting \`readSocketHolders\` — pass testReadSocketHolders(<your osfacts env var>)`,
  );
};

export function createEndpointForTest<C, I, M = undefined>(
  spec: Omit<
    EndpointSpec<C, I, M>,
    "readProcessIdentity" | "readSocketHolders"
  > &
    Partial<Pick<EndpointSpec<C, I, M>, "readSocketHolders">>,
) {
  return createEndpointCore({
    readSocketHolders: unInjectedSocketHolders,
    ...spec,
    readProcessIdentity: testReadProcessIdentity,
  });
}
