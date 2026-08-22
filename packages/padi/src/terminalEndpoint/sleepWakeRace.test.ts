/**
 * A WAKE that lands while its own sleep-release is still in flight must not
 * have the woken terminal's scratch scrubbed out from under it.
 *
 * `sleepTerminal` is three steps: `beginSleep` flips the entry to the sleeping
 * arm, the caller persists the session, then `releaseSleptPty` kills the
 * now-detached PTY and scrubs its scratch dir. That last step yields — the
 * pty-host kill is a socket round-trip — and, unlike `killTerminal`, sleep
 * deliberately KEEPS the id in the registry. So the id is re-activatable while
 * the release is parked: a user clicking a dormant tile calls `wake(id)`, which
 * re-registers the SAME id as a LIVE terminal with a freshly spawned PTY.
 *
 * The read-then-await-then-mutate hazard is the tail that runs afterwards.
 * `cleanupTerminalScratch(id)` is `rmSync(dirFor(id), { recursive: true, force:
 * true })` — it takes no account of WHICH terminal owns the dir today, so it
 * deletes the live terminal's pasted images and dropped files, and the agent
 * reading a path kolu handed it gets ENOENT. Nothing re-creates them.
 *
 * `beginSleep` being the claim is TRUE and is NOT the risk: it fences a second
 * RELEASE, not a re-activation. The fence the tail actually needs is the file's
 * own idiom for carrying a claim across an await — capture the entry as a
 * VALUE, re-check identity after the await (`spawnViaClient` /
 * `unwindSpawnShadow`) — so a tail that finds someone else's entry under the id
 * leaves it alone.
 *
 * The scratch root here is REAL (a per-test daemon id under the runtime dir), so
 * the `rmSync` is observable rather than mocked away.
 */

import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { koluScratchDir, setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { getTerminal, unregisterTerminal } from "../terminal-registry.ts";
import { saveTerminalFile } from "../terminalScratch.ts";
import {
  beginSleepLocal,
  releaseSleptLocalPty,
  wakeLocalTerminal,
} from "./local.ts";
import { seedActiveTerminal } from "./terminalFixtures.testlib.ts";

const killed = vi.hoisted(() => ({ ids: [] as string[] }));
const spawned = vi.hoisted(() => ({ ids: [] as string[] }));
/** Runs INSIDE the pty-host kill, after the call is recorded — the seam that
 *  holds the release parked on its round-trip while the test wakes the id. */
const killGate = vi.hoisted(() => ({
  value: undefined as undefined | (() => Promise<void>),
}));

const WOKEN_PID = 7777;

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { Effect } = await import("effect");
  const { emptySensorTaps } = await import("./sensorTaps.testlib.ts");
  return {
    ...actual,
    // The real one gathers the daemon's boot-injected facts (kaval socket, app
    // version); none of them are set in a unit env and none of them matter here
    // — the spawn mock below ignores its input.
    buildTerminalSpawnInput: () => Effect.succeed({} as never),
    ptyHostClient: {
      surface: {
        terminal: {
          kill: ({ id }: { id: string }) =>
            Effect.promise(async () => {
              killed.ids.push(id);
              await killGate.value?.();
            }),
          write: () => Effect.void,
          spawn: () =>
            Effect.promise(async () => {
              spawned.ids.push(ID);
              return { pid: WOKEN_PID, cwd: "/work/repo" };
            }),
        },
        ...emptySensorTaps(),
      },
    },
  };
});

const ID = "33333333-3333-4333-8333-333333333333";

/** A promise a test resolves by hand — the gate halves. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The scratch root derives from the boot-injected daemon id; boot sets it before
// anything reads it, so mirror that here — and make it unique to this file so the
// dir this test writes is nobody else's.
// UNPREDICTABLE, deliberately. The scrub under test computes its own path from
// this id, so the test cannot point production at a `mkdtemp` dir of its own —
// it has to let `koluScratchDir()` derive the real one. Randomising the id keeps
// that real path unique per run, so concurrent files and leftovers never collide.
setDaemonProcessId(`sleep-wake-race-${randomUUID()}`);

const scratchDir = join(koluScratchDir(), ID);
/** Set by `saveTerminalFile` in `beforeEach` — the canonical path it returns. */
let pastedFile = "";

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  killed.ids = [];
  spawned.ids = [];
  killGate.value = undefined;
  // Seed the file through the PRODUCTION writer, not a hand-rolled
  // mkdir+write. Two reasons, and the second is the load-bearing one:
  //  - fidelity — this is exactly how a pasted screenshot lands, so the bytes
  //    the scrub deletes are the bytes a real user would lose;
  //  - `saveTerminalFile` owns the safe-creation rules (0700 dir, 0600 file)
  //    and says so at its definition, naming CodeQL's js/insecure-temporary-file.
  //    A test that re-implements the create re-implements them WITHOUT those
  //    rules, which is precisely what the rule fires on.
  pastedFile = saveTerminalFile(
    ID,
    "pasted.png",
    Buffer.from("a screenshot the agent has not read yet").toString("base64"),
  );
});

afterEach(() => {
  unregisterTerminal(ID);
  rmSync(scratchDir, { recursive: true, force: true });
  __resetPadiSurfaceCtxForTest();
});

describe("a wake racing its own sleep-release", () => {
  it("keeps the woken terminal's scratch — the release's tail is not its to scrub", async () => {
    seedActiveTerminal(ID);
    expect(beginSleepLocal(ID)).toBe(true);

    const killStarted = deferred();
    const holdKill = deferred();
    killGate.value = () => {
      killStarted.resolve();
      return holdKill.promise;
    };

    // The release is parked on the pty-host round-trip …
    const release = releaseSleptLocalPty(ID);
    await killStarted.promise;

    // … and the user clicks the dormant tile. The SAME id is live again, on a
    // freshly spawned PTY, before the release's tail has run.
    expect(wakeLocalTerminal(ID)?.id).toBe(ID);
    expect(getTerminal(ID)?.meta.state).toBe("active");

    holdKill.resolve();
    await release;

    // The tail found someone else's entry under the id, so it left it alone.
    expect(existsSync(pastedFile)).toBe(true);
    expect(getTerminal(ID)?.meta.state).toBe("active");

    // And the woken PTY really is wired — the live terminal was not torn down.
    await vi.waitFor(() => {
      expect(getTerminal(ID)?.info.pid).toBe(WOKEN_PID);
    });
    expect(spawned.ids).toEqual([ID]);
    expect(existsSync(pastedFile)).toBe(true);
  });

  it("still scrubs when the id stays dormant — the ordinary sleep", async () => {
    // The control: no re-activation, so the tail owns the dir and must delete it.
    // Without this the fence above could be satisfied by never scrubbing at all.
    seedActiveTerminal(ID);
    expect(beginSleepLocal(ID)).toBe(true);

    await releaseSleptLocalPty(ID);

    expect(killed.ids).toEqual([ID]);
    expect(existsSync(pastedFile)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });
});
