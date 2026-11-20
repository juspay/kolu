import * as assert from "node:assert";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { paneSelector } from "../support/daemonScreen.ts";
import {
  installResizeWireProbe,
  quoteResizeWire,
  readAttachCounts,
  readPanelWrites,
} from "../support/resizeWire.ts";
import { pollFor } from "../support/poll.ts";
import { padiCall } from "../support/rpcWire.ts";
import {
  formatWinsizes,
  readWinsizes,
  removeRecorderScript,
  startRecorder,
  type Winsize,
} from "../support/winsizeRecorder.ts";
import {
  CANVAS_TILE_SELECTOR,
  GRID_ROUND_TRIP_MS,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const SETTLE_BUDGET_MS = POLL_TIMEOUT;

const SAMPLE_MS = 250;

const MAIN_PANE = "[data-visible][data-font-size]:not([data-sub-terminal])";

const ANY_PANE = "[data-terminal-id][data-font-size]";

interface Recorded {
  label: string;
  baseline: Winsize[];
}

interface MarkedPane {
  id: string;
  label: string;
  marker: string;
  attaches: number;
}

interface MountSizeState {
  recorded: Map<string, Recorded>;
  marked: MarkedPane[];
  coveredBefore?: { id: string; label: string };
  lastMaximized?: string;
}

const stateByWorld = new WeakMap<KoluWorld, MountSizeState>();

function mountSizeState(world: KoluWorld): MountSizeState {
  let state = stateByWorld.get(world);
  if (state === undefined) {
    state = { recorded: new Map(), marked: [] };
    stateByWorld.set(world, state);
  }
  return state;
}

After(() => {
  removeRecorderScript();
});

async function panesOnScreen(
  world: KoluWorld,
): Promise<Array<{ id: string; label: string }>> {
  const panes = await world.page.evaluate((sel) => {
    const seen: Array<{ id: string; sub: boolean }> = [];
    for (const node of document.querySelectorAll(sel)) {
      const id = node.getAttribute("data-terminal-id");
      if (!id || seen.some((p) => p.id === id)) continue;
      seen.push({ id, sub: node.hasAttribute("data-sub-terminal") });
    }
    return seen;
  }, ANY_PANE);
  return panes
    .sort((a, b) => Number(a.sub) - Number(b.sub))
    .map((pane, index) => ({
      id: pane.id,
      label: pane.sub ? `sub-pane ${pane.id}` : `pane ${index + 1} ${pane.id}`,
    }));
}

async function readAll(world: KoluWorld): Promise<Map<string, Winsize[]>> {
  const now = new Map<string, Winsize[]>();
  for (const id of mountSizeState(world).recorded.keys()) {
    now.set(id, await readWinsizes(id));
  }
  return now;
}

const recordedIds = (world: KoluWorld): string[] => [
  ...mountSizeState(world).recorded.keys(),
];

interface Told {
  id: string;
  label: string;
  size: Winsize;
  atMs: number;
}

async function watchQuiet(
  world: KoluWorld,
  only?: readonly string[],
): Promise<Told[]> {
  const { recorded } = mountSizeState(world);
  const watched = only ?? [...recorded.keys()];
  const started = Date.now();
  const seen = new Map(
    watched.map((id) => [id, (recorded.get(id)?.baseline ?? []).length]),
  );
  const told: Told[] = [];
  for (;;) {
    const now = await readAll(world);
    const atMs = Date.now() - started;
    for (const id of watched) {
      const sizes = now.get(id) ?? [];
      const from = seen.get(id) ?? 0;
      for (const size of sizes.slice(from)) {
        told.push({
          id,
          label: recorded.get(id)?.label ?? id,
          size,
          atMs,
        });
      }
      seen.set(id, sizes.length);
    }
    if (atMs >= GRID_ROUND_TRIP_MS) return told;
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
  }
}

const describeTold = (told: readonly Told[]): string =>
  told
    .map(
      (t) =>
        `    ${t.label} was told ${t.size.cols}x${t.size.rows} (#${t.size.seq}, ${t.atMs}ms into the window)`,
    )
    .join("\n");

async function rebaseline(
  world: KoluWorld,
  only: readonly string[],
): Promise<void> {
  const watched = new Set(only);
  const { recorded } = mountSizeState(world);
  for (const [id, sizes] of await readAll(world)) {
    const entry = recorded.get(id);
    if (entry && watched.has(id)) entry.baseline = sizes;
  }
}

async function holdQuiet(
  world: KoluWorld,
  what: string,
  only?: readonly string[],
): Promise<void> {
  const told = await watchQuiet(world, only);
  if (told.length === 0) return;
  throw new Error(
    `${what}: a program was told a new size with nothing about its box changed.\n` +
      `${describeTold(told)}\n` +
      `${await quoteResizeWire(world.page, recordedIds(world))}`,
  );
}

Given(
  "a size recorder is running in every pane on screen",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    await installResizeWireProbe(this.page);
    const panes = await panesOnScreen(this);
    assert.ok(panes.length > 0, "no mounted pane to record sizes in");
    for (const pane of panes) {
      const start = await startRecorder(pane.id);
      mountSizeState(this).recorded.set(pane.id, {
        label: pane.label,
        baseline: [start],
      });
    }
    const main = await this.page.evaluate(
      (sel) => document.querySelector(sel)?.getAttribute("data-terminal-id"),
      MAIN_PANE,
    );
    if (main) this.paintedTerminalId = main;
  },
);

