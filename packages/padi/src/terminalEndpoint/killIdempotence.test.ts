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
              await delay(20);
            }),
        },
        ...emptySensorTaps(),
      },
    },
  };
});

const ID = "22222222-2222-4222-8222-222222222222";

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

    const claimed = observed.filter((answer) => answer.info !== undefined);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.info?.id).toBe(ID);
    const loser = observed.find((answer) => answer.info === undefined);
    expect(loser).toBeDefined();
    expect(loser?.stillRegistered).toBe(false);

    expect(killed.ids).toEqual([ID]);
    expect(getTerminal(ID)).toBeUndefined();
  });
});
