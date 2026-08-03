/**
 * The two-deadline reap — the mechanism every supervisor kill site shares, and
 * the one the cross-epoch takeover load-bears on.
 *
 * Both deadlines are proven against REAL processes with tiny ceilings, because
 * the interesting arm is the one the production ceilings make untestable: a
 * process that IGNORES SIGTERM must still be gone when `reapHolder` returns.
 */
import { spawn } from "node:child_process";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { isHolderLive } from "@kolu/surface-daemon";
import { afterEach, expect, it } from "vitest";
import {
  REAP_KILL_CEILING_MS,
  REAP_TERM_CEILING_MS,
  reapHolder,
} from "./reapHolder.ts";

const children: number[] = [];
afterEach(() => {
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

/** A node child that sleeps forever. `trapTerm` makes it IGNORE SIGTERM — the
 *  wedged daemon the escalation exists for. */
async function sleeper(trapTerm: boolean): Promise<number> {
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
  children.push(pid);
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("error", reject);
  });
  return pid;
}

describeDaemon("reapHolder", () => {
  it("stops a well-behaved process at the FIRST deadline (SIGTERM)", async () => {
    const pid = await sleeper(false);
    const out = await reapHolder(pid, {
      termCeilingMs: 5_000,
      killCeilingMs: 2_000,
      intervalMs: 10,
    });
    expect(out).toMatchObject({ kind: "reaped", endedBy: "SIGTERM" });
    expect(isHolderLive(pid)).toBe(false);
  }, 20_000);

  it("ESCALATES to SIGKILL when the graceful deadline passes — and says so", async () => {
    // The whole reason the takeover can promise the rendezvous will be free: a
    // daemon that swallows SIGTERM used to hold it forever behind a throw.
    const pid = await sleeper(true);
    const out = await reapHolder(pid, {
      termCeilingMs: 300,
      killCeilingMs: 2_000,
      intervalMs: 10,
    });
    expect(out).toMatchObject({ kind: "reaped", endedBy: "SIGKILL" });
    if (out.kind !== "reaped") throw new Error("unreachable");
    // Evidence as DATA — the takeover's observation line reads these two fields
    // rather than parsing a sentence.
    expect(out.waitedMs).toBeGreaterThanOrEqual(300);
    expect(isHolderLive(pid)).toBe(false);
  }, 20_000);

  it("resolves immediately for a pid that is already gone", async () => {
    const pid = await sleeper(false);
    process.kill(pid, "SIGKILL");
    // Wait for the OS to actually reap it before asking.
    while (isHolderLive(pid)) await new Promise((r) => setTimeout(r, 10));
    const out = await reapHolder(pid, {
      termCeilingMs: 5_000,
      killCeilingMs: 2_000,
      intervalMs: 10,
    });
    expect(out).toMatchObject({ kind: "reaped", endedBy: "SIGTERM" });
  }, 20_000);

  it("states its two ceilings as constants, ordered graceful-then-kernel", () => {
    // Not a tautology: the ordering is the whole design. A kernel window longer
    // than the graceful one would mean we wait longer on a signal that cannot be
    // refused than on the shutdown we actually want to happen.
    expect(REAP_TERM_CEILING_MS).toBeGreaterThan(REAP_KILL_CEILING_MS);
  });
});