Given(
  "I mark every recorded pane",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const state = mountSizeState(this);
    assert.ok(state.recorded.size > 0, "no terminal is being recorded");
    const attaches = await readAttachCounts(this.page, recordedIds(this));
    state.marked = [];
    for (const [id, entry] of state.recorded) {
      const marker = `kolu-pane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const tagged = await this.page.evaluate(
        ({ sel, value }) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          (el as HTMLElement & { koluPaneMarker?: string }).koluPaneMarker =
            value;
          return true;
        },
        { sel: paneSelector(id), value: marker },
      );
      assert.ok(tagged, `no mounted pane to mark for ${entry.label}`);
      state.marked.push({
        id,
        label: entry.label,
        marker,
        attaches: attaches[id] ?? 0,
      });
    }
  },
);

Given(
  "every recorded program has settled",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const deadline = Date.now() + SETTLE_BUDGET_MS;
    let stableSince = Date.now();
    let last = await readAll(this);
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
      const now = await readAll(this);
      const moved = recordedIds(this).some(
        (id) => (now.get(id)?.length ?? 0) !== (last.get(id)?.length ?? 0),
      );
      if (moved) stableSince = Date.now();
      last = now;
      if (Date.now() - stableSince >= GRID_ROUND_TRIP_MS) break;
      if (Date.now() > deadline) {
        throw new Error(
          `the terminals never stopped being resized within ${SETTLE_BUDGET_MS}ms, ` +
            "so there is no settled state to measure from:\n" +
            [...now]
              .map(
                ([id, sizes]) =>
                  `  ${mountSizeState(this).recorded.get(id)?.label ?? id}: ${formatWinsizes(sizes)}`,
              )
              .join("\n"),
        );
      }
    }
    await rebaseline(this, recordedIds(this));
  },
);

When(
  "I reload the page {int} times",
  { timeout: 900_000 },
  async function (this: KoluWorld, mounts: number) {
    const perMount: string[] = [];
    let mountsThatTold = 0;
    const mountsThatWrote: string[] = [];
    const wires: string[] = [];
    let toldWire = false;
    for (let mount = 1; mount <= mounts; mount++) {
      await this.page.reload();
      await this.waitForReady();
      const told = await watchQuiet(this);
      const wrote = await readPanelWrites(this.page);
      if (told.length > 0) {
        mountsThatTold++;
        perMount.push(`  mount ${mount}:\n${describeTold(told)}`);
      } else {
        perMount.push(`  mount ${mount}: nothing`);
      }
      for (const frame of wrote) {
        mountsThatWrote.push(`  mount ${mount} wrote: ${frame}`);
      }
      if (mount === 1 || (told.length > 0 && !toldWire)) {
        if (told.length > 0) toldWire = true;
        wires.push(
          `  the wire at mount ${mount}:\n${await quoteResizeWire(
            this.page,
            recordedIds(this),
          )}`,
        );
      }
      await rebaseline(this, recordedIds(this));
    }
    const report = `[mount-size] ${mounts} mounts\n${perMount.join("\n")}\n${wires.join("\n")}`;
    console.log(report);
    if (mountsThatWrote.length > 0) {
      throw new Error(
        `a mount wrote the split's saved state — only a gesture may:\n${mountsThatWrote.join("\n")}`,
      );
    }
    if (mountsThatTold > 0) {
      throw new Error(
        `${mountsThatTold} of ${mounts} mounts told a program a new size with nothing ` +
          `about its box changed.\n${report}`,
      );
    }
  },
);

