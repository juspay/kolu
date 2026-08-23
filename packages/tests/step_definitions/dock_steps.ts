/** Dock — step definitions. */

import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const DOCK_SELECTOR = '[data-testid="dock"]';
const RAIL_SELECTOR = '[data-testid="dock-rail"]';
const MODE_TOGGLE_SELECTOR = '[data-testid="dock-mode-toggle"]';
// Row bucket is the semantic state we assert against — the unified
// DockRow component carries `data-bucket="awaiting|working|idle|none"`
// instead of branching its testid by bucket.
const AWAITING_ROW_SELECTOR =
  '[data-testid="dock-row"][data-bucket="awaiting"]';
const WORKING_ROW_SELECTOR = '[data-testid="dock-row"][data-bucket="working"]';
const QUIET_FOREGROUND_SELECTOR = '[data-testid="dock-quiet-foreground"]';
const CHROME_DOCK_TOGGLE_SELECTOR = '[data-testid="dock-toggle"]';
const DOCK_WINDOW_TRIGGER_SELECTOR = '[data-testid="dock-window-trigger"]';
const HIDDEN_FOOTER_SELECTOR = '[data-testid="dock-hidden-footer"]';
const NEEDS_YOU_ENTRY_SELECTOR = '[data-testid="dock-needs-you-entry"]';

Then("the dock should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(DOCK_SELECTOR)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

// The dock defaults to "cards" mode now (#903 — primary navigator).
// "Expanded" semantically means cards mode, so this step ensures the
// dock is not in rail mode, clicking the header chevron to expand if
// needed. Mega mode counts as "expanded enough" for assertions that
// only check for the presence of cards/pills.
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
    // "card" is the legacy name for an awaiting row — the bare dock no
    // longer has a distinct full-card variant, but the feature file
    // still reads "1 card" and that maps cleanly onto the awaiting
    // bucket count.
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
  // `Cmd+Shift+B` (or `Ctrl+Shift+B` on non-macOS) drives
  // `toggleDock` — same behavior as the chrome-bar dock-toggle
  // button and the in-header chevron. Ctrl+B without shift is
  // reserved for the PTY (see prohibitedKeybinds.ts).
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

/** Rendered width of the outer dock aside, in CSS px. */
async function dockWidth(world: KoluWorld): Promise<number> {
  const box = await world.page.locator(DOCK_SELECTOR).boundingBox();
  if (!box) throw new Error("dock has no bounding box (not visible?)");
  return box.width;
}

/** The persisted cards width, read and parsed EXACTLY as production does
 *  (`JSON.parse` + a strict `typeof === "number"` check) — a stored value the
 *  real parser would reject fails here too, instead of being coerced with
 *  `Number(...)`. Returns `null` when the key is absent, `NaN` when present but
 *  not a finite JSON number (Playwright's evaluate serialization preserves both). */
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
    // The handle is `<Show>`-gated to the maximized cards sidebar, so it is
    // removed from the DOM in rail / tiled postures (not merely hidden).
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
    // Capture the pre-drag width so the follow-up can prove the drag widened it.
    this.savedDockWidth = await dockWidth(this);
    const handle = this.page.locator(DOCK_RESIZE_HANDLE_SELECTOR);
    const box = await handle.boundingBox();
    if (!box) throw new Error("dock resize handle has no bounding box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await this.page.mouse.move(cx, cy);
    await this.page.mouse.down();
    // Stepped move so the pointermove listeners fire like a real drag.
    await this.page.mouse.move(cx + dx, cy, { steps: 12 });
    await this.page.mouse.up();
    await this.waitForFrame();
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
  // Remember the post-drag RENDERED width so the persistence step can prove the
  // stored value matches what's on screen (not just "> default").
  this.savedDockWidth = await dockWidth(this);
});

