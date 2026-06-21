/**
 * Sleeping terminals — step definitions for the Sleep/Wake journey e2e.
 *
 * NEW vocabulary only — everything reusable (open app, ready terminal, mock
 * agent, refresh, kaval restart, restore card, dock) is reused from the
 * existing step library. These steps cover the genuinely new actions and
 * OUTCOME assertions:
 *
 *   - sleeping a terminal (click `tile-sleep`) and capturing its stable id;
 *   - asserting a tile is DORMANT (`dormant-tile-body` + `data-sleeping="true"`,
 *     and crucially NO live `.xterm-screen`) vs. LIVE (a live xterm present);
 *   - waking via the dormant body's `wake-button`;
 *   - proving the agent RESUMED — the woken PTY replays the resume invocation
 *     (`codex resume --last`) in the SAME cwd, which a blank fresh agent never
 *     would (the agent-resume hole);
 *   - dragging a dormant tile (via the canvas-layout RPC the drag handle drives)
 *     and asserting its persisted position survives a reload;
 *   - planting a good + a malformed sleeping record so cold restore drops the
 *     malformed one without crashing.
 *
 * A SLEEPING tile keeps its CanvasTile wrapper (`canvas-tile` + `data-terminal-id`
 * + inline `style.left/top`) but its inner live `Terminal` (the only carrier of
 * `data-visible` / `.xterm-screen`) is unmounted, so DORMANT tiles are addressed
 * by their wrapper, never by the live-terminal selectors.
 */

import * as assert from "node:assert";
import * as os from "node:os";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  LOCAL_LOCATION,
  type SavedSleepingTerminal,
} from "kolu-common/surface";
import { readBufferText, waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';
const CANVAS_TILE_SELECTOR = '[data-testid="canvas-tile"]';

/** The stable id of the terminal we slept (sleep flips IN PLACE on the same id),
 *  and — separately — the saved id of a sleeping record planted/restored. Kept on
 *  a module-scoped slot keyed by `world` so it survives across steps within one
 *  scenario without widening the shared `KoluWorld` type. */
const sleptIdByWorld = new WeakMap<KoluWorld, string>();

/** Resolve the id of the SINGLE active (live) canvas tile on screen. The slept
 *  terminal is the one the user was just interacting with; with one tile up
 *  that is unambiguous. */
async function activeTileId(world: KoluWorld): Promise<string> {
  const id = await world.page.evaluate((sel) => {
    const tile =
      document.querySelector(`${sel}[data-active="true"]`) ??
      document.querySelector(sel);
    return tile?.getAttribute("data-terminal-id") ?? null;
  }, CANVAS_TILE_SELECTOR);
  if (!id) throw new Error("No canvas tile on screen to sleep");
  return id;
}

/** Resolve the id of the SINGLE sleeping (dormant) canvas tile on screen —
 *  the wrapper that contains a `dormant-tile-body`. Used by the restore /
 *  malformed scenarios where the slept id isn't tracked from a sleep action. */
async function sleepingTileId(world: KoluWorld): Promise<string> {
  const id = await pollFor({
    observe: () =>
      world.page.evaluate((sel) => {
        for (const tile of document.querySelectorAll(sel)) {
          if (tile.querySelector('[data-testid="dormant-tile-body"]')) {
            return tile.getAttribute("data-terminal-id");
          }
        }
        return null;
      }, CANVAS_TILE_SELECTOR),
    isDone: (v) => typeof v === "string" && v.length > 0,
    onTimeout: (_last, ms) =>
      new Error(`No sleeping (dormant) canvas tile appeared within ${ms}ms`),
    timeoutMs: POLL_TIMEOUT,
  });
  assert.ok(id, "No sleeping (dormant) canvas tile id resolved");
  return id;
}

/** Poll until the tile with `id` is DORMANT: its wrapper holds a
 *  `dormant-tile-body[data-sleeping="true"]` AND has NO live `.xterm-screen`
 *  (the second clause is load-bearing — a tile that still painted a live xterm
 *  alongside the dormant body would not be a real sleep). */
async function waitForSleeping(world: KoluWorld, id: string): Promise<void> {
  await world.page.waitForFunction(
    ({ sel, tileId }) => {
      const tile = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"]`,
      );
      if (!tile) return false;
      const dormant = tile.querySelector(
        '[data-testid="dormant-tile-body"][data-sleeping="true"]',
      );
      const liveXterm = tile.querySelector(".xterm-screen");
      return dormant !== null && liveXterm === null;
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id },
    { timeout: POLL_TIMEOUT },
  );
}

