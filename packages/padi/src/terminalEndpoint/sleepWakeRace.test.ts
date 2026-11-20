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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function uniqueScratchDaemonId(): string {
  return `sleep-wake-race-${randomUUID()}`;
}

setDaemonProcessId(uniqueScratchDaemonId());

const scratchDir = join(koluScratchDir(), ID);
let pastedFile = "";

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  killed.ids = [];
  spawned.ids = [];
  killGate.value = undefined;
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

    const release = releaseSleptLocalPty(ID);
    await killStarted.promise;

    const waking = wakeLocalTerminal(ID);
    expect(getTerminal(ID)?.meta.state).toBe("active");

    holdKill.resolve();
    await release;

    expect(existsSync(pastedFile)).toBe(true);
    expect(getTerminal(ID)?.meta.state).toBe("active");

    await waking;
    await vi.waitFor(() => {
      expect(getTerminal(ID)?.info.pid).toBe(WOKEN_PID);
    });
    expect(spawned.ids).toEqual([ID]);
    expect(existsSync(pastedFile)).toBe(true);
  });

  it("still scrubs when the id stays dormant — the ordinary sleep", async () => {
    seedActiveTerminal(ID);
    expect(beginSleepLocal(ID)).toBe(true);

    await releaseSleptLocalPty(ID);

    expect(killed.ids).toEqual([ID]);
    expect(existsSync(pastedFile)).toBe(false);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });
});
