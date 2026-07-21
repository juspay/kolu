/**
 * F17 (juspay/kolu#1334) — the pre-transfer ownership scope of `runKavalDaemon`.
 *
 * Moving the gate acquire to the top (F2) opened a window between acquiring the
 * single-instance gate and handing it to the spine's `daemonMain`. Two faults must
 * not leak that live-pid gate or a still-closing partial runtime:
 *   (a) the ephemeral ROLE WRITE throws (EACCES/EIO/ENOSPC) — the gate must be
 *       released, never left naming this live pid with no readable role; and
 *   (b) a partial ptyHost's async `close()` must be AWAITED before the gate is
 *       released (so an in-process retry can't start over a still-closing runtime),
 *       and a cleanup rejection must SURFACE (aggregated), never be swallowed.
 *
 * Forks nothing (the role write fails before any host in (a); the host is a stub in
 * (b)), so it needs no daemon-test gate.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@kolu/surface-daemon";
import { afterEach, expect, it, vi } from "vitest";
import { KAVAL_GATE_FILE } from "./socketPath.ts";

// A sentinel we can tell apart from `undefined` so the reject-`undefined` case proves
// the reason is aggregated, not merely that SOME rejection surfaced.
const DEFAULT_CLOSE_ERROR = new Error("partial ptyHost close rejected");

// Shared, hoist-safe state the ptyHost stub reports through (vi.mock factories may
// only reference `vi.hoisted` values). `closeReason` is what the stub's `close()`
// rejects with — configurable per case so one test can reject with `undefined`, a
// legal rejection reason the old `cleanupErr === undefined` sentinel silently dropped.
const h = vi.hoisted(() => ({
  state: {
    closeCalled: false,
    closeCompleted: false,
    closeReason: undefined as unknown,
  },
}));

// Stub the in-process ptyHost so (b) can drive an async-REJECTING `close()`. `done`
// is deliberately absent, so the `ptyHost.done.catch(...)` boot line throws a
// pre-transfer fault AFTER the host (and thus `ptyHostForCleanup`) is set — the exact
// window F17 must clean up. (Test (a) never reaches this: its role write throws first.)
vi.mock("./inProcessPtyHost.ts", () => ({
  createInProcessPtyHost: () => ({
    servedRouter: {},
    terminalCount: () => 0,
    close: async () => {
      h.state.closeCalled = true;
      await new Promise((r) => setTimeout(r, 10));
      h.state.closeCompleted = true;
      // `throw undefined` rejects the promise with `undefined` — a legal rejection
      // reason the cleanup aggregation must NOT confuse with "no cleanup error".
      throw h.state.closeReason;
    },
  }),
}));

import { runKavalDaemon } from "./daemonMain.ts";

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLog,
} as unknown as Logger;

// Track every sandbox so it is removed after each case (F23): the tests plant real
// mkdtemp trees (incl. a deliberate role directory), which would otherwise leak one
// `kaval-f17*` tree per case under the system temp dir — mirroring the neighboring
// daemon tests' teardown.
const sandboxes: string[] = [];
const sandbox = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  sandboxes.push(dir);
  return dir;
};
afterEach(() => {
  h.state.closeCalled = false;
  h.state.closeCompleted = false;
  h.state.closeReason = undefined;
  for (const dir of sandboxes.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

it("F17(a): a role-write failure releases the gate — no live-pid gate is leaked", async () => {
  const dir = sandbox("kaval-f17a-");
  const socketPath = join(dir, "pty-host.sock");
  const gatePath = join(dir, KAVAL_GATE_FILE);
  // Make the ephemeral role path UNWRITABLE by planting a directory where the marker
  // file goes — `writeEphemeralRole`'s `writeFileSync` then throws EISDIR, modelling an
  // EACCES/EIO/ENOSPC role write on the winning holder.
  mkdirSync(join(dir, "role"));

  await expect(
    runKavalDaemon({ socketOverride: socketPath, log: silentLog }),
  ).rejects.toThrow();
  // The gate was released on the pre-transfer throw — it does NOT linger naming this
  // live pid (which would wedge every later in-process launch as "already running").
  expect(existsSync(gatePath)).toBe(false);
});

it("F17(b): a partial ptyHost's async-rejecting close is AWAITED before the gate release, and its rejection surfaces", async () => {
  const dir = sandbox("kaval-f17b-");
  const socketPath = join(dir, "pty-host.sock");
  const gatePath = join(dir, KAVAL_GATE_FILE);
  h.state.closeReason = DEFAULT_CLOSE_ERROR;

  const err = await runKavalDaemon({
    socketOverride: socketPath,
    log: silentLog,
  }).then(
    () => {
      throw new Error("expected runKavalDaemon to reject");
    },
    (e) => e as unknown,
  );

  // The partial host's close ran to completion (it was AWAITED, not fire-and-forget).
  expect(h.state.closeCalled).toBe(true);
  expect(h.state.closeCompleted).toBe(true);
  // The cleanup rejection was PRESERVED — aggregated with the boot error, not swallowed.
  expect(err).toBeInstanceOf(AggregateError);
  const agg = err as AggregateError;
  expect(
    agg.errors.some(
      (e) =>
        e instanceof Error && /partial ptyHost close rejected/.test(e.message),
    ),
  ).toBe(true);
  // And the gate was released only AFTER that awaited close — no leak.
  expect(existsSync(gatePath)).toBe(false);
});

it("F17(c): a cleanup that rejects with `undefined` still surfaces a cleanup failure — the reason is aggregated, not dropped", async () => {
  // `undefined` is a legal Promise rejection reason. The old cleanup path used
  // `undefined` as BOTH "no cleanup error" and "close rejected with undefined", so
  // this rejection took the "no error" arm and was silently discarded — contradicting
  // the aggregate-EVERY-cleanup-failure contract. With a discriminated result it must
  // now aggregate: the AggregateError carries the boot error AND the `undefined` reason.
  const dir = sandbox("kaval-f17c-");
  const socketPath = join(dir, "pty-host.sock");
  const gatePath = join(dir, KAVAL_GATE_FILE);
  h.state.closeReason = undefined; // reject(undefined) — the sentinel-collision case

  const err = await runKavalDaemon({
    socketOverride: socketPath,
    log: silentLog,
  }).then(
    () => {
      throw new Error("expected runKavalDaemon to reject");
    },
    (e) => e as unknown,
  );

  // The partial host's close still ran to completion (awaited, not fire-and-forget).
  expect(h.state.closeCalled).toBe(true);
  expect(h.state.closeCompleted).toBe(true);
  // The cleanup FAILURE surfaced as an AggregateError even though its reason is
  // `undefined` — NOT collapsed to a bare boot-error rethrow that drops the cleanup.
  expect(err).toBeInstanceOf(AggregateError);
  const agg = err as AggregateError;
  expect(agg.errors).toHaveLength(2);
  // The captured cleanup reason (its second error) IS the `undefined` the close rejected
  // with — proof it was aggregated, not silently dropped.
  expect(agg.errors[1]).toBeUndefined();
  // The gate was still released — no leak.
  expect(existsSync(gatePath)).toBe(false);
});