/** Poll until the tile with `id` is LIVE again: a live `.xterm-screen` is
 *  present AND the dormant body is gone — the inverse of `waitForSleeping`. */
async function waitForLive(world: KoluWorld, id: string): Promise<void> {
  await world.page.waitForFunction(
    ({ sel, tileId }) => {
      const tile = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"]`,
      );
      if (!tile) return false;
      const liveXterm = tile.querySelector(".xterm-screen");
      const dormant = tile.querySelector('[data-testid="dormant-tile-body"]');
      return liveXterm !== null && dormant === null;
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id },
    { timeout: POLL_TIMEOUT },
  );
}

/** Click the dormant body's Wake button for the tile with `id`. Dispatch the
 *  DOM click directly (the kill_steps idiom): a real-mouse click on a stacked
 *  canvas tile can lose the hit-test to an overlapping sibling. */
async function clickWakeButton(world: KoluWorld, id: string): Promise<void> {
  await world.page.evaluate(
    ({ sel, tileId }) => {
      const btn = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"] [data-testid="dormant-tile-body"] [data-testid="wake-button"]`,
      ) as HTMLButtonElement | null;
      if (!btn) throw new Error(`wake-button not found for ${tileId}`);
      btn.click();
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id },
  );
}

/** Drive `setCanvasLayout` for `id` — the same persisted RPC the drag handle
 *  fires — then wait for the dormant tile's wrapper to render at (x, y).
 *  Targets the `canvas-tile` WRAPPER (sleeping tiles have no `data-visible`
 *  inner terminal), so this reaches a dormant tile the live-terminal canvas
 *  steps cannot. */
async function moveSleepingTile(
  world: KoluWorld,
  id: string,
  x: number,
  y: number,
): Promise<void> {
  const layout = { x, y, w: 700, h: 500 };
  const resp = await world.page.request.fetch("/rpc/terminal/setCanvasLayout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({ json: { id, layout } }),
  });
  assert.ok(resp.ok(), `terminal/setCanvasLayout failed: ${resp.status()}`);
  await waitForSleepingTileAt(world, id, x, y);
}

/** Poll until the dormant tile's wrapper sits at (x, y) in canvas space. */
async function waitForSleepingTileAt(
  world: KoluWorld,
  id: string,
  x: number,
  y: number,
): Promise<void> {
  await world.page.waitForFunction(
    ({ sel, tileId, wantX, wantY }) => {
      const tile = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"]`,
      ) as HTMLElement | null;
      if (!tile) return false;
      const host = tile.closest("[style*='left']") as HTMLElement | null;
      const styled = host ?? tile;
      return (
        Math.abs(Number.parseFloat(styled.style.left) - wantX) < 1 &&
        Math.abs(Number.parseFloat(styled.style.top) - wantY) < 1
      );
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id, wantX: x, wantY: y },
    { timeout: POLL_TIMEOUT },
  );
}

// ── Sleep / wake actions ──

When(
  "I sleep the active terminal via the tile sleep button",
  async function (this: KoluWorld) {
    const id = await activeTileId(this);
    sleptIdByWorld.set(this, id);
    // The ☾ Sleep button lives in the active tile's title bar. Dispatch the
    // DOM click directly (kill_steps idiom) to skip the canvas hit-test.
    await this.page.evaluate(
      ({ sel, tileId }) => {
        const btn = document.querySelector(
          `${sel}[data-terminal-id="${tileId}"] [data-testid="tile-sleep"]`,
        ) as HTMLButtonElement | null;
        if (!btn) throw new Error(`tile-sleep button not found for ${tileId}`);
        btn.click();
      },
      { sel: CANVAS_TILE_SELECTOR, tileId: id },
    );
  },
);