When(
  "I create another terminal and start a size recorder in it",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const before = new Set(await this.terminalIds());
    const created = await padiCall("lifecycle/create", {
      placement: { kind: "toplevel" },
    });
    const id =
      created && typeof created === "object" && "id" in created
        ? String(created.id)
        : null;
    assert.ok(
      id,
      `lifecycle.create answered no id: ${JSON.stringify(created)}`,
    );
    assert.ok(!before.has(id), `lifecycle.create answered a known id: ${id}`);
    const start = await startRecorder(id);
    mountSizeState(this).recorded.set(id, {
      label: `the new terminal ${id}`,
      baseline: [start],
    });
    this.createdTerminalIds.push(id);
    await this.page
      .locator(`${paneSelector(id)}`)
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

When(
  "I create another terminal with the keyboard and start a size recorder in it",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = await this.createTerminal();
    this.createdTerminalIds.push(id);
    const start = await startRecorder(id);
    mountSizeState(this).recorded.set(id, {
      label: `the new terminal ${id}`,
      baseline: [start],
    });
  },
);

When(
  "I wait out the settle window",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    await new Promise((resolve) => setTimeout(resolve, GRID_ROUND_TRIP_MS));
  },
);
When(
  "I narrow every recorded tile by {int} pixels",
  { timeout: 120_000 },
  async function (this: KoluWorld, px: number) {
    const tiles = await this.page.evaluate(
      ({ sel, ids }) => {
        const found: Array<{
          id: string;
          x: number;
          y: number;
          w: number;
          h: number;
        }> = [];
        for (const node of document.querySelectorAll(sel)) {
          const id = node.getAttribute("data-terminal-id");
          if (!id || !ids.includes(id) || !(node instanceof HTMLElement))
            continue;
          found.push({
            id,
            x: Number.parseFloat(node.style.left),
            y: Number.parseFloat(node.style.top),
            w: Number.parseFloat(node.style.width),
            h: Number.parseFloat(node.style.height),
          });
        }
        return found;
      },
      { sel: CANVAS_TILE_SELECTOR, ids: recordedIds(this) },
    );
    assert.ok(tiles.length > 0, "no recorded terminal owns a canvas tile");
    for (const tile of tiles) {
      assert.ok(
        Number.isFinite(tile.w) && tile.w > px,
        `canvas tile ${tile.id} has no usable width to narrow (${tile.w}px)`,
      );
      await padiCall("chrome/setCanvasLayout", {
        id: tile.id,
        layout: { x: tile.x, y: tile.y, w: tile.w - px, h: tile.h },
      });
    }
    await this.page.waitForFunction(
      ({ sel, want }) => {
        for (const [id, width] of Object.entries(want)) {
          const node = document.querySelector(
            `${sel}[data-terminal-id="${id}"]`,
          );
          if (!(node instanceof HTMLElement)) return false;
          if (Math.abs(Number.parseFloat(node.style.width) - width) > 1)
            return false;
        }
        return true;
      },
      {
        sel: CANVAS_TILE_SELECTOR,
        want: Object.fromEntries(tiles.map((t) => [t.id, t.w - px])),
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

async function waitForGrowth(
  world: KoluWorld,
  what: string,
  watched: readonly string[],
): Promise<void> {
  const { recorded } = mountSizeState(world);
  const baselines = new Map(
    watched.map((id) => [id, recorded.get(id)?.baseline ?? []]),
  );
  await pollFor({
    observe: () => readAll(world),
    isDone: (now) =>
      watched.every(
        (id) => (now.get(id)?.length ?? 0) > (baselines.get(id)?.length ?? 0),
      ),
    timeoutMs: POLL_TIMEOUT,
    intervalMs: SAMPLE_MS,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `${what}: the box moved and ${elapsedMs}ms later these programs had not been ` +
          "told — so this scenario's negative would have passed on an instrument " +
          "that reports nothing at all:\n" +
          watched
            .map(
              (id) =>
                `  ${recorded.get(id)?.label ?? id}: was ${formatWinsizes(
                  baselines.get(id) ?? [],
                )}, now ${formatWinsizes(last?.get(id) ?? [])}`,
            )
            .join("\n"),
      ),
  });
}

Then(
  "every recorded program was told a new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    assert.ok(
      mountSizeState(this).recorded.size > 0,
      "no terminal is being recorded",
    );
    await waitForGrowth(this, "the deliberate box change", recordedIds(this));
  },
);

Then(
  "the program in the main pane was told a new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = await this.page.evaluate(
      (sel) => document.querySelector(sel)?.getAttribute("data-terminal-id"),
      MAIN_PANE,
    );
    assert.ok(id, "no visible main pane");
    assert.ok(
      mountSizeState(this).recorded.has(id),
      `the main pane (${id}) is not being recorded`,
    );
    await waitForGrowth(this, "the deliberate box change", [id]);
  },
);

