import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { resumableTerminalIds } from "@kolu/padi/resumable";
import {
  LOCAL_LOCATION,
  type RestoreTarget,
  SavedSessionSchema,
  type SavedTerminal,
} from "@kolu/padi-client/surface";
import { Schema } from "effect";
import { padiStateDir } from "../support/hooks.ts";
import { pollFor } from "../support/poll.ts";
import { padiCall } from "../support/rpcWire.ts";
import {
  ACTIVE_CANVAS_TILE_SELECTOR,
  DOCK_ROW_SELECTOR,
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const fixtureTerminalId = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

class SavedSessionFixture {
  readonly #savedAt = Date.now();
  #terminals: SavedTerminal[] = [];
  #activeTerminalId: string | undefined;

  get terminals(): readonly SavedTerminal[] {
    return this.#terminals;
  }

  async post(
    terminals: SavedTerminal[],
    activeTerminalId?: string,
  ): Promise<void> {
    this.#terminals = terminals;
    if (activeTerminalId !== undefined) {
      this.#activeTerminalId = activeTerminalId;
    }
    await this.repost();
  }

  async repost(): Promise<void> {
    if (this.#terminals.length === 0) return;
    await padiCall("session/test__set", {
      terminals: this.#terminals.map((t) => ({
        location: LOCAL_LOCATION,
        state: "active",
        pr: { kind: "absent" },
        ...t,
      })),
      savedAt: this.#savedAt,
      ...(this.#activeTerminalId === undefined
        ? {}
        : { activeTerminalId: this.#activeTerminalId }),
    });
  }
}

const fixtureByWorld = new WeakMap<KoluWorld, SavedSessionFixture>();

function savedSession(world: KoluWorld): SavedSessionFixture {
  let fixture = fixtureByWorld.get(world);
  if (fixture === undefined) {
    fixture = new SavedSessionFixture();
    fixtureByWorld.set(world, fixture);
  }
  return fixture;
}

async function postSavedSession(
  world: KoluWorld,
  count: number,
): Promise<void> {
  const dirs = [os.homedir(), os.tmpdir(), "/"].slice(0, count);
  await savedSession(world).post(
    dirs.map((cwd, i) => ({
      id: fixtureTerminalId(i),
      cwd,
      git: { kind: "none" },
    })),
  );
}

async function waitForRestoreCard<T>(
  world: KoluWorld,
  observe: () => Promise<T>,
  isDone: (seen: T) => boolean,
  onTimeout: (last: T | undefined, elapsedMs: number) => Error,
): Promise<void> {
  await pollFor({
    observe,
    isDone,
    onTick: () => savedSession(world).repost(),
    onTimeout,
    timeoutMs: POLL_TIMEOUT,
  });
}

Given(
  "a saved session with {int} terminals",
  async function (this: KoluWorld, count: number) {
    await postSavedSession(this, count);
  },
);

Then(
  "the session restore card should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="empty-state"]')
      .waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
    const card = this.page.locator('[data-testid="session-restore"]');
    await waitForRestoreCard(
      this,
      () => card.isVisible().catch(() => false),
      (visible) => visible,
      (_, ms) =>
        new Error(`The session restore card never appeared within ${ms}ms`),
    );
  },
);

Then(
  "the restore button should mention {string}",
  async function (this: KoluWorld, text: string) {
    await waitForRestoreCard(
      this,
      () =>
        this.page.evaluate(
          () =>
            document.querySelector('[data-testid="restore-session"]')
              ?.textContent ?? null,
        ),
      (content) => content?.includes(text) ?? false,
      (last, ms) =>
        new Error(
          `Restore button never mentioned "${text}" within ${ms}ms (last="${last}")`,
        ),
    );
  },
);

When(
  "I click the restore button",
  { timeout: 60_000 },
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="restore-session"]');
    await btn.click();
    await this.page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length > 0,
      DOCK_ROW_SELECTOR,
      { timeout: 45_000 },
    );
  },
);

Then(
  "a restored terminal should replay the agent resume invocation {string}",
  async function (this: KoluWorld, resumeInvocation: string) {
    try {
      await this.page.waitForFunction(
        (exp) => {
          const nodes = document.querySelectorAll(
            "[data-terminal-id][data-font-size]",
          );
          for (const n of nodes) {
            const content =
              (
                window as unknown as {
                  __readXtermBuffer?: (sel: string, idx: number) => string;
                }
              ).__readXtermBuffer?.(
                `[data-terminal-id="${n.getAttribute("data-terminal-id")}"][data-font-size]`,
                0,
              ) ?? "";
            if (content.includes(exp)) return true;
          }
          return false;
        },
        resumeInvocation,
        { timeout: POLL_TIMEOUT, polling: 50 },
      );
    } catch (err) {
      throw new Error(
        `No restored terminal replayed resume invocation "${resumeInvocation}" ` +
          `— a split agent that was filtered out of the resume set would show exactly this.`,
        { cause: err },
      );
    }
  },
);

