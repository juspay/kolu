/**
 * `lifecycle.restart` — a fresh PTY for an ACTIVE terminal, IN PLACE.
 *
 * Restart is sleep's flip + kill followed by wake's respawn on the same id, so
 * what these pin is the composition's promise to the canvas: the id, the cwd,
 * and everything authored (layout, parent edge, theme, intent) survive; the old
 * PTY is killed and a new one spawned; and what is not an active terminal is
 * refused rather than half-restarted. Unlike a sleep it keeps the terminal's
 * scratch (a pasted image the agent has not read yet).
 *
 * The pty-host is stubbed (no kaval in the unit env), recording each kill and
 * the spawn input it was handed — the same seam `sleepWakeRace.test.ts` uses.
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
import {
  getTerminal,
  registerTerminal,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { saveTerminalFile } from "../terminalScratch.ts";
import { restartLocalTerminal } from "./local.ts";
import { installSnapshot } from "./metadata.ts";
import { activeEntry } from "./terminalFixtures.testlib.ts";

const calls = vi.hoisted(() => ({
  killed: [] as string[],
  spawnedCwds: [] as (string | undefined)[],
  killFails: false,
}));

const NEW_PID = 9191;

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { Effect } = await import("effect");
  const { emptySensorTaps } = await import("./sensorTaps.testlib.ts");
  return {
    ...actual,
    // Record the cwd the respawn asks for; the rest of the spawn input is the
    // daemon's boot-injected facts, unset (and irrelevant) in a unit env.
    buildTerminalSpawnInput: (args: { cwd?: string }) =>
      Effect.sync(() => {
        calls.spawnedCwds.push(args.cwd);
        return {} as never;
      }),
    ptyHostClient: {
      surface: {
        terminal: {
          kill: ({ id }: { id: string }) =>
            calls.killFails
              ? Effect.fail(new Error("pty-host unreachable"))
              : Effect.sync(() => {
                  calls.killed.push(id);
                }),
          write: () => Effect.void,
          spawn: () => Effect.succeed({ pid: NEW_PID, cwd: "/work/repo" }),
        },
        ...emptySensorTaps(),
      },
    },
  };
});

setDaemonProcessId(`restart-${randomUUID()}`);

const ID = "44444444-4444-4444-8444-444444444444";
const PARENT = "55555555-5555-4555-8555-555555555555";
const LAYOUT = { x: 120, y: 80, w: 640, h: 400 };

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  calls.killed = [];
  calls.spawnedCwds = [];
  calls.killFails = false;
});

afterEach(() => {
  unregisterTerminal(ID);
  rmSync(join(koluScratchDir(), ID), { recursive: true, force: true });
  __resetPadiSurfaceCtxForTest();
});

/** An active terminal with authored chrome worth keeping: a parent edge and a
 *  canvas position on top of the fixture's theme + intent. */
function seedChromedTerminal(): void {
  const entry = activeEntry(ID);
  registerTerminal(ID, {
    ...entry,
    meta: { ...entry.meta, parentId: PARENT, canvasLayout: LAYOUT },
  });
  installSnapshot(ID);
}

describe("restart — a new PTY in place", () => {
  it("keeps the id, cwd, layout, parent, theme and intent; kills the old PTY and spawns a new one", async () => {
    seedChromedTerminal();
    const pasted = saveTerminalFile(
      ID,
      "pasted.png",
      Buffer.from("not read yet").toString("base64"),
    );

    const info = await restartLocalTerminal(ID);

    expect(info?.id).toBe(ID);
    expect(calls.killed).toEqual([ID]);
    expect(calls.spawnedCwds).toEqual(["/work/repo"]);
    const entry = getTerminal(ID);
    if (entry?.meta.state !== "active") throw new Error("expected active");
    expect(entry.meta.parentId).toBe(PARENT);
    expect(entry.meta.canvasLayout).toEqual(LAYOUT);
    expect(entry.meta.themeName).toBe("rose");
    expect(entry.meta.intent).toBe("fix the auth race");
    expect(entry.snapshot.cwd).toBe("/work/repo");
    await vi.waitFor(() => expect(getTerminal(ID)?.info.pid).toBe(NEW_PID));
    // Only the process ends — the terminal's scratch stays.
    expect(existsSync(pasted)).toBe(true);
  });

  it("refuses an id that is not an active terminal, touching nothing", async () => {
    expect(await restartLocalTerminal(ID)).toBeUndefined();
    expect(calls.killed).toEqual([]);
    expect(calls.spawnedCwds).toEqual([]);
  });

  it("fails loud when the old PTY cannot be killed, leaving the record sleeping", async () => {
    seedChromedTerminal();
    calls.killFails = true;

    await expect(restartLocalTerminal(ID)).rejects.toThrow();
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
    expect(calls.spawnedCwds).toEqual([]);
  });
});
