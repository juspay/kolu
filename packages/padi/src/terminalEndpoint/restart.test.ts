/**
 * `lifecycle.restart` — a fresh PTY for an ACTIVE terminal, IN PLACE.
 *
 * Restart is sleep's flip (persisted, as a sleep persists it) + a kill, then
 * wake's respawn on the same id. What these pin is the promise to the canvas and
 * to the user:
 *   - the id, the cwd and everything authored (layout, parent edge, theme,
 *     intent) survive; the terminal's scratch survives; the old PTY is killed and
 *     a new one spawned, and the call resolves only once it is;
 *   - the new PTY gets the agents a NEW terminal gets — the record is re-stamped
 *     (its one `agents` struct) from the current setting;
 *   - a live agent's conversation resumes only while agents stay on; with agents
 *     now off it comes back as a bare shell;
 *   - races and failures say what really happened: a refused id touches
 *     nothing; a wake or discard that wins the id during the kill is answered
 *     with what holds it now; a kill that fails with the PTY still alive puts
 *     the record back on that PTY and throws; a failed respawn throws with the
 *     tile asleep; and a restarted terminal sleeps like any other.
 *
 * The pty-host is stubbed (no kaval in the unit env), recording kills, the
 * spawn input, the bytes written, and what `terminal.list` answers — the seam
 * `sleepWakeRace.test.ts` uses. The session save is stubbed too (it writes the
 * real state root); the test records that it ran, and when.
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentDistroSettingStore } from "../agentDistro/agentDistro.ts";
import {
  __setAgentDistroBakeForTest,
  type AgentDistroBake,
} from "../agentDistro/bake.ts";
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
import {
  requireAttachableTerminal,
  restartTerminal,
  sleepTerminal,
} from "../terminals.ts";
import { discardLocalSleeping, wakeLocalTerminal } from "./local.ts";
import { installSnapshot } from "./metadata.ts";
import { activeEntry } from "./terminalFixtures.testlib.ts";

const calls = vi.hoisted(() => ({
  /** Every recorded event, in order: `save`, `kill:<id>`, `spawn:<cwd>`. */
  log: [] as string[],
  writes: [] as string[],
  killFails: false,
  spawnFails: false,
  /** What `terminal.list` answers (ids of live PTYs). */
  listed: [] as string[],
  /** Runs inside the kill, after it is recorded — holds the kill open. */
  killGate: undefined as undefined | (() => Promise<void>),
}));

const NEW_PID = 9191;

vi.mock("../session/session.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/session.ts")>();
  return {
    ...actual,
    saveSession: () => {
      calls.log.push("save");
    },
  };
});