Then(
  "there should be {int} workspace switcher entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(DOCK_ROW_SELECTOR);
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: DOCK_ROW_SELECTOR, count: expected },
      { timeout: 15000 },
    );
    const actual = await entries.count();
    assert.strictEqual(
      actual,
      expected,
      `Expected ${expected} workspace switcher entries, got ${actual}`,
    );
  },
);

Given(
  "a saved session with theme {string}",
  async function (this: KoluWorld, themeName: string) {
    await savedSession(this).post([
      {
        id: fixtureTerminalId(0),
        cwd: os.homedir(),
        git: { kind: "none" },
        themeName,
      },
    ]);
  },
);

Given(
  "a saved session with canvas layout at x={int} y={int} w={int} h={int}",
  async function (this: KoluWorld, x: number, y: number, w: number, h: number) {
    await savedSession(this).post([
      {
        id: fixtureTerminalId(0),
        cwd: os.homedir(),
        git: { kind: "none" },
        canvasLayout: { x, y, w, h },
      },
    ]);
  },
);

Then(
  "the canvas tile should be at x={int} y={int} w={int} h={int}",
  async function (this: KoluWorld, x: number, y: number, w: number, h: number) {
    await this.page.waitForFunction(
      (expected) => {
        const tile = document.querySelector<HTMLElement>(
          '[data-testid="canvas-tile"]',
        );
        if (!tile) return false;
        const s = tile.style;
        return (
          s.left === `${expected.x}px` &&
          s.top === `${expected.y}px` &&
          s.width === `${expected.w}px` &&
          s.height === `${expected.h}px`
        );
      },
      { x, y, w, h },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Given(
  "a saved session with 2 tiles and the second tile marked active",
  async function (this: KoluWorld) {
    await savedSession(this).post(
      [
        {
          id: fixtureTerminalId(0),
          cwd: os.homedir(),
          git: { kind: "none" },
          canvasLayout: { x: -1200, y: -800, w: 480, h: 320 },
        },
        {
          id: fixtureTerminalId(1),
          cwd: os.tmpdir(),
          git: { kind: "none" },
          canvasLayout: { x: 1200, y: 800, w: 480, h: 320 },
        },
      ],
      fixtureTerminalId(1),
    );
  },
);

Then(
  "the active canvas tile should match the saved-session second tile",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      ({ activeTileSel, id }) => {
        const tiles = document.querySelectorAll<HTMLElement>(activeTileSel);
        for (const tile of tiles) {
          if (tile.getAttribute("data-terminal-id") === id) return true;
        }
        return false;
      },
      {
        activeTileSel: ACTIVE_CANVAS_TILE_SELECTOR,
        id: fixtureTerminalId(1),
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I wait for the session auto-save", async function (this: KoluWorld) {
  await new Promise((r) => setTimeout(r, 800));
});

Then(
  "the saved session should record the active terminal",
  async function (this: KoluWorld) {
    const expected = this.savedActiveTerminalId;
    assert.ok(expected, "No saved active canvas tile id in this scenario");
    const sessionFile = path.join(padiStateDir, "config.json");
    const readActiveId = (): string | null => {
      if (!fs.existsSync(sessionFile)) return null;
      const persisted = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as {
        session?: { activeTerminalId?: string | null } | null;
      };
      return persisted.session?.activeTerminalId ?? null;
    };
    await pollFor({
      observe: async () => readActiveId(),
      isDone: (id) => id === expected,
      onTimeout: (last, ms) =>
        new Error(
          `Saved session never recorded active terminal ${expected} within ${ms}ms — saw ${last ?? "none"}`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the saved session should list {int} resumable agents",
  async function (this: KoluWorld, expected: number) {
    const sessionFile = path.join(padiStateDir, "config.json");
    const readResumable = (): { count: number; detail: string } => {
      if (!fs.existsSync(sessionFile)) return { count: 0, detail: "no config" };
      const persisted = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as {
        session?: unknown;
      };
      const raw = persisted.session ?? null;
      const session =
        raw === null ? null : Schema.decodeUnknownSync(SavedSessionSchema)(raw);
      const terminals = session?.terminals ?? [];
      return {
        count: resumableTerminalIds(terminals).length,
        detail: JSON.stringify(
          terminals.map((t) => ({
            id: t.id.slice(0, 8),
            parentId: t.parentId?.slice(0, 8) ?? null,
            state: t.state,
            restoreTarget: t.restoreTarget?.kind ?? "absent",
          })),
        ),
      };
    };
    await pollFor({
      observe: async () => readResumable(),
      isDone: (r) => r.count === expected,
      onTimeout: (last, ms) =>
        new Error(
          `Saved session never listed ${expected} resumable agent(s) within ${ms}ms — saw ${last?.count ?? 0} in ${last?.detail ?? "nothing"}`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "workspace switcher entry {int} should be active",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    await this.page.waitForFunction(
      ({ activeTileSel, tid }: { activeTileSel: string; tid: string }) => {
        return (
          document.querySelector(
            `${activeTileSel}[data-terminal-id="${tid}"]`,
          ) !== null
        );
      },
      { activeTileSel: ACTIVE_CANVAS_TILE_SELECTOR, tid: id },
      { timeout: POLL_TIMEOUT },
    );
  },
);

const RESUME_TARGETS: Record<string, RestoreTarget> = {
  "claude --model sonnet": {
    kind: "exact",
    agent: {
      kind: "claude-code",
      sessionId: "00000000-0000-4000-8000-0000000000c1",
      resumeRef: "00000000-0000-4000-8000-0000000000c1",
    },
    argv: ["--model", "sonnet"],
  },
  "codex --yolo": {
    kind: "exact",
    agent: {
      kind: "codex",
      sessionId: "00000000-0000-4000-8000-0000000000c2",
      resumeRef: "00000000-0000-4000-8000-0000000000c2",
    },
    argv: ["--yolo"],
  },
};

Given(
  "terminal {int} has a resumable agent {string}",
  async function (this: KoluWorld, index: number, label: string) {
    const id = fixtureTerminalId(index);
    const restoreTarget = RESUME_TARGETS[label];
    if (restoreTarget === undefined) {
      throw new Error(
        `no structured restore target for "${label}" — add one to RESUME_TARGETS`,
      );
    }
    const updated: SavedTerminal[] = savedSession(this).terminals.map((t) =>
      t.id === id ? { ...t, restoreTarget } : t,
    );
    await savedSession(this).post(updated);
  },
);

Then(
  "the restore card should show the agent line {string}",
  async function (this: KoluWorld, command: string) {
    await waitForRestoreCard(
      this,
      () =>
        this.page.evaluate(
          (cmd) =>
            Array.from(
              document.querySelectorAll('[data-testid="resume-command"]'),
            ).some((n) => n.textContent?.trim() === cmd),
          command,
        ),
      (visible) => visible,
      (_, ms) =>
        new Error(
          `Restore card never showed the agent line "${command}" within ${ms}ms`,
        ),
    );
  },
);

Then(
  "the restore button should not mention {string}",
  async function (this: KoluWorld, text: string) {
    const btn = this.page.locator('[data-testid="restore-session"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const content = await btn.textContent();
    assert.ok(
      !content?.includes(text),
      `Expected restore button NOT to contain "${text}", got "${content}"`,
    );
  },
);

When("I turn off the resume-agents toggle", async function (this: KoluWorld) {
  const toggle = this.page.locator('[data-testid="resume-agents-toggle"]');
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
});

Then(
  "the restore card should not show the agent line {string}",
  async function (this: KoluWorld, command: string) {
    await this.page.waitForFunction(
      (cmd) => {
        const nodes = document.querySelectorAll(
          '[data-testid="resume-command"]',
        );
        return !Array.from(nodes).some((n) => n.textContent?.trim() === cmd);
      },
      command,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Given(
  "a saved session at cwd {string}",
  async function (this: KoluWorld, cwd: string) {
    await savedSession(this).post([
      { id: fixtureTerminalId(0), cwd, git: { kind: "none" } },
    ]);
  },
);

Then(
  "the restore card heading should be {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) => {
        const heading = document.querySelector('[data-testid="repo-heading"]');
        return heading?.textContent?.trim() === exp;
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the restore card heading should not contain {string}",
  async function (this: KoluWorld, forbidden: string) {
    await this.page.waitForFunction(
      (f) => {
        const heading = document.querySelector('[data-testid="repo-heading"]');
        const text = heading?.textContent?.trim() ?? "";
        return text.length > 0 && !text.includes(f);
      },
      forbidden,
      { timeout: POLL_TIMEOUT },
    );
  },
);
