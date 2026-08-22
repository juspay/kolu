/**
 * `killTerminal` must be idempotent under CONCURRENCY, not merely under
 * sequence.
 *
 * The guard (`getActiveTerminal`) sits BEFORE an `await` — the pty-host kill
 * round-trip — and the registry entry is only dropped AFTER it. So two kills
 * that overlap in that window both observe a live entry, both drive the whole
 * teardown, both ask the pty-host to kill the same pid, and both report the
 * terminal as theirs to have killed. Production showed exactly this pair,
 * 124ms apart, on one split close:
 *
 *     [09:47:10.985] INFO (4186350): killing {"terminal":"b4fc3794-…"}
 *     [09:47:11.109] INFO (4186350): killing {"terminal":"b4fc3794-…"}
 *
 * Two fences are pinned, because they fail differently:
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
 * expressed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  registerTerminal,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { LOCAL_LOCATION } from "../vocab.ts";
import { localTerminalEndpoint } from "./local.ts";
import { installSnapshot } from "./metadata.ts";

const killed = vi.hoisted(() => ({ ids: [] as string[] }));
/** Holds the pty-host kill open, so both callers are inside the window the
 *  guard doesn't cover. A real kaval round-trip crosses a unix socket; this is
 *  the cheapest honest stand-in for "it does not answer within this tick". */
const killGate = vi.hoisted(() => ({
  value: undefined as undefined | (() => Promise<void>),
}));

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { Effect, Stream } = await import("effect");
  // Empty sensor taps: the wiring must not depend on any sensor emitting, and
  // a MISSING tap throws (a different case, pinned in `adoptTolerance.test.ts`).
  const tap = () => () => Stream.empty;
  return {
    ...actual,
    ptyHostClient: {
      surface: {
        terminal: {
          kill: ({ id }: { id: string }) =>
            Effect.promise(async () => {
              killed.ids.push(id);
              await killGate.value?.();
            }),
        },
        cwd: { get: tap() },
        title: { get: tap() },
        commandRun: { get: tap() },
        foreground: { get: tap() },
        exit: { get: tap() },
      },
    },
  };
});

const ID = "22222222-2222-4222-8222-222222222222";

function activeEntry(): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 4242 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      themeName: "rose",
      lastActivityAt: 123,
      restoreTarget: { kind: "none" },
    },
    snapshot: {
      cwd: "/work/repo",
      git: null,
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
    },
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

/** The pty-host takes a beat to answer, so the first kill is still parked on
 *  its round-trip while the second runs its synchronous preamble. */
function slowPtyHost(): void {
  killGate.value = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 20));
}

// `cleanupTerminalScratch` reads the per-instance scratch root, which boot
// injects before any of this runs; mirror that here so the read hits the happy
// path rather than the boot-order crash.
setDaemonProcessId("kill-idempotence-test-server");

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  registerTerminal(ID, activeEntry());
  installSnapshot(ID);
  killed.ids = [];
  killGate.value = undefined;
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

  it("a CONCURRENT second kill reports the same thing — one winner, one `undefined`", async () => {
    slowPtyHost();

    const [first, second] = await Promise.all([
      localTerminalEndpoint.killTerminal(ID),
      localTerminalEndpoint.killTerminal(ID),
    ]);

    const claimed = [first, second].filter((info) => info !== undefined);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(ID);
    expect(getTerminal(ID)).toBeUndefined();
  });

  it("a CONCURRENT second kill does not fire a second pty-host kill at the pid", async () => {
    slowPtyHost();

    await Promise.all([
      localTerminalEndpoint.killTerminal(ID),
      localTerminalEndpoint.killTerminal(ID),
    ]);

    expect(killed.ids).toEqual([ID]);
  });
});
