import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { tapBackdropAtSafePoint } from "../support/drawer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

// ── Chrome (top pull-down) drawer ─────────────────────────────────────
const PULL_HANDLE = '[data-testid="mobile-pull-handle"]';
const CHROME_SHEET = '[data-testid="mobile-chrome-sheet"]';
const CHROME_BACKDROP = '[data-testid="mobile-chrome-backdrop"]';
// MobileChromeSheet reuses the same `palette-trigger` testid as the desktop
// ChromeBar's palette button. Scope to the open sheet to disambiguate.
const PALETTE_BTN = `${CHROME_SHEET} [data-testid="palette-trigger"]`;

// ── Dock (left swipe) drawer ──────────────────────────────────────────
const DOCK_HANDLE = '[data-testid="mobile-dock-handle"]';
const DOCK_SHEET = '[data-testid="mobile-dock-sheet"]';
const DOCK_BACKDROP = '[data-testid="mobile-dock-backdrop"]';
const DOCK_ROW = '[data-testid="mobile-dock-row"]';

// ── Chrome drawer steps ───────────────────────────────────────────────

When("I tap the mobile pull handle", async function (this: KoluWorld) {
  await this.page.locator(PULL_HANDLE).tap();
});

// Mouse-click path companion — see `I click the mobile dock handle` below
// for the rationale (Corvu touch vs. mouse open paths differ; #977).
When("I click the mobile pull handle", async function (this: KoluWorld) {
  await this.page.locator(PULL_HANDLE).click();
});

When("I tap the mobile chrome backdrop", async function (this: KoluWorld) {
  await this.page.locator(CHROME_BACKDROP).tap();
});

When(
  "I tap the palette button in the drawer",
  async function (this: KoluWorld) {
    await this.page.locator(PALETTE_BTN).tap();
  },
);

Then(
  "the mobile chrome sheet should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(CHROME_SHEET)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile chrome sheet should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(CHROME_SHEET)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

When("I drag down on the mobile pull handle", async function (this: KoluWorld) {
  const box = await this.page.locator(PULL_HANDLE).boundingBox();
  assert.ok(box, "Pull handle has no bounding box");
  const x = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  // Downward drag well past `PULL_OPEN_THRESHOLD` (24px). MobileTileView
  // commits to opening as soon as `touchmove` crosses the threshold, so the
  // single move below is enough; the trailing `touchend` just tidies state.
  const endY = startY + 60;
  // Ship plain-JS source string — tsx/esbuild instruments nested function
  // declarations with `__name` debug helpers that don't exist in the
  // browser (see mobile_swipe_steps.ts for the same workaround).
  const src = `
    (() => {
      const target = document.querySelector(${JSON.stringify(PULL_HANDLE)});
      if (!target) throw new Error("pull handle not found");
      const mkTouch = (y) => new Touch({
        identifier: 1, target, clientX: ${x}, clientY: y,
        pageX: ${x}, pageY: y, screenX: ${x}, screenY: y,
        radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
      });
      target.dispatchEvent(new TouchEvent("touchstart", {
        cancelable: true, bubbles: true,
        touches: [mkTouch(${startY})],
        targetTouches: [mkTouch(${startY})],
        changedTouches: [mkTouch(${startY})],
      }));
      target.dispatchEvent(new TouchEvent("touchmove", {
        cancelable: true, bubbles: true,
        touches: [mkTouch(${endY})],
        targetTouches: [mkTouch(${endY})],
        changedTouches: [mkTouch(${endY})],
      }));
      target.dispatchEvent(new TouchEvent("touchend", {
        cancelable: true, bubbles: true,
        touches: [], targetTouches: [],
        changedTouches: [mkTouch(${endY})],
      }));
    })()
  `;
  await this.page.evaluate(src);
  await this.waitForFrame();
});

When(
  "I drag the mobile chrome sheet up to dismiss",
  async function (this: KoluWorld) {
    // Corvu wires drag-to-dismiss on Drawer.Content: element-level
    // `pointerdown` + `touchstart` capture the drag start; `touchmove` and
    // `touchend` listeners live on `document`, picking up bubbled events.
    // For `side="top"`, the dismiss direction is upward — drag the sheet
    // most of its height to land on the "closed" snap point.
    const box = await this.page.locator(CHROME_SHEET).boundingBox();
    assert.ok(box, "Mobile chrome sheet has no bounding box");
    // Anchor the drag near the top of the sheet (the drag-grip area) so the
    // touch target is draggable per Corvu's `locationIsDraggable` walk —
    // pill rows and control buttons stop pointerdown propagation.
    const x = box.x + box.width / 2;
    const startY = box.y + 10;
    // Drag well past the sheet's own height so Corvu's closest-snap-point
    // calculation lands on "closed" (offset === drawerSize). Negative
    // clientY is valid for synthetic events — the browser doesn't clamp.
    const endY = startY - box.height * 1.5 - 40;
    const stepCount = 8;
    const ys: number[] = [];
    for (let i = 1; i <= stepCount; i++) {
      ys.push(startY + ((endY - startY) * i) / stepCount);
    }
    const src = `
      (() => {
        const target = document.querySelector(${JSON.stringify(CHROME_SHEET)});
        if (!target) throw new Error("mobile chrome sheet not found");
        const mkTouch = (y) => new Touch({
          identifier: 1, target, clientX: ${x}, clientY: y,
          pageX: ${x}, pageY: y, screenX: ${x}, screenY: y,
          radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1,
        });
        target.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true,
          pointerType: "touch", pointerId: 1,
          button: 0, buttons: 1,
          clientX: ${x}, clientY: ${startY},
        }));
        target.dispatchEvent(new TouchEvent("touchstart", {
          cancelable: true, bubbles: true,
          touches: [mkTouch(${startY})],
          targetTouches: [mkTouch(${startY})],
          changedTouches: [mkTouch(${startY})],
        }));
        for (const y of ${JSON.stringify(ys)}) {
          target.dispatchEvent(new TouchEvent("touchmove", {
            cancelable: true, bubbles: true,
            touches: [mkTouch(y)],
            targetTouches: [mkTouch(y)],
            changedTouches: [mkTouch(y)],
          }));
        }
        target.dispatchEvent(new TouchEvent("touchend", {
          cancelable: true, bubbles: true,
          touches: [], targetTouches: [],
          changedTouches: [mkTouch(${endY})],
        }));
      })()
    `;
    await this.page.evaluate(src);
    await this.waitForFrame();
  },
);

// ── Dock drawer steps ─────────────────────────────────────────────────

When("I tap the mobile dock handle", async function (this: KoluWorld) {
  await this.page.locator(DOCK_HANDLE).tap();
});

// Mouse-click path: Playwright's `.tap()` synthesises touch events, which
// take a different code path in Corvu than mouse clicks. Desktop debugging
// (DevTools touch emulation) lands on this path — see #977.
When("I click the mobile dock handle", async function (this: KoluWorld) {
  await this.page.locator(DOCK_HANDLE).click();
});

When("I tap the mobile dock backdrop", async function (this: KoluWorld) {
  await tapBackdropAtSafePoint(this, DOCK_BACKDROP, "left");
});

When("I tap the inactive mobile dock row", async function (this: KoluWorld) {
  // The drawer always shows every terminal; one carries `data-active`. The
  // other(s) are tap targets to switch. With the two-terminal background
  // (one auto + one explicit create) there is exactly one inactive row.
  await this.page.locator(`${DOCK_ROW}:not([data-active])`).first().tap();
});

Then(
  "the mobile dock sheet should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(DOCK_SHEET)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile dock sheet should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(DOCK_SHEET)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);
