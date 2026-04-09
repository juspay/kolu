import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

/** Locator for the drag handle inside any sidebar entry. */
const DRAG_HANDLE = '[data-testid="sidebar-drag-handle"]';

Then(
  "the sidebar drag handle should be visible",
  async function (this: KoluWorld) {
    const handle = this.page.locator(DRAG_HANDLE).first();
    await handle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the sidebar card should have touch-action {string}",
  async function (this: KoluWorld, expected: string) {
    // Read the computed touch-action from the actual button DOM node — the
    // card surface that needs to stay scrollable on touch. Tailwind compiles
    // touch-pan-y to `touch-action: pan-y`.
    const card = this.page
      .locator('[data-testid="sidebar"] [data-terminal-id]')
      .first();
    await card.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const actual = await card.evaluate(
      (el) => getComputedStyle(el).touchAction,
    );
    assert.strictEqual(
      actual,
      expected,
      `Expected sidebar card touch-action to be "${expected}", got "${actual}"`,
    );
  },
);

When("I note the active terminal", async function (this: KoluWorld) {
  // Active sidebar entry carries the `data-active` attribute (set in
  // SidebarEntry when props.isActive). Snapshot the id for the
  // "should be unchanged" assertion below.
  const id = await this.page
    .locator('[data-testid="sidebar"] [data-active]')
    .first()
    .getAttribute("data-terminal-id");
  assert.ok(id, "No active sidebar entry found to note");
  this.savedActiveTerminalId = id;
});

When(
  "I tap the drag handle on a non-active sidebar entry",
  async function (this: KoluWorld) {
    // Find any sidebar entry that is NOT the active one and tap its grip.
    // Uses page.touchscreen.tap to dispatch a real touch event — a click
    // would also work since stopPropagation is on click, but tap exercises
    // the pointerdown path the dnd library actually subscribes to.
    const inactive = this.page
      .locator('[data-testid="sidebar"] [data-terminal-id]:not([data-active])')
      .first();
    await inactive.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const handle = inactive.locator(DRAG_HANDLE);
    const box = await handle.boundingBox();
    assert.ok(box, "Drag handle has no bounding box");
    await this.page.touchscreen.tap(
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    await this.waitForFrame();
  },
);

Then(
  "the active terminal should be unchanged",
  async function (this: KoluWorld) {
    const expected = this.savedActiveTerminalId;
    assert.ok(expected, "No active terminal was noted earlier");
    const current = await this.page
      .locator('[data-testid="sidebar"] [data-active]')
      .first()
      .getAttribute("data-terminal-id");
    assert.strictEqual(
      current,
      expected,
      `Active terminal changed: expected ${expected}, got ${current}`,
    );
  },
);