When(
  "I wake the slept terminal via the dormant body wake button",
  async function (this: KoluWorld) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    await clickWakeButton(this, id);
  },
);

When(
  "I wake the restored sleeping tile via the dormant body wake button",
  async function (this: KoluWorld) {
    const id = await sleepingTileId(this);
    sleptIdByWorld.set(this, id);
    await clickWakeButton(this, id);
  },
);

When(
  "I move the sleeping tile to x={int} y={int}",
  async function (this: KoluWorld, x: number, y: number) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    await moveSleepingTile(this, id, x, y);
  },
);

// ── Sleeping / live assertions ──

Then("the slept terminal should be sleeping", async function (this: KoluWorld) {
  const id = sleptIdByWorld.get(this);
  assert.ok(id, "No slept terminal id captured — call the sleep step first");
  await waitForSleeping(this, id);
});

Then("the slept terminal should be live", async function (this: KoluWorld) {
  const id = sleptIdByWorld.get(this);
  assert.ok(id, "No slept terminal id captured — call the sleep step first");
  await waitForLive(this, id);
});

Then(
  "the restored sleeping tile should be sleeping",
  async function (this: KoluWorld) {
    // Identify the dormant tile that came back via the restore card (saved id),
    // assert it's truly dormant, and stash its id for the subsequent wake.
    const id = await sleepingTileId(this);
    sleptIdByWorld.set(this, id);
    await waitForSleeping(this, id);
  },
);

Then(
  "the restored sleeping tile should be live",
  async function (this: KoluWorld) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No restored sleeping tile id captured — wake it first");
    await waitForLive(this, id);
  },
);

Then(
  "the sleeping tile should be at x={int} y={int}",
  async function (this: KoluWorld, x: number, y: number) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    await waitForSleepingTileAt(this, id, x, y);
  },
);

Then(
  "there should be exactly {int} canvas tile(s)",
  async function (this: KoluWorld, expected: number) {
    // Count CanvasTile WRAPPERS (present for sleeping AND live tiles) — the
    // orphan-detection assertion: a restart that adopted a survivor PTY
    // alongside the restored record, or a malformed record that wasn't
    // dropped, would push this above 1.
    const fullSelector = `${CANVAS_SELECTOR} ${CANVAS_TILE_SELECTOR}`;
    await this.page.waitForFunction(
      ({ sel, count }) => document.querySelectorAll(sel).length === count,
      { sel: fullSelector, count: expected },
      { timeout: POLL_TIMEOUT },
    );
    const actual = await this.page.locator(fullSelector).count();
    assert.strictEqual(
      actual,
      expected,
      `Expected exactly ${expected} canvas tile(s), got ${actual}`,
    );
  },
);

