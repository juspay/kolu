import { Then, When } from "@cucumber/cucumber";
import { dragFromCenter } from "../support/pointerDrag.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="dock"]';
const RAIL_SELECTOR = '[data-testid="dock-rail"]';
const MODE_TOGGLE_SELECTOR = '[data-testid="dock-mode-toggle"]';
export const AWAITING_ROW_SELECTOR =
  '[data-testid="dock-row"][data-bucket="awaiting"]';
const WORKING_ROW_SELECTOR = '[data-testid="dock-row"][data-bucket="working"]';
const QUIET_FOREGROUND_SELECTOR = '[data-testid="dock-quiet-foreground"]';
const AGENT_SUBLINE_SELECTOR = "[data-dock-row] [data-dock-subline]";
const MODEL_TAG_SELECTOR = "[data-dock-row] [data-dock-model]";
const CHROME_DOCK_TOGGLE_SELECTOR = '[data-testid="dock-toggle"]';
const DOCK_WINDOW_TRIGGER_SELECTOR = '[data-testid="dock-window-trigger"]';
const HIDDEN_FOOTER_SELECTOR = '[data-testid="dock-hidden-footer"]';
export const NEEDS_YOU_ENTRY_SELECTOR = '[data-testid="dock-needs-you-entry"]';

Then("the dock should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

When("the dock is expanded", async function (this: KoluWorld) {
  const dock = this.page.locator(DOCK_SELECTOR);
  await dock.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  if ((await dock.getAttribute("data-mode")) === "rail") {
    await this.page.locator(MODE_TOGGLE_SELECTOR).click();
  }
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-mode") !== "rail",
    DOCK_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

Then("the dock should not be visible", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
});

Then(
  "the dock should show {int} card(s)",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: AWAITING_ROW_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} working pill(s)",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: WORKING_ROW_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock needs-you strip should show {int} entry/entries",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: NEEDS_YOU_ENTRY_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the dock should default to cards mode", async function (this: KoluWorld) {
  const dock = this.page.locator(DOCK_SELECTOR);
  await dock.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const mode = await dock.getAttribute("data-mode");
  if (mode !== "cards") {
    throw new Error(`Expected dock mode "cards", got "${mode}"`);
  }
});

Then(
  "the dock should be in {string} mode",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      ({ selector, mode }) =>
        document.querySelector(selector)?.getAttribute("data-mode") === mode,
      { selector: DOCK_SELECTOR, mode: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I collapse the dock to rail", async function (this: KoluWorld) {
  await this.page.locator(MODE_TOGGLE_SELECTOR).click();
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.getAttribute("data-mode") === "rail",
    DOCK_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I click rail segment {int}",
  async function (this: KoluWorld, position: number) {
    const rail = this.page.locator(RAIL_SELECTOR).nth(position - 1);
    await rail.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await rail.click();
    await this.waitForFrame();
  },
);

When("I press the dock toggle shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Shift+B`);
  await this.waitForFrame();
});

When("I click the chrome-bar dock toggle", async function (this: KoluWorld) {
  const button = this.page.locator(CHROME_DOCK_TOGGLE_SELECTOR);
  await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await button.click();
  await this.waitForFrame();
});

const DOCK_RESIZE_HANDLE_SELECTOR = '[data-testid="dock-resize-handle"]';

async function dockWidth(world: KoluWorld): Promise<number> {
  const box = await world.page.locator(DOCK_SELECTOR).boundingBox();
  if (!box) throw new Error("dock has no bounding box (not visible?)");
  return box.width;
}

async function storedDockWidth(world: KoluWorld): Promise<number | null> {
  return world.page.evaluate(() => {
    const raw = localStorage.getItem("kolu-dock-cards-width");
    if (raw === null) return null;
    const v: unknown = JSON.parse(raw);
    return typeof v === "number" && Number.isFinite(v) ? v : NaN;
  });
}

Then(
  "the dock resize handle should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(DOCK_RESIZE_HANDLE_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the dock resize handle should not be present",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 0,
      DOCK_RESIZE_HANDLE_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I drag the dock resize handle right by {int} pixels",
  async function (this: KoluWorld, dx: number) {
    this.savedDockWidth = await dockWidth(this);
    await dragFromCenter(this, DOCK_RESIZE_HANDLE_SELECTOR, dx, 0, {
      steps: 12,
    });
  },
);

Then("the dock should be wider than before", async function (this: KoluWorld) {
  const before = this.savedDockWidth;
  if (before === undefined) {
    throw new Error("no pre-drag dock width captured");
  }
  await this.page.waitForFunction(
    ({ selector, prev }) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      return el.getBoundingClientRect().width > prev + 20;
    },
    { selector: DOCK_SELECTOR, prev: before },
    { timeout: POLL_TIMEOUT },
  );
  this.savedDockWidth = await dockWidth(this);
});

