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
import { Effect } from "effect";
import { bakedOsFactsBin, osfactsSocketHolders } from "osfacts-client";
import {
  createEndpoint as createEndpointCore,
  type EndpointSpec,
} from "./endpoint.ts";
import type { ReadSocketHolders } from "./socketHolder.ts";

/**
 * Lift a Promise-shaped test double onto an Effect's FAILURE channel.
 *
 * The three spec seams a suite fakes — `probe`, `connect`, `driver.spawn` — are
 * Effect-shaped, and every one of them has cases that reject on purpose: a
 * `DaemonContractSkewError` the endpoint must branch on, an `ENOENT` spawn, a
 * handshake that never completes. `Effect.promise` would put those on the
 * DEFECT channel, where `isContractSkewError` never sees them and the endpoint
 * would report `dead` for a skew. `tryPromise` keeps them typed failures, and
 * the `catch` hands back the ORIGINAL error object so a suite's
 * `rejects.toThrow(...)` / brand check reads exactly what it read before.
 */
export const fromAsync = <A>(f: () => Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise({
    try: f,
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  });

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

/**
 * {@link createEndpointCore} with the identity inject supplied.
 *
 * `readSocketHolders` stays REQUIRED, exactly as production has it: a default
 * here — even a throwing one — is a fallback that defers a missing required
 * inject from construction to first use, and it let a suite pass without ever
 * exercising the real injection. kolu's suites get it from
 * `./createEndpoint.kolu.testlib.ts`; a suite that never reaches a holder read
 * passes a one-line stub (`async () => ({ kind: "none" })`) and says so.
 */
export function createEndpointForTest<C, I, M = undefined>(
  spec: Omit<EndpointSpec<C, I, M>, "readProcessIdentity">,
) {
  return createEndpointCore({
    ...spec,
    readProcessIdentity: testReadProcessIdentity,
  });
}