Then(
  "the dock should show {int} sleeping row(s)",
  async function (this: KoluWorld, expected: number) {
    // The dock classifies a dormant terminal into its own `sleeping` bucket —
    // `dock-row[data-bucket="sleeping"]`. Asserting the count proves the
    // sleeping terminal is a first-class presence-surface citizen, not erased.
    await this.page.waitForFunction(
      ({ count }) =>
        document.querySelectorAll(
          '[data-testid="dock-row"][data-bucket="sleeping"]',
        ).length === count,
      { count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// ── Resume-outcome assertions (the journey's payoff) ──

Then(
  "the woken terminal should replay the agent resume invocation {string}",
  async function (this: KoluWorld, resumeInvocation: string) {
    // The OUTCOME that proves the SAME conversation came back: on wake the
    // server re-spawns the PTY on the SAME id and TYPES the agent's RESUME form
    // into it (`proxy.write(resumeCommand)`). A fresh/blank terminal would type
    // NOTHING — so finding the resume invocation in the re-spawned tile's live
    // buffer is exactly what a fresh agent could never produce. Read the buffer
    // of THIS woken tile (scoped by its stable id to its inner live terminal),
    // not the focused one — the dormant-body Wake path doesn't refocus.
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept/woken terminal id captured");
    const scopedSelector = `${CANVAS_TILE_SELECTOR}[data-terminal-id="${id}"] [data-terminal-id][data-visible]`;
    try {
      await waitForBufferContains(this.page, resumeInvocation, {
        selector: scopedSelector,
      });
    } catch {
      const dump = await readBufferText(this.page, scopedSelector).catch(
        () => "",
      );
      throw new Error(
        `Woken terminal never replayed resume invocation "${resumeInvocation}" ` +
          `— a fresh/blank agent (the resume hole) would show exactly this. ` +
          `Buffer:\n${dump.slice(0, 800)}`,
      );
    }
  },
);

Then(
  "the woken terminal should resume in the same working directory",
  async function (this: KoluWorld) {
    // The resumed agent re-spawns in the SAVED cwd — so the Codex mock's
    // cwd-keyed provider re-resolves and the codex dock state returns. A
    // resume into the WRONG (or a default) cwd would never re-light the codex
    // indicator. Assert the codex indicator comes back on the now-live tile.
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile"] [data-testid="agent-indicator"]',
          );
          return el?.getAttribute("data-agent-kind") ?? null;
        }),
      isDone: (kind) => kind === "codex",
      onTimeout: (last, ms) =>
        new Error(
          `Woken terminal never re-resolved the codex agent in its saved cwd ` +
            `(kind="${last}") within ${ms}ms — resume landed in the wrong cwd`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

// ── Malformed-record fixture ──

Given(
  "a saved session with one good and one malformed sleeping record",
  async function (this: KoluWorld) {
    // The malformation MUST be plantable: it has to PASS the persisted-session
    // schema (`SavedSessionSchema`, validated at the `test__set` POST boundary,
    // whose id field is the loose `SavedTerminalIdSchema = { id: z.string() }`)
    // yet be DROPPED per-record at the server's seed boundary
    // (`seedSleepingTerminal` re-checks `record.id` against the STRICT
    // `TerminalIdSchema = z.string().uuid()`). A non-UUID `id` is exactly that
    // record — well-formed except its id, complete WITH `sleptAt`. (A record
    // missing `sleptAt` would instead be rejected at the POST boundary and the
    // whole session would never be planted — the wrong kind of malformed.)
    // Mirrors the unit guard `sleepWake.test.ts` → "DROPS a record with a
    // non-uuid id".
    const good: SavedSleepingTerminal = {
      id: "11111111-1111-4111-8111-111111111111",
      state: "sleeping",
      sleptAt: Date.now(),
      cwd: os.homedir(),
      git: null,
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      lastAgentCommand: "claude --model sonnet",
    };
    // The malformed record: a non-UUID id is the sole defect. It clears the
    // persisted-session schema (loose `z.string()` id) so the session plants,
    // but `seedSleepingTerminal`'s strict UUID re-check drops it on restore.
    const malformed = {
      id: "not-a-uuid",
      state: "sleeping",
      sleptAt: Date.now(),
      cwd: os.tmpdir(),
      git: null,
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      lastAgentCommand: "codex",
    } as unknown as SavedSleepingTerminal;

    // Stash for the restore-card self-heal (mirrors session_restore_steps:
    // `the session restore card should be visible` re-POSTs this list on each
    // poll tick; reuse the same `savedAt` so it replays the originally-planted
    // session, malformed record and all).
    this.savedSessionTerminals = [good, malformed];
    this.savedSessionTerminalCount = 2;
    this.savedSessionSavedAt = Date.now();
    const resp = await this.page.request.fetch(
      "/rpc/surface/kolu/session/test__set",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({
          json: {
            terminals: [good, malformed],
            savedAt: this.savedSessionSavedAt,
          },
        }),
      },
    );
    assert.ok(
      resp.ok(),
      `surface/kolu/session/test__set failed: ${resp.status()}`,
    );
  },
);