Then(
  "the resized dock width should be persisted",
  async function (this: KoluWorld) {
    const rendered = this.savedDockWidth;
    if (rendered === undefined) {
      throw new Error("no post-drag dock width captured");
    }
    const stored = await storedDockWidth(this);
    if (stored === null || Number.isNaN(stored)) {
      throw new Error(
        `persisted dock width is not a finite JSON number: ${stored}`,
      );
    }
    if (Math.abs(stored - rendered) > 4) {
      throw new Error(
        `persisted dock width ${stored} does not match rendered ${rendered}`,
      );
    }
  },
);

When(
  "I start a dock resize drag and the browser cancels it",
  async function (this: KoluWorld) {
    this.savedDockWidth = await dockWidth(this);
    this.savedStoredDockWidth = await storedDockWidth(this);
    // No nested function declaration inside page.evaluate — swc injects
    // `__name(...)` for named function expressions, which is undefined in the
    // browser context (the same pitfall mobile_soft_keyboard_steps.ts avoids).
    // Drive the sequence with a plain array + inline `new PointerEvent`.
    await this.page.evaluate((sel) => {
      const handle = document.querySelector(sel);
      if (!handle) throw new Error(`no handle matches ${sel}`);
      const box = handle.getBoundingClientRect();
      const y = box.y + box.height / 2;
      const x0 = box.x + box.width / 2;
      const steps: Array<{ type: string; target: EventTarget; x: number }> = [
        { type: "pointerdown", target: handle, x: x0 },
        { type: "pointermove", target: window, x: x0 + 140 },
        { type: "pointercancel", target: window, x: x0 + 140 },
      ];
      for (const s of steps) {
        s.target.dispatchEvent(
          new PointerEvent(s.type, {
            clientX: s.x,
            clientY: y,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }, DOCK_RESIZE_HANDLE_SELECTOR);
    await this.waitForFrame();
  },
);

Then(
  "the dock width should return to its pre-drag value",
  async function (this: KoluWorld) {
    const before = this.savedDockWidth;
    if (before === undefined) {
      throw new Error("no pre-drag dock width captured");
    }
    await this.page.waitForFunction(
      ({ selector, target }) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        return Math.abs(el.getBoundingClientRect().width - target) <= 4;
      },
      { selector: DOCK_SELECTOR, target: before },
      { timeout: POLL_TIMEOUT },
    );
    const beforeStored = this.savedStoredDockWidth;
    if (beforeStored === undefined) {
      throw new Error("no pre-drag stored dock width captured");
    }
    const stored = await storedDockWidth(this);
    const bothAbsent = stored === null && beforeStored === null;
    const bothMatch =
      stored !== null &&
      beforeStored !== null &&
      !Number.isNaN(stored) &&
      !Number.isNaN(beforeStored) &&
      Math.abs(stored - beforeStored) <= 4;
    if (!bothAbsent && !bothMatch) {
      throw new Error(
        `expected persisted width to stay at pre-drag ${beforeStored}, got ${stored}`,
      );
    }
  },
);

When(
  "I shrink the viewport to {int} pixels wide",
  async function (this: KoluWorld, width: number) {
    await this.resizeViewport(width, this.page.viewportSize()?.height ?? 720);
  },
);

Then(
  "the dock resize handle should stay within the viewport",
  async function (this: KoluWorld) {
    const viewport = this.page.viewportSize();
    if (!viewport) throw new Error("no viewport size");
    await this.page.waitForFunction(
      ({ selector, vw }) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const box = el.getBoundingClientRect();
        return box.right <= vw && box.left >= 0 && box.width > 0;
      },
      { selector: DOCK_RESIZE_HANDLE_SELECTOR, vw: viewport.width },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the canvas beside the dock should stay at least {int} pixels wide",
  async function (this: KoluWorld, min: number) {
    await this.page.waitForFunction(
      ({ selector, minWidth }) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        return el.getBoundingClientRect().width >= minWidth;
      },
      { selector: '[data-testid="canvas-container"]', minWidth: min },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I double-click the dock resize handle", async function (this: KoluWorld) {
  await this.page.locator(DOCK_RESIZE_HANDLE_SELECTOR).dblclick();
  await this.waitForFrame();
});

Then(
  "the dock should return to its default width",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        return Math.abs(el.getBoundingClientRect().width - 288) <= 4;
      },
      DOCK_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the dock should be in maximized mode", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    (selector) =>
      document.querySelector(selector)?.hasAttribute("data-maximized"),
    DOCK_SELECTOR,
    { timeout: POLL_TIMEOUT },
  );
});

When("I press and hold Mod", async function (this: KoluWorld) {
  await this.page.keyboard.down(MOD_KEY);
  await this.waitForFrame();
});

When("I release Mod", async function (this: KoluWorld) {
  await this.page.keyboard.up(MOD_KEY);
  await this.waitForFrame();
});

When(
  "I press shortcut {string}",
  async function (this: KoluWorld, chord: string) {
    const resolved = chord.replace(/\bMod\b/g, MOD_KEY);
    await this.page.keyboard.press(resolved);
    await this.waitForFrame();
  },
);

const SHORTCUT_HINT_SELECTOR = '[data-testid="dock-row-shortcut-hint"]';
const ACTIVE_INDICATOR_SELECTOR = '[data-testid="dock-row"][data-active]';

Then(
  "the dock should show {int} active row indicator",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ sel, count }) => document.querySelectorAll(sel).length === count,
      { sel: ACTIVE_INDICATOR_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock section should carry a repo-colour spine",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => {
        const sec = document.querySelector(sel);
        if (!sec) return false;
        const cs = getComputedStyle(sec);
        const repoColor = cs.getPropertyValue("--repo-color").trim();
        if (repoColor === "")
          throw new Error(
            `[data-testid="dock-section"] has no --repo-color custom property set`,
          );
        const stripeW = cs.getPropertyValue("--dock-edge-stripe-w").trim();
        if (!stripeW)
          throw new Error(`missing --dock-edge-stripe-w (spine width token)`);
        if (cs.borderLeftStyle !== "solid" || cs.borderLeftWidth !== stripeW) {
          return false;
        }
        if (!CSS.supports("color", repoColor))
          throw new Error(
            `--repo-color is not a valid CSS colour: "${repoColor}"`,
          );
        const probe = document.createElement("span");
        probe.style.color = repoColor;
        document.body.appendChild(probe);
        const resolvedRepoColor = getComputedStyle(probe).color;
        probe.remove();
        return cs.borderLeftColor === resolvedRepoColor;
      },
      '[data-testid="dock-section"]',
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock section header should be sticky",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => {
        const header = document.querySelector(sel);
        return !!header && getComputedStyle(header).position === "sticky";
      },
      '[data-testid="dock-section-header"]',
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "no dock-row shortcut hints should be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) =>
        [...document.querySelectorAll(sel)].filter((el) => el.checkVisibility())
          .length === 0,
      SHORTCUT_HINT_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} shortcut hints",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ sel, count }) =>
        [...document.querySelectorAll(sel)].filter((el) => el.checkVisibility())
          .length === count,
      { sel: SHORTCUT_HINT_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} foreground row containing {string}",
  async function (this: KoluWorld, expected: number, fragment: string) {
    await this.page.waitForFunction(
      ({ selector, frag, count }) => {
        const nodes = Array.from(document.querySelectorAll(selector));
        const matches = nodes.filter((n) =>
          (n.textContent ?? "").includes(frag),
        );
        return matches.length === count;
      },
      {
        selector: QUIET_FOREGROUND_SELECTOR,
        frag: fragment,
        count: expected,
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock window trigger should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(DOCK_WINDOW_TRIGGER_SELECTOR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the dock row should name the model {string}",
  async function (this: KoluWorld, model: string) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: string }) =>
        Array.from(document.querySelectorAll(sel)).some(
          (el) => el.textContent?.trim() === want,
        ),
      { sel: MODEL_TAG_SELECTOR, want: model },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock agent row should say {string}",
  async function (this: KoluWorld, words: string) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: string }) =>
        Array.from(document.querySelectorAll(sel)).some(
          (el) => el.textContent?.trim() === want,
        ),
      { sel: AGENT_SUBLINE_SELECTOR, want: words },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  /^the dock window should be "(all|4h|12h|24h|48h)"$/,
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: string }) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el?.getAttribute("data-window") === want;
      },
      { sel: DOCK_WINDOW_TRIGGER_SELECTOR, want: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I click the dock window trigger", async function (this: KoluWorld) {
  const button = this.page.locator(DOCK_WINDOW_TRIGGER_SELECTOR);
  await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await button.click();
  await this.waitForFrame();
});

When(
  /^I pick the dock window option "(all|4h|12h|24h|48h)"$/,
  async function (this: KoluWorld, value: string) {
    const opt = this.page.locator(
      `[data-testid="dock-window-option-${value}"]`,
    );
    await opt.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await opt.click();
    await this.waitForFrame();
  },
);

Then(
  /^the dock hidden footer should use the "(rail|cards)" layout$/,
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: string }) =>
        document.querySelector(sel)?.getAttribute("data-layout") === want,
      { sel: HIDDEN_FOOTER_SELECTOR, want: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);