Then(
  "every marked pane should be the same element, with no second attach",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const { marked } = mountSizeState(this);
    assert.ok(marked.length > 0, "no pane was marked");
    const attaches = await readAttachCounts(this.page, recordedIds(this));
    const rebuilt: string[] = [];
    const reattached: string[] = [];
    for (const pane of marked) {
      const found = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return (
          (el as HTMLElement & { koluPaneMarker?: string }).koluPaneMarker ??
          "(none)"
        );
      }, paneSelector(pane.id));
      if (found === null) {
        rebuilt.push(`  ${pane.label}: its pane is no longer mounted at all`);
      } else if (found !== pane.marker) {
        rebuilt.push(
          `  ${pane.label}: came back as a NEW element (carries ${found})`,
        );
      }
      const now = attaches[pane.id] ?? 0;
      if (now > pane.attaches) {
        reattached.push(
          `  ${pane.label}: opened ${now - pane.attaches} more attach stream(s) (${pane.attaches} → ${now})`,
        );
      }
    }
    const faults = [...rebuilt, ...reattached];
    assert.deepStrictEqual(
      faults,
      [],
      "a pane nobody touched was rebuilt, which throws away the reader's scroll " +
        "position, selection and focus and costs a fresh snapshot — and no size " +
        "assertion here would have noticed, because a rebuilt pane comes back at " +
        `the size it already had:\n${faults.join("\n")}`,
    );
  },
);

async function tileIds(world: KoluWorld): Promise<string[]> {
  return world.page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)]
        .map((tile) => tile.getAttribute("data-terminal-id"))
        .filter((id): id is string => !!id),
    CANVAS_TILE_SELECTOR,
  );
}

async function recordedTileId(
  world: KoluWorld,
  position: number,
): Promise<string> {
  const ids = await tileIds(world);
  const id = ids[position - 1];
  assert.ok(id, `there is no canvas tile ${position} (saw ${ids.length})`);
  assert.ok(
    mountSizeState(world).recorded.has(id),
    `canvas tile ${position} (${id}) is not being recorded`,
  );
  return id;
}

