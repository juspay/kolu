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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DeliveredProfile } from "@kolu/agent-distro/landing";
import { builtProfileFiles } from "@kolu/agent-distro/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentDistroSettingStore,
  onAgentDistroReport,
} from "../agentDistro/agentDistro.ts";
import {
  __setAgentDistroBakeForTest,
  type AgentDistroBake,
} from "../agentDistro/bake.ts";
import {
  __resetAgentDistroDeliveriesForTest,
  landDelivery,
} from "../agentDistro/deliveries.ts";
import { koluScratchDir, setDaemonProcessId } from "../koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import {
  getTerminal,
  registerTerminal,
  snapshotFor,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { saveTerminalFile } from "../terminalScratch.ts";
import {
  requireAttachableTerminal,
  restartTerminal,
  sleepTerminal,
} from "../terminals.ts";
import {
  beginSleepLocal,
  discardLocalSleeping,
  wakeLocalTerminal,
} from "./local.ts";
import { installSnapshot } from "./metadata.ts";
import { activeEntry } from "./terminalFixtures.testlib.ts";

const calls = vi.hoisted(() => ({
  /** Every recorded event, in order: `save`, `kill:<id>`, `spawn:<cwd>`. */
  log: [] as string[],
  /** Spawned terminal ids, in order — the order assertions the cwd log cannot
   *  carry when a family shares one cwd. */
  spawns: [] as string[],
  writes: [] as string[],
  killFails: false,
  spawnFails: false,
  /** Terminals whose respawn must fail — the per-member arm of `spawnFails`. */
  spawnFailsFor: [] as string[],
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
    buildTerminalSpawnInput: (args: { id: string; cwd?: string }) =>
      Effect.sync(() => {
        calls.log.push(`spawn:${args.cwd}`);
        calls.spawns.push(args.id);
        // The id rides through: the spawn mock below fails per-terminal, and the
        // real input always names the terminal it is spawning.
        return { id: args.id } as never;
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
          spawn: (input: { id: string }) =>
            calls.spawnFails || calls.spawnFailsFor.includes(input.id)
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
/** A split of `ID` — the family's second member. */
const CHILD = "66666666-6666-4666-8666-666666666666";
/** A grandchild under CHILD — the 3-deep family a restart must not leave half-awake. */
const GRAND = "77777777-7777-4777-8777-777777777777";
const LAYOUT = { x: 120, y: 80, w: 640, h: 400 };

let root: string;
let savedStateHome: string | undefined;

const JUSPAY = "github:juspay/skills";

/** The package on the floor (what the terminal was spawned with), and the set
 *  kolu-server landed since for the setting's stack. */
const floorPackage = () => join(root, "store", "floor-package");
const deliveredPackage = () => join(root, "store", "delivered-package");
const juspay = (): DeliveredProfile => ({
  reference: JUSPAY,
  name: "juspay",
  rev: "a1b2c3d4e5f6",
  path: join(root, "store", "profile-juspay"),
});

/** A baked padi with its floor (reached through a link, as a store path is),
 *  and the juspay set landed on it. */
function bake(): AgentDistroBake {
  for (const dir of [floorPackage(), deliveredPackage()])
    mkdirSync(join(dir, "bin"), { recursive: true });
  for (const [path, text] of Object.entries(
    builtProfileFiles(juspay().path, { name: "juspay", description: "" }),
  )) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  const floorLink = join(root, "floor");
  symlinkSync(floorPackage(), floorLink);
  const state = join(root, "state");
  const b: AgentDistroBake = {
    floor: { dir: floorLink, bin: join(floorLink, "bin") },
    plugins: "/p/plugin",
    stateDir: join(state, "agent-distro", "package"),
    historyFile: join(state, "agent-distro", "history.log"),
    landedFile: join(state, "kolu", "agent-distro-landed.json"),
    gcRootsDir: join(root, "home", "gcroots"),
  };
  landDelivery(b, {
    bundle: deliveredPackage(),
    profiles: [juspay()],
  });
  return b;
}

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  root = realpathSync(mkdtempSync(join(tmpdir(), "restart-test-")));
  // The host's own `current` would win over the floor; keep it in the sandbox.
  savedStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(root, "state");
  __setAgentDistroBakeForTest(bake());
  agentDistroSettingStore.set({ enabled: true, profiles: [JUSPAY] });
  calls.log = [];
  calls.spawns = [];
  calls.writes = [];
  calls.killFails = false;
  calls.spawnFails = false;
  calls.spawnFailsFor = [];
  calls.listed = [];
  calls.killGate = undefined;
});

afterEach(() => {
  unregisterTerminal(ID);
  unregisterTerminal(CHILD);
  unregisterTerminal(GRAND);
  rmSync(join(koluScratchDir(), ID), { recursive: true, force: true });
  rmSync(join(koluScratchDir(), CHILD), { recursive: true, force: true });
  rmSync(join(koluScratchDir(), GRAND), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  if (savedStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedStateHome;
  __setAgentDistroBakeForTest(undefined);
  __resetAgentDistroDeliveriesForTest();
  agentDistroSettingStore.set({ enabled: false, profiles: [] });
  __resetPadiSurfaceCtxForTest();
});

/** An active terminal spawned on the floor's package with no profile, with authored chrome worth
 *  keeping and a live agent (the fixture's `exact` restore target). */
function seedTerminal(): void {
  const entry = activeEntry(ID);
  registerTerminal(ID, {
    ...entry,
    meta: {
      ...entry.meta,
      parentId: PARENT,
      canvasLayout: LAYOUT,
      agents: { bundle: floorPackage(), profiles: [] },
    },
  });
  installSnapshot(ID);
}

function activeMeta() {
  const entry = getTerminal(ID);
  if (entry?.meta.state !== "active") throw new Error("expected active");
  return entry.meta;
}

/** `ID` plus an active split under it — the family the four lifecycle verbs
 *  move together. `PARENT` above `ID` is deliberately absent, so the family is
 *  exactly [ID, CHILD]. */
function seedFamily(): void {
  seedTerminal();
  const child = activeEntry(CHILD);
  registerTerminal(CHILD, {
    ...child,
    meta: { ...child.meta, parentId: ID },
  });
  installSnapshot(CHILD);
}

/** The active meta of the split, or a loud failure — the type-narrowing twin of
 *  {@link activeMeta}. */
function activeChildMeta() {
  const entry = getTerminal(CHILD);
  if (entry?.meta.state !== "active") throw new Error("expected active split");
  return entry.meta;
}

/** `ID` live with a split that was slept ON ITS OWN and a grandchild under that
 *  split, also dormant — the mixed family a restart has to bring back as one
 *  tree (and must not leave with a live grandchild under a sleeping split). */
function seedDormantBranch(): void {
  seedTerminal();
  const child = activeEntry(CHILD);
  registerTerminal(CHILD, {
    ...child,
    meta: { ...child.meta, parentId: ID },
  });
  installSnapshot(CHILD);
  const grand = activeEntry(GRAND);
  registerTerminal(GRAND, {
    ...grand,
    meta: { ...grand.meta, parentId: CHILD },
  });
  installSnapshot(GRAND);
  // Leaves-first, as a family sleep is: the grandchild sleeps before the split.
  expect(beginSleepLocal(GRAND)).toBe(true);
  expect(beginSleepLocal(CHILD)).toBe(true);
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
    seedTerminal();
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
    seedTerminal();
    await restartTerminal(ID);
    expect(activeMeta().agents).toEqual({
      bundle: deliveredPackage(),
      profiles: [juspay()],
    });
  });

  it.each([
    ["a delivery in flight", { kind: "delivering", profiles: [JUSPAY] }],
    [
      "a failed delivery",
      {
        kind: "failed",
        profiles: [JUSPAY],
        message: "nix copy exit 1",
      },
    ],
  ] as const)("a host with %s keeps serving the set on disk: the new PTY gets it", async (_, report) => {
    onAgentDistroReport(report);
    seedTerminal();
    await restartTerminal(ID);
    expect(activeMeta().agents).toEqual({
      bundle: deliveredPackage(),
      profiles: [juspay()],
    });
  });

  it("agents on: the live agent's conversation resumes, and padi says so", async () => {
    seedTerminal();
    expect((await restartTerminal(ID))?.resumed).toBe(true);
    await vi.waitFor(() => expect(calls.writes.length).toBe(1));
  });

  it("agents now off: a bare shell — no agents, nothing replayed", async () => {
    agentDistroSettingStore.set({ enabled: false, profiles: [JUSPAY] });
    seedTerminal();
    expect((await restartTerminal(ID))?.resumed).toBe(false);
    expect(activeMeta().agents).toBeUndefined();
    expect(calls.writes).toEqual([]);
  });

  it("refuses an id that is not an active terminal, touching nothing", async () => {
    expect(await restartTerminal(ID)).toBeUndefined();
    expect(calls.log).toEqual([]);
  });

  it("a failed kill with the PTY still alive: the record goes back on it, and it throws", async () => {
    seedTerminal();
    calls.killFails = true;
    calls.listed = [ID];

    await expect(restartTerminal(ID)).rejects.toThrow(/would not stop/);
    expect(getTerminal(ID)?.meta.state).toBe("active");
    expect(activeMeta().agents?.bundle).toBe(floorPackage());
    expect(calls.log.some((e) => e.startsWith("spawn:"))).toBe(false);
  });

  it("a failed kill with the PTY gone: the restart goes on", async () => {
    seedTerminal();
    calls.killFails = true;

    expect((await restartTerminal(ID))?.info.pid).toBe(NEW_PID);
    expect(activeMeta().agents?.profiles).toEqual([juspay()]);
  });

  it("a wake that wins the id during the kill: answered with the woken terminal, spawned once", async () => {
    seedTerminal();
    const killStarted = deferred();
    const hold = deferred();
    calls.killGate = () => {
      killStarted.resolve();
      return hold.promise;
    };

    const restart = restartTerminal(ID);
    await killStarted.promise;
    expect((await wakeLocalTerminal(ID))?.id).toBe(ID);
    hold.resolve();

    const answered = await restart;
    expect(answered?.info.id).toBe(ID);
    // The wake that won replayed the live agent's conversation; padi says so.
    expect(answered?.resumed).toBe(true);
    expect(calls.log.filter((e) => e.startsWith("spawn:"))).toHaveLength(1);
  });

  it("a discard that wins the id during the kill: answered with nothing", async () => {
    seedTerminal();
    const killStarted = deferred();
    const hold = deferred();
    calls.killGate = () => {
      killStarted.resolve();
      return hold.promise;
    };

    const restart = restartTerminal(ID);
    await killStarted.promise;
    expect(discardLocalSleeping(ID)).toBe("discarded");
    hold.resolve();

    expect(await restart).toBeUndefined();
    expect(calls.log.some((e) => e.startsWith("spawn:"))).toBe(false);
  });

  it("a respawn that fails: it throws, and the tile is asleep to wake", async () => {
    seedTerminal();
    calls.spawnFails = true;

    await expect(restartTerminal(ID)).rejects.toThrow(/did not start/);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
  });

  it("a restarted terminal sleeps like any other", async () => {
    seedTerminal();
    await restartTerminal(ID);
    await sleepTerminal(ID);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
    expect(calls.log.filter((e) => e === `kill:${ID}`)).toHaveLength(2);
  });
});

describe("an attach during a restart", () => {
  /** Start a restart and hold it inside the kill, with the record sleeping. */
  async function holdRestartInKill() {
    seedTerminal();
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
    seedTerminal();
    await sleepTerminal(ID);
    await expect(requireAttachableTerminal(ID)).rejects.toMatchObject({
      _tag: "TerminalNotFound",
    });
  });
});

describe("the family walk — a terminal and its splits move together", () => {
  it("sleeps every member leaves-first, saving ONCE, then releases each PTY", async () => {
    seedFamily();

    await sleepTerminal(ID);

    // One snapshot names the whole family asleep — N saves would persist a
    // half-slept tree (the parent frozen, a child still live).
    expect(calls.log.filter((e) => e === "save")).toHaveLength(1);
    // Leaves first: the split's PTY is released before its parent's, so no
    // live child can sit under a fragment that already froze.
    expect(calls.log.filter((e) => e.startsWith("kill:"))).toEqual([
      `kill:${CHILD}`,
      `kill:${ID}`,
    ]);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
    expect(getTerminal(CHILD)?.meta.state).toBe("sleeping");
    // The split's parent edge rides the freeze, so restore and wake know whose
    // sub-panel it belongs to.
    expect(getTerminal(CHILD)?.meta.parentId).toBe(ID);
  });

  it("wakes a dormant family roots-first, and the split comes back under its parent", async () => {
    seedFamily();
    await sleepTerminal(ID);
    calls.log = [];
    calls.spawns = [];

    expect((await wakeLocalTerminal(ID))?.id).toBe(ID);

    expect(calls.spawns).toEqual([ID, CHILD]);
    expect(getTerminal(ID)?.meta.state).toBe("active");
    expect(activeChildMeta().parentId).toBe(ID);
  });

  it("waking a split under a dormant parent brings the parent back first", async () => {
    seedFamily();
    await sleepTerminal(ID);
    calls.spawns = [];

    expect((await wakeLocalTerminal(CHILD))?.id).toBe(CHILD);

    // The climb found the sleeping parent, and the subtree woke roots-first.
    expect(calls.spawns).toEqual([ID, CHILD]);
    expect(getTerminal(ID)?.meta.state).toBe("active");
    expect(activeChildMeta().parentId).toBe(ID);
  });

  it("a failed split wake leaves the parent live and the split asleep to retry", async () => {
    seedFamily();
    await sleepTerminal(ID);
    calls.spawnFailsFor = [CHILD];

    await wakeLocalTerminal(ID);

    expect(getTerminal(CHILD)?.meta.state).toBe("sleeping");
    expect(getTerminal(ID)?.meta.state).toBe("active");
    // The sleeping record kept its parent edge, so the retry climbs the same way.
    expect(getTerminal(CHILD)?.meta.parentId).toBe(ID);
  });

  it("a failed PARENT wake skips its subtree — no live split under a dormant tile", async () => {
    seedFamily();
    await sleepTerminal(ID);
    calls.spawns = [];
    calls.spawnFailsFor = [ID];

    // The parent's wire fails, so its sleeping record is restored and the child
    // is never even attempted: a child spawning now would be a live PTY under a
    // tile with no PTY, which every client gate forbids.
    expect((await wakeLocalTerminal(ID))?.id).toBe(ID);

    expect(calls.spawns).toEqual([ID]);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
    expect(getTerminal(CHILD)?.meta.state).toBe("sleeping");
    expect(getTerminal(CHILD)?.meta.parentId).toBe(ID);
  });

  it("an aborted family restart releases every member it flipped but never replanted", async () => {
    seedFamily();
    const pasted = saveTerminalFile(
      ID,
      "pasted.png",
      Buffer.from("the agent has not read this yet").toString("base64"),
    );
    calls.log = [];
    calls.spawns = [];
    // The PARENT is the first member the respawn walk reaches, so the child has
    // been flipped to sleeping by the sleep walk and not yet replanted.
    calls.spawnFailsFor = [ID];

    await expect(restartTerminal(ID)).rejects.toThrow(/did not start/);

    // The child's original PTY is still alive at this point (`beginSleep` leaves
    // it so; the kill is `restartSlept`'s job), so the abort path must release it
    // — otherwise a later Wake double-spawns on that id.
    expect(calls.log.filter((e) => e === `kill:${CHILD}`)).toHaveLength(1);
    // The FAILING member is NOT released: `restartSlept` already killed its PTY,
    // so a second kill would aim at a PTY the host no longer has — and the
    // release's tail would scrub the scratch a restart promises to keep.
    expect(calls.log.filter((e) => e === `kill:${ID}`)).toHaveLength(1);
    expect(existsSync(pasted)).toBe(true);
    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
    expect(getTerminal(CHILD)?.meta.state).toBe("sleeping");
  });

  it("a dormant branch whose wake fails keeps its OWN descendants asleep", async () => {
    seedDormantBranch();
    calls.log = [];
    calls.spawns = [];
    // The split (dormant before the restart) fails to wire; its grandchild must
    // NOT be woken after it — a live PTY under a dormant split is the invariant
    // every client gate forbids.
    calls.spawnFailsFor = [CHILD];

    const restarted = await restartTerminal(ID);

    expect(restarted?.info.id).toBe(ID);
    // The tile restarted, the dormant branch was woken once, and the grandchild
    // was never attempted.
    expect(calls.spawns).toEqual([ID, CHILD]);
    expect(getTerminal(ID)?.meta.state).toBe("active");
    expect(getTerminal(CHILD)?.meta.state).toBe("sleeping");
    expect(getTerminal(GRAND)?.meta.state).toBe("sleeping");
    expect(getTerminal(GRAND)?.meta.parentId).toBe(CHILD);
  });

  it("restarts the family in place, parent first, saving ONCE", async () => {
    seedFamily();
    calls.log = [];
    calls.spawns = [];

    const restarted = await restartTerminal(ID);

    expect(restarted?.info.id).toBe(ID);
    expect(calls.log.filter((e) => e === "save")).toHaveLength(1);
    expect(calls.log.filter((e) => e.startsWith("kill:"))).toEqual([
      `kill:${ID}`,
      `kill:${CHILD}`,
    ]);
    expect(calls.spawns).toEqual([ID, CHILD]);
    expect(getTerminal(ID)?.meta.state).toBe("active");
    expect(activeChildMeta().parentId).toBe(ID);
  });

  it("discards the whole dormant subtree — children first", async () => {
    seedFamily();
    await sleepTerminal(ID);

    expect(discardLocalSleeping(ID)).toBe("discarded");

    expect(getTerminal(ID)).toBeUndefined();
    expect(getTerminal(CHILD)).toBeUndefined();
    expect(snapshotFor(ID)).toBeUndefined();
    expect(snapshotFor(CHILD)).toBeUndefined();
  });

  it("discarding an ACTIVE parent touches nothing — its dormant split included", async () => {
    seedFamily();
    expect(beginSleepLocal(CHILD)).toBe(true);

    expect(discardLocalSleeping(ID)).toBe("nothing");

    expect(getTerminal(ID)?.meta.state).toBe("active");
    expect(getTerminal(CHILD)?.meta.state).toBe("sleeping");
    expect(getTerminal(CHILD)?.meta.parentId).toBe(ID);
  });

  it("refuses a MIXED family — a dormant parent with a live descendant", async () => {
    seedFamily();
    // Parent asleep, split live: discarding the parent would leave a running
    // terminal whose parentId names a removed record — the orphan class the
    // session restore refuses on every boot. The close paths route per arm, so
    // this refusal is the fail-fast guard, and it touches NOTHING.
    expect(beginSleepLocal(ID)).toBe(true);
    expect(getTerminal(CHILD)?.meta.state).toBe("active");

    expect(discardLocalSleeping(ID)).toBe("refused");

    expect(getTerminal(ID)?.meta.state).toBe("sleeping");
    expect(getTerminal(CHILD)?.meta.state).toBe("active");
    expect(getTerminal(CHILD)?.meta.parentId).toBe(ID);
    expect(snapshotFor(ID)).toBeDefined();
    expect(snapshotFor(CHILD)).toBeDefined();
  });
});
