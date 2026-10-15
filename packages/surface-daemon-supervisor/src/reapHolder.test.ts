/**
 * The two-deadline reap — the mechanism every supervisor kill site shares, and
 * the one the cross-epoch takeover load-bears on.
 *
 * The graceful and kernel deadlines are proven against REAL processes with tiny
 * ceilings, because the interesting arm is the one the production ceilings make
 * untestable: a process that IGNORES SIGTERM must still be gone when
 * `reapHolder` returns. The process STATE is an injected OS fact, so the stopped
 * path is driven by the reader a case passes rather than by a real SIGSTOP.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { isHolderLive } from "@kolu/surface-daemon";
import { Effect } from "effect";
import { OsfactsSpawnError } from "osfacts-client";
import { afterEach, expect, it } from "vitest";
import type { ReadProcessState } from "./processState.ts";
import {
  REAP_KILL_CEILING_MS,
  REAP_TERM_CEILING_MS,
  reapHolder,
} from "./reapHolder.ts";

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
});

/** A node child that sleeps forever. `trapTerm` makes it IGNORE SIGTERM — the
 *  wedged daemon the escalation exists for. */
async function sleeper(
  trapTerm: boolean,
): Promise<{ pid: number; child: ChildProcess }> {
  // Gated at the CALL SITE, where the fork actually happens — the `describeDaemon`
  // wrapper around the cases below is a different function, and the hygiene
  // backstop is per-site by design (#1334/#1375).
  assertDaemonSpawnAllowed("reapHolder fixture child");
  const body = trapTerm
    ? "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);console.log('up')"
    : "setInterval(()=>{},1000);console.log('up')";
  const child = spawn(process.execPath, ["-e", body], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error("child did not start");
  children.push(child);
  const up = Promise.withResolvers<void>();
  child.stdout?.once("data", () => up.resolve());
  child.once("error", up.reject);
  await up.promise;
  return { pid, child };
}

/** The state reader every case passes: a running pid (`S`). */
const running: ReadProcessState = () => Effect.succeed("S");
/** The reader for the #2101 arm: the pid is STOPPED. */
const stopped: ReadProcessState = () => Effect.succeed("T");

describeDaemon("reapHolder", () => {
  it("stops a well-behaved process at the FIRST deadline (SIGTERM)", async () => {
    const { pid } = await sleeper(false);
    const out = await Effect.runPromise(
      reapHolder(pid, running, {
        termCeilingMs: 5_000,
        killCeilingMs: 2_000,
        intervalMs: 10,
      }),
    );
    expect(out).toMatchObject({ kind: "reaped", endedBy: "SIGTERM" });
    expect(isHolderLive(pid)).toBe(false);
  }, 20_000);

  it("ESCALATES to SIGKILL when the graceful deadline passes — and says so", async () => {
    // The whole reason the takeover can promise the rendezvous will be free: a
    // daemon that swallows SIGTERM used to hold it forever behind a throw.
    const { pid } = await sleeper(true);
    const out = await Effect.runPromise(
      reapHolder(pid, running, {
        termCeilingMs: 300,
        killCeilingMs: 2_000,
        intervalMs: 10,
      }),
    );
    expect(out).toMatchObject({ kind: "reaped", endedBy: "SIGKILL" });
    if (out.kind !== "reaped") throw new Error("unreachable");
    // Evidence as DATA — the takeover's observation line reads these two fields
    // rather than parsing a sentence.
    expect(out.waitedMs).toBeGreaterThanOrEqual(300);
    expect(isHolderLive(pid)).toBe(false);
  }, 20_000);

  it("does NOT spend the graceful window on a STOPPED holder — KILLs it at once (#2101)", async () => {
    // A STOPPED holder cannot run its shutdown handler: its SIGTERM would be
    // queued, never delivered. So the graceful window can only be spent for
    // nothing — this is the 2 minutes the #2101 field incident paid, and the
    // reason the ladder reads the state before it waits.
    //
    // The term ceiling is DELIBERATELY large (a stopped daemon that were wrongly
    // given the graceful leg would wait it out and blow the `it` timeout): the
    // only way this case returns in time is by skipping step 1 entirely.
    const { pid } = await sleeper(false);
    const out = await Effect.runPromise(
      reapHolder(pid, stopped, {
        termCeilingMs: REAP_TERM_CEILING_MS,
        killCeilingMs: REAP_KILL_CEILING_MS,
        intervalMs: 10,
      }),
    );
    expect(out).toMatchObject({
      kind: "reaped",
      endedBy: "SIGKILL",
      reason: "stopped",
    });
    if (out.kind !== "reaped") throw new Error("unreachable");
    expect(out.waitedMs).toBeLessThan(REAP_KILL_CEILING_MS);
    expect(out.waitedMs).toBeLessThan(REAP_TERM_CEILING_MS / 10);
    expect(isHolderLive(pid)).toBe(false);
  }, 20_000);

  it("fails the ladder — and does NOT kill — when the state read cannot complete", async () => {
    // The defect this replaces: a `catch { return false }` collapsed a read
    // failure into "not stopped", which would spend the 120 s graceful ceiling
    // on a guess. A read that cannot complete is a FAILURE the endpoint answers
    // (`dead`, then propagate), and it must reach the caller as one — with the
    // process still alive, because nothing was signalled.
    const { pid } = await sleeper(false);
    const boom = new OsfactsSpawnError({ message: "osfacts would not start" });
    const failing: ReadProcessState = () => Effect.fail(boom);
    const exit = await Effect.runPromiseExit(
      reapHolder(pid, failing, { termCeilingMs: 60_000, intervalMs: 10 }),
    );
    expect(exit._tag).toBe("Failure");
    expect(isHolderLive(pid)).toBe(true);
  }, 20_000);

  it("succeeds immediately for a pid that is already gone", async () => {
    const { pid, child } = await sleeper(false);
    const exited = Promise.withResolvers<void>();
    child.once("exit", () => exited.resolve());
    process.kill(pid, "SIGKILL");
    await exited.promise;
    const out = await Effect.runPromise(
      reapHolder(pid, running, {
        termCeilingMs: 5_000,
        killCeilingMs: 2_000,
        intervalMs: 10,
      }),
    );
    expect(out).toMatchObject({ kind: "reaped", endedBy: "SIGTERM" });
  }, 20_000);

  it("states its two ceilings as constants, ordered graceful-then-kernel", () => {
    // Not a tautology: the ordering is the whole design. A kernel window longer
    // than the graceful one would mean we wait longer on a signal that cannot be
    // refused than on the shutdown we actually want to happen.
    expect(REAP_TERM_CEILING_MS).toBeGreaterThan(REAP_KILL_CEILING_MS);
  });
});