async function recordedMainPaneId(world: KoluWorld): Promise<string> {
  const id = await world.page.evaluate(
    (sel) => document.querySelector(sel)?.getAttribute("data-terminal-id"),
    MAIN_PANE,
  );
  assert.ok(id, "no visible main pane");
  assert.ok(
    mountSizeState(world).recorded.has(id),
    `the main pane (${id}) is not being recorded`,
  );
  return id;
}

Then(
  "no recorded program was told a new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    assert.ok(
      mountSizeState(this).recorded.size > 0,
      "no terminal is being recorded",
    );
    await holdQuiet(this, "after the act");
  },
);

Then(
  "the program in canvas tile {int} was told no new size",
  { timeout: 120_000 },
  async function (this: KoluWorld, position: number) {
    const id = await recordedTileId(this, position);
    await holdQuiet(this, `canvas tile ${position}`, [id]);
  },
);

Then(
  "the program in the main pane was told no new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    await holdQuiet(this, "the main pane", [await recordedMainPaneId(this)]);
  },
);

async function tileByRole(
  world: KoluWorld,
  role: "maximized" | "covered",
): Promise<string> {
  const id = await world.page.evaluate(
    ({ sel, role }) => {
      const tiles = [...document.querySelectorAll(sel)];
      const maximized = tiles.find(
        (t) => t.getAttribute("data-maximized") === "true",
      );
      if (!maximized) return null;
      if (role === "maximized")
        return maximized.getAttribute("data-terminal-id");
      const covered = tiles.filter((t) => t !== maximized);
      return covered.length === 1
        ? covered[0]?.getAttribute("data-terminal-id")
        : null;
    },
    { sel: CANVAS_TILE_SELECTOR, role },
  );
  assert.ok(id, `there is no single ${role} tile on screen`);
  assert.ok(
    mountSizeState(world).recorded.has(id),
    `the ${role} tile (${id}) is not being recorded`,
  );
  if (role === "maximized") mountSizeState(world).lastMaximized = id;
  return id;
}

Then(
  "a different canvas tile should be maximized",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const was = mountSizeState(this).lastMaximized;
    assert.ok(was, "no tile has been maximized in this scenario yet");
    await this.page.waitForFunction(
      ({ sel, was }) => {
        const max = [...document.querySelectorAll(sel)].find(
          (t) => t.getAttribute("data-maximized") === "true",
        );
        const id = max?.getAttribute("data-terminal-id");
        return !!id && id !== was;
      },
      { sel: CANVAS_TILE_SELECTOR, was },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the maximized tile's program was told exactly {int} new size",
  { timeout: 120_000 },
  async function (this: KoluWorld, count: number) {
    const id = await tileByRole(this, "maximized");
    await expectTold(this, "the maximized tile", [id], count);
  },
);

Then(
  "the covered tile's program was told no new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = await tileByRole(this, "covered");
    mountSizeState(this).coveredBefore = {
      id,
      label: mountSizeState(this).recorded.get(id)?.label ?? id,
    };
    await holdQuiet(this, "the covered tile", [id]);
  },
);

Then(
  "the tile that was covered was told no new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const covered = mountSizeState(this).coveredBefore;
    assert.ok(covered, "no tile has been covered in this scenario yet");
    await holdQuiet(this, `${covered.label} (covered earlier)`, [covered.id]);
  },
);

Then(
  "every recorded program was told exactly {int} new size",
  { timeout: 120_000 },
  async function (this: KoluWorld, count: number) {
    const { recorded } = mountSizeState(this);
    assert.ok(recorded.size > 0, "no terminal is being recorded");
    const ids = recordedIds(this);
    const told = await watchQuiet(this, ids);
    const wrong = ids
      .map((id) => ({ id, n: told.filter((t) => t.id === id).length }))
      .filter((row) => row.n !== count)
      .map(
        (row) =>
          `  ${recorded.get(row.id)?.label ?? row.id}: ${row.n}, not ${count}`,
      );
    assert.deepStrictEqual(
      wrong,
      [],
      `every recorded program owed exactly ${count} new size:\n${wrong.join("\n")}\n` +
        `${describeTold(told)}\n` +
        `${await quoteResizeWire(this.page, ids)}`,
    );
    await rebaseline(this, ids);
  },
);