Then(
  "the resized dock width should be persisted",
  async function (this: KoluWorld) {
    const rendered = this.savedDockWidth;
    if (rendered === undefined) {
      throw new Error("no post-drag dock width captured");
    }
    // The canonical stored value a reload consumes must equal the width on
    // screen (parsed strictly, as production does — see `storedDockWidth`).
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
    // Pre-drag rendered AND persisted width — the values the cancel must
    // restore. A cancelled drag never writes to storage (the commit only
    // happens on a completed drag), so `savedStoredDockWidth` may legitimately
    // be `null` here (no earlier drag in this scenario has persisted a value
    // yet) — the follow-up step compares against whatever this actually was,
    // not a hardcoded non-null expectation.
    this.savedDockWidth = await dockWidth(this);
    this.savedStoredDockWidth = await storedDockWidth(this);
    // Synthetic pointerdown → pointermove → pointercancel (same deterministic
    // pattern as mobile_soft_keyboard_steps.ts). pointerdown starts the gesture
    // on the handle; move/cancel go to `window`, where capturePointerGesture
    // listens. A live cancel branch reverts to the pre-drag width; a broken one
    // would leave the widened width.
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
    // Rendered width reverts...
    await this.page.waitForFunction(
      ({ selector, target }) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        return Math.abs(el.getBoundingClientRect().width - target) <= 4;
      },
      { selector: DOCK_SELECTOR, target: before },
      { timeout: POLL_TIMEOUT },
    );
    // ...and the persisted value is UNTOUCHED — a cancelled drag never wrote
    // to storage (only a completed drag commits, once, in onEnd), so this must
    // equal whatever was stored (or absent) before the drag started, not a
    // fresh write of the pre-drag width.
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
    // `resizeViewport` is the canonical helper — it waits TWO frames so the
    // layout reflow AND the xterm.js fit settle before the assertion reads back.
    await this.resizeViewport(width, this.page.viewportSize()?.height ?? 720);
  },
);

Then(
  "the dock resize handle should stay within the viewport",
  async function (this: KoluWorld) {
    const viewport = this.page.viewportSize();
    if (!viewport) throw new Error("no viewport size");
    // The whole point of the host cap: the handle at the dock's right edge must
    // stay on-screen so the user can always drag / double-click it back. With
    // the cap inert (the Round-2 ref bug) a wide drag overflows and this fails.
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
    // Default cards width is 288px; allow a small tolerance for layout rounding.
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
  // `data-maximized=""` is set on the outer aside when posture is
  // maximized; the dock renders as a flex sibling of the canvas (real
  // left panel) rather than a floating absolute overlay.
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
    // Translate the cucumber-friendly "Mod+..." into the platform-
    // specific Cmd/Ctrl that Playwright understands.
    const resolved = chord.replace(/\bMod\b/g, MOD_KEY);
    await this.page.keyboard.press(resolved);
    await this.waitForFrame();
  },
);

const SHORTCUT_HINT_SELECTOR = '[data-testid="dock-row-shortcut-hint"]';
// The active row is identified by the `data-active` attribute on the row
// itself — the visual treatment (lifted-card geometry, accent flood,
// pop-in animation) is painted by CSS keyed on that attribute. See the
// "Active dock row" section in `packages/client/src/index.css`.
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

// Repo-identity treatment: the section element draws the spine from a
// per-section `--repo-color` custom property (the single source the
// header tint, monogram, and name colour also read). Assert the
// structural facts via computed style, never a class name (e2e-testing
// rule): a solid left border whose width matches `--dock-edge-stripe-w`
// AND whose colour resolves to the same value as `--repo-color` — so a
// regression to e.g. `border-left: 5px solid red` (a non-repo hue) fails
// rather than slipping through. Width is read from the CSS token, not
// hardcoded, so a deliberate stripe-width bump does not orphan this
// assertion. `--repo-color` is an oklch() literal while `borderLeftColor`
// resolves to the browser's rgb form, so we normalise both through a
// throwaway probe element and compare the computed results.
Then(
  "the dock section should carry a repo-colour spine",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => {
        const sec = document.querySelector(sel);
        if (!sec) return false;
        const cs = getComputedStyle(sec);
        const repoColor = cs.getPropertyValue("--repo-color").trim();
        // Throw rather than returning false so a missing/empty --repo-color
        // surfaces a clear diagnostic instead of a generic timeout.
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
        // Validate before assigning: an invalid colour value is silently
        // rejected by the browser, causing getComputedStyle to fall back to
        // the inherited colour and producing a false positive/negative.
        if (!CSS.supports("color", repoColor))
          throw new Error(
            `--repo-color is not a valid CSS colour: "${repoColor}"`,
          );
        // Resolve the raw `--repo-color` literal to the same computed
        // colour form `borderLeftColor` already reports, then compare.
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
      (sel) => document.querySelectorAll(sel).length === 0,
      SHORTCUT_HINT_SELECTOR,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} shortcut hints",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ sel, count }) => document.querySelectorAll(sel).length === count,
      { sel: SHORTCUT_HINT_SELECTOR, count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock should show {int} foreground row containing {string}",
  async function (this: KoluWorld, expected: number, fragment: string) {
    // Foreground process line lives on quiet (idle/parked/none) rows
    // via `dock-quiet-foreground`. The text reads `meta.foreground.title
    // || .name` — a long-running shell command like `sleep N` will
    // populate it once the server publishes the new metadata.
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

// The footer tags itself `data-layout="rail"|"cards"`. The two layouts
// are different DOM (compact centered chip vs. inline sentence), so the
// attribute is the semantic signal that the reactive `<Show>` re-rendered
// the right branch after a mode toggle — not a frozen create-time choice.
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