vi.mock("../ptyHost/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ptyHost/index.ts")>();
  const { Effect } = await import("effect");
  const { emptySensorTaps } = await import("./sensorTaps.testlib.ts");
  return {
    ...actual,
    buildTerminalSpawnInput: (args: { cwd?: string }) =>
      Effect.sync(() => {
        calls.log.push(`spawn:${args.cwd}`);
        return {} as never;
      }),
    ptyHostClient: {
      surface: {
        terminal: {
          kill: ({ id }: { id: string }) =>
            Effect.promise(async () => {
              calls.log.push(`kill:${id}`);
              await calls.killGate?.();
            }).pipe(
              Effect.flatMap(() =>
                calls.killFails
                  ? Effect.fail(new Error("terminate timed out"))
                  : Effect.void,
              ),
            ),
          list: () =>
            Effect.sync(() => ({
              entries: calls.listed.map((id) => ({
                id,
                pid: 4242,
                cwd: "/work/repo",
              })),
            })),
          write: ({ data }: { data: string }) =>
            Effect.sync(() => {
              calls.writes.push(data);
            }),
          spawn: () =>
            calls.spawnFails
              ? Effect.fail(new Error("spawn refused"))
              : Effect.succeed({ pid: NEW_PID, cwd: "/work/repo" }),
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

let root: string;
let savedStateHome: string | undefined;

/** A floor with both profiles, as a baked padi has it. */
function bake(): AgentDistroBake {
  const floor = join(root, "floor");
  mkdirSync(join(floor, "profiles"), { recursive: true });
  for (const p of ["vanilla", "juspay"]) {
    const target = join(root, `store-${p}-kolu`);
    mkdirSync(join(target, "bin"), { recursive: true });
    symlinkSync(target, join(floor, "profiles", p));
  }
  // The floor as its manifest names it: each profile's dir is a link (as a
  // store profile dir is reached), so the resolved path is what gets pinned.
  const manifest = {
    default: "vanilla",
    picker: join(floor, "picker"),
    profiles: ["vanilla", "juspay"].map((name) => ({
      name,
      dir: join(floor, "profiles", name),
      bin: join(floor, "profiles", name, "bin"),
      hash: name,
    })),
  };
  // The updater config names the profile's state dir (where a host's `current`
  // would live), under the placeholder padi makes concrete per host.
  // Each profile's updater config, already made concrete for this host (as the
  // bake reader does once), and the state dir it names.
  const profile = (name: string) => {
    const stateDir = join(root, "state", "agent-distro", name);
    return {
      name,
      command: ["/bin/false"],
      configText: JSON.stringify({
        state: stateDir,
        history: join(root, "state", "agent-distro", "history.log"),
      }),
      stateDir,
    };
  };
  return {
    floor: manifest,
    plugins: "/p/plugin",
    profiles: new Map([
      ["vanilla", profile("vanilla")],
      ["juspay", profile("juspay")],
    ]),
  };
}

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  root = realpathSync(mkdtempSync(join(tmpdir(), "restart-test-")));
  // The host's own `current` would win over the floor; keep it in the sandbox.
  savedStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(root, "state");
  __setAgentDistroBakeForTest(bake());
  agentDistroSettingStore.set({ enabled: true, profile: "juspay" });
  calls.log = [];
  calls.writes = [];
  calls.killFails = false;
  calls.spawnFails = false;
  calls.listed = [];
  calls.killGate = undefined;
});

afterEach(() => {
  unregisterTerminal(ID);
  rmSync(join(koluScratchDir(), ID), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  if (savedStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedStateHome;
  __setAgentDistroBakeForTest(undefined);
  agentDistroSettingStore.set({ enabled: false, profile: "vanilla" });
  __resetPadiSurfaceCtxForTest();
});

/** An active terminal spawned under vanilla, with authored chrome worth
 *  keeping and a live agent (the fixture's `exact` restore target). */
function seedVanillaTerminal(): void {
  const entry = activeEntry(ID);
  registerTerminal(ID, {
    ...entry,
    meta: {
      ...entry.meta,
      parentId: PARENT,
      canvasLayout: LAYOUT,
      agents: { profile: "vanilla", bundle: join(root, "store-vanilla-kolu") },
    },
  });
  installSnapshot(ID);
}

function activeMeta() {
  const entry = getTerminal(ID);
  if (entry?.meta.state !== "active") throw new Error("expected active");
  return entry.meta;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("restart — a new PTY in place", () => {
  it("keeps id, cwd, layout, parent, theme, intent and scratch; saves, kills, then spawns — and resolves on the new pid", async () => {
    seedVanillaTerminal();
    const pasted = saveTerminalFile(
      ID,
      "pasted.png",
      Buffer.from("not read yet").toString("base64"),
    );

    const restarted = await restartTerminal(ID);

    expect(restarted?.info).toEqual({ id: ID, pid: NEW_PID });
    expect(calls.log).toEqual(["save", `kill:${ID}`, "spawn:/work/repo"]);
    const meta = activeMeta();
    expect(meta.parentId).toBe(PARENT);
    expect(meta.canvasLayout).toEqual(LAYOUT);
    expect(meta.themeName).toBe("rose");
    expect(meta.intent).toBe("fix the auth race");
    expect(getTerminal(ID)?.snapshot.cwd).toBe("/work/repo");
    expect(existsSync(pasted)).toBe(true);
  });

  it("re-stamps the agents a new terminal gets now", async () => {
    seedVanillaTerminal();
    await restartTerminal(ID);
    expect(activeMeta().agents).toEqual({
      profile: "juspay",
      bundle: join(root, "store-juspay-kolu"),
    });
  });

  it("agents on: the live agent's conversation resumes, and padi says so", async () => {
    seedVanillaTerminal();
    expect((await restartTerminal(ID))?.resumed).toBe(true);
    await vi.waitFor(() => expect(calls.writes.length).toBe(1));
  });

  it("agents now off: a bare shell — no agents, nothing replayed", async () => {
    agentDistroSettingStore.set({ enabled: false, profile: "juspay" });
    seedVanillaTerminal();
    expect((await restartTerminal(ID))?.resumed).toBe(false);
    expect(activeMeta().agents).toBeUndefined();
    expect(calls.writes).toEqual([]);
  });

  it("refuses an id that is not an active terminal, touching nothing", async () => {
    expect(await restartTerminal(ID)).toBeUndefined();
    expect(calls.log).toEqual([]);
  });

  it("a failed kill with the PTY still alive: the record goes back on it, and it throws", async () => {
    seedVanillaTerminal();
    calls.killFails = true;
    calls.listed = [ID];

    await expect(restartTerminal(ID)).rejects.toThrow(/would not stop/);
    expect(getTerminal(ID)?.meta.state).toBe("active");
    expect(activeMeta().agents?.profile).toBe("vanilla");
    expect(calls.log.some((e) => e.startsWith("spawn:"))).toBe(false);
  });

  it("a failed kill with the PTY gone: the restart goes on", async () => {
    seedVanillaTerminal();
    calls.killFails = true;

    expect((await restartTerminal(ID))?.info.pid).toBe(NEW_PID);
    expect(activeMeta().agents?.profile).toBe("juspay");
  });

  it("a wake that wins the id during the kill: answered with the woken terminal, spawned once", async () => {
    seedVanillaTerminal();
    const killStarted = deferred();
    const hold = deferred();
    calls.killGate = () => {
      killStarted.resolve();
      return hold.promise;
    };

    const restart = restartTerminal(ID);
    await killStarted.promise;
    expect(wakeLocalTerminal(ID)?.id).toBe(ID);
    hold.resolve();

    expect((await restart)?.info.id).toBe(ID);
    expect(calls.log.filter((e) => e.startsWith("spawn:"))).toHaveLength(1);
  });

  it("a discard that wins the id during the kill: answered with nothing", async () => {
    seedVanillaTerminal();
    const killStarted = deferred();
    const hold = deferred();
    calls.killGate = () => {
      killStarted.resolve();
      return hold.promise;
    };

    const restart = restartTerminal(ID);
    await killStarted.promise;
    expect(discardLocalSleeping(ID)).toBe(true);
    hold.resolve();

    expect(await restart).toBeUndefined();
    expect(calls.log.some((e) => e.startsWith("spawn:"))).toBe(false);
  });

  it("a respawn that fails: it throws, and the tile is asleep to wake", async () => {
    seedVanillaTerminal();
    calls.spawnFails = true;

    await expect(restartTerminal(ID)).rejects.toThrow(/did not start/);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });

  it("a restarted terminal sleeps like any other", async () => {
    seedVanillaTerminal();
    await restartTerminal(ID);
    await sleepTerminal(ID);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
    expect(calls.log.filter((e) => e === `kill:${ID}`)).toHaveLength(2);
  });
});

describe("an attach during a restart", () => {
  /** Start a restart and hold it inside the kill, with the record sleeping. */
  async function holdRestartInKill() {
    seedVanillaTerminal();
    const killStarted = deferred();
    const hold = deferred();
    calls.killGate = () => {
      killStarted.resolve();
      return hold.promise;
    };
    const restart = restartTerminal(ID);
    await killStarted.promise;
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
    return { restart, release: hold.resolve };
  }

  it("waits out the dormant middle, then opens the NEW PTY — never 'the terminal is gone'", async () => {
    const { restart, release } = await holdRestartInKill();
    let settled = false;
    const attachable = requireAttachableTerminal(ID).then((entry) => {
      settled = true;
      return entry;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await restart;
    const entry = await attachable;
    expect(entry.meta.state).toBe("active");
    expect(entry.info.pid).toBe(NEW_PID);
  });

  it("a restart whose respawn fails: the waiting attach gets the ordinary not-found", async () => {
    calls.spawnFails = true;
    const { restart, release } = await holdRestartInKill();
    const attachable = requireAttachableTerminal(ID);
    release();
    await expect(restart).rejects.toThrow(/did not start/);
    await expect(attachable).rejects.toMatchObject({
      _tag: "TerminalNotFound",
    });
  });

  it("outside a restart nothing waits: a sleeping or absent id is not attachable", async () => {
    await expect(requireAttachableTerminal(ID)).rejects.toMatchObject({
      _tag: "TerminalNotFound",
    });
    seedVanillaTerminal();
    await sleepTerminal(ID);
    await expect(requireAttachableTerminal(ID)).rejects.toMatchObject({
      _tag: "TerminalNotFound",
    });
  });
});