async function expectTold(
  world: KoluWorld,
  what: string,
  watched: readonly string[],
  count: number,
): Promise<void> {
  const told = await watchQuiet(world, watched);
  assert.strictEqual(
    told.length,
    count,
    `${what}: expected exactly ${count} new size, saw ${told.length}.\n` +
      `${describeTold(told)}\n` +
      `${await quoteResizeWire(world.page, recordedIds(world))}`,
  );
  await rebaseline(world, watched);
}

Then(
  "the program in canvas tile {int} was told exactly {int} new size",
  { timeout: 120_000 },
  async function (this: KoluWorld, position: number, count: number) {
    const id = await recordedTileId(this, position);
    await expectTold(this, `canvas tile ${position}`, [id], count);
  },
);

Then(
  "the program in the main pane was told exactly {int} new size",
  { timeout: 120_000 },
  async function (this: KoluWorld, count: number) {
    const id = await recordedMainPaneId(this);
    await expectTold(this, "the main pane", [id], count);
  },
);

Then(
  "the split should still be collapsed",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const shown = await this.page
      .locator("[data-sub-terminal][data-visible]")
      .count();
    assert.strictEqual(
      shown,
      0,
      `the split came back open after the reload — ${shown} sub pane(s) on screen`,
    );
  },
);

Then(
  "the split should still be open",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    await this.page
      .locator("[data-sub-terminal][data-visible]")
      .first()
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "every program that was already running was told no new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const newest = this.createdTerminalIds.at(-1);
    assert.ok(newest, "no terminal was created in this scenario");
    const earlier = recordedIds(this).filter((id) => id !== newest);
    assert.ok(earlier.length > 0, "nothing was recorded before the new one");
    await holdQuiet(this, "the terminals that were already there", earlier);
  },
);

Then(
  "the new terminal's program was told at most one new size, ending at its pane's grid",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = this.createdTerminalIds.at(-1);
    assert.ok(id, "no terminal was created in this scenario");
    const entry = mountSizeState(this).recorded.get(id);
    assert.ok(entry, `the new terminal (${id}) is not being recorded`);
    const sizes = await readWinsizes(id);
    const pane = await this.page.evaluate((sel) => {
      const node = document.querySelector(sel);
      if (!(node instanceof HTMLDivElement) || !node.__xterm) return null;
      return { cols: node.__xterm.cols, rows: node.__xterm.rows };
    }, paneSelector(id));
    assert.ok(pane, `the new terminal (${id}) has no mounted xterm to compare`);
    const last = sizes.at(-1);
    assert.ok(last, "the new terminal's program printed nothing");
    const wire = await quoteResizeWire(this.page, recordedIds(this));
    const distinct = new Set(sizes.map((s) => `${s.cols}x${s.rows}`));
    assert.ok(
      distinct.size <= 2,
      `the new terminal's program was told ${distinct.size} different sizes, not one: ` +
        `${formatWinsizes(sizes)}\n${wire}`,
    );
    assert.deepStrictEqual(
      { cols: last.cols, rows: last.rows },
      pane,
      `the new terminal's program ended at ${last.cols}x${last.rows} while its pane is ` +
        `${pane.cols}x${pane.rows}: ${formatWinsizes(sizes)}\n${wire}`,
    );
  },
);

Then(
  "the size record should be reported as {string}",
  async function (this: KoluWorld, label: string) {
    const lines: string[] = [];
    for (const [id, entry] of mountSizeState(this).recorded) {
      lines.push(`  ${entry.label}: ${formatWinsizes(await readWinsizes(id))}`);
    }
    console.log(`[mount-size] ${label}\n${lines.join("\n")}`);
  },
);
