/**
 * `killTerminal` must be idempotent under CONCURRENCY, not merely under
 * sequence.
 *
 * The guard used to be a plain READ (`getActiveTerminal`) sitting before an
 * `await` — the pty-host kill round-trip — with the registry entry dropped only
 * after it. So two kills that overlap in that window both observed a live entry,
 * both logged `killing`, both drove the whole teardown, both asked the pty-host
 * to kill the same pid, and both reported the terminal as theirs to have killed.
 * Production showed exactly this pair, 124ms apart, on one split close:
 *
 *     [09:47:10.985] INFO (4186350): killing {"terminal":"b4fc3794-…"}
 *     [09:47:11.109] INFO (4186350): killing {"terminal":"b4fc3794-…"}
 *
 * The cure is `claimActiveTerminal`: remove-and-return in ONE step, so the claim
 * IS the guard and there is no earlier read left to go stale. Two fences are
 * pinned, because they fail differently:
 *
 *  - the RETURN VALUE, which is what a caller acts on: exactly ONE kill may
 *    claim the terminal. A second concurrent kill is the same "already gone"
 *    outcome a second SEQUENTIAL kill already reports (`undefined`), and the
 *    two must not disagree just because they overlapped;
 *  - the PTY-HOST CALL COUNT: a dead pid must not be killed twice. Between the
 *    two kills the pid can be recycled by the OS, so the second kill is not
 *    merely redundant — it is aimed at whatever now holds that number.
 *
 * The pty-host kill is mocked as a genuinely DEFERRED round-trip, because that
 * is what it is in production. A mock that answers synchronously closes the
 * very window under test — the endpoint never yields, and the race cannot be
 * expressed. So the delay is unconditional: there is no configuration under
 * which this file wants an instant kill.
 */

import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { getTerminal, unregisterTerminal } from "../terminal-registry.ts";
import { localTerminalEndpoint } from "./local.ts";
import { seedActiveTerminal } from "./terminalFixtures.testlib.ts";

const killed = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { Effect } = await import("effect");
  const { emptySensorTaps } = await import("./sensorTaps.testlib.ts");
  return {
    ...actual,
    ptyHostClient: {
      surface: {
        terminal: {
          kill: ({ id }: { id: string }) =>
            Effect.promise(async () => {
              killed.ids.push(id);
              // The pty-host takes a beat to answer — a real kaval round-trip
              // crosses a unix socket — so the first kill is still parked here
              // while a second runs its synchronous preamble.
              await delay(20);
            }),
        },
        ...emptySensorTaps(),
      },
    },
  };
});

const ID = "22222222-2222-4222-8222-222222222222";

// `cleanupTerminalScratch` reads the per-instance scratch root, which boot
// injects before any of this runs; mirror that here so the read hits the happy
// path rather than the boot-order crash.
setDaemonProcessId("kill-idempotence-test-server");

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  seedActiveTerminal(ID);
  killed.ids = [];
});

afterEach(() => {
  unregisterTerminal(ID);
  __resetPadiSurfaceCtxForTest();
});

describe("killTerminal idempotence", () => {
  it("a SEQUENTIAL second kill reports the terminal already gone", async () => {
    const first = await localTerminalEndpoint.killTerminal(ID);
    const second = await localTerminalEndpoint.killTerminal(ID);

    expect(first?.id).toBe(ID);
    expect(second).toBeUndefined();
    expect(killed.ids).toEqual([ID]);
    expect(getTerminal(ID)).toBeUndefined();
  });

  it("a CONCURRENT second kill answers the same, and fires no second signal", async () => {
    // Each answer is observed AT the moment it lands rather than after both
    // settle: that is the contract `terminals.ts` advertises, and a post-settle
    // check cannot reach it. The winner is still parked on the pty-host
    // round-trip when the loser is answered, so a caller acting on `undefined`
    // — re-spawn, list refresh — must not find a registry entry that is still
    // live.
    const observed = await Promise.all(
      [
        localTerminalEndpoint.killTerminal(ID),
        localTerminalEndpoint.killTerminal(ID),
      ].map((call) =>
        call.then((info) => ({
          info,
          stillRegistered: getTerminal(ID) !== undefined,
        })),
      ),
    );

    // Fence 1 — the return value: exactly one winner, and the loser's
    // `undefined` already means GONE, not gone eventually.
    const claimed = observed.filter((answer) => answer.info !== undefined);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.info?.id).toBe(ID);
    const loser = observed.find((answer) => answer.info === undefined);
    expect(loser).toBeDefined();
    expect(loser?.stillRegistered).toBe(false);

    // Fence 2 — the pty-host call count: the dead pid is signalled once.
    expect(killed.ids).toEqual([ID]);
    expect(getTerminal(ID)).toBeUndefined();
  });
});
