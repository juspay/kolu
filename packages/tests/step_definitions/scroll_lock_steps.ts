import assert from "node:assert";
import { writeFile } from "node:fs/promises";
import { Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Per-scenario FIFO path (avoids collisions when CI runs parallel workers). */
function scrollFifo(world: KoluWorld): string {
  if (!world._scrollFifo) {
    world._scrollFifo = `/tmp/kolu-scroll-fifo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return world._scrollFifo;
}

When(
  "I generate {int} lines of output",
  async function (this: KoluWorld, count: number) {
    // Ensure terminal has focus (may have been lost to settings popover, etc.)
    await this.canvas.click();
    await this.terminalRun(
      `for i in $(seq 1 ${count}); do echo scroll-test-$i; done`,
    );
    await waitForBufferContains(this.page, `scroll-test-${count}`);
  },
);

When(
  "I generate {int} more lines of output",
  async function (this: KoluWorld, count: number) {
    await this.terminalRun(
      `for i in $(seq 1 ${count}); do echo extra-line-$i; done`,
    );
    // When scroll-locked, data is buffered (not written to xterm buffer).
    // Detect lock state by checking scroll-to-bottom button visibility.
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    if (await btn.isVisible()) {
      await this.page
        .locator('[data-testid="scroll-to-bottom"][data-active]')
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    } else {
      await waitForBufferContains(this.page, `extra-line-${count}`);
    }
  },
);

When("I scroll the terminal up", async function (this: KoluWorld) {
  const viewport = this.page.locator("[data-visible] .xterm-viewport");
  const box = await viewport.boundingBox();
  if (!box) throw new Error("Viewport not visible");
  // Move mouse to viewport center and scroll up
  await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await this.page.mouse.wheel(0, -500);
  await this.waitForFrame();
});

When("I note the scroll position", async function (this: KoluWorld) {
  this.savedScrollTop = await this.page
    .locator("[data-visible] .xterm-viewport")
    .evaluate((el) => el.scrollTop);
});

When("I prepare a output trigger", async function (this: KoluWorld) {
  // Create a FIFO so we can inject output without typing (which would clear scroll lock).
  // A background cat blocks on the FIFO until the test process writes to it.
  const fifo = scrollFifo(this);
  await this.terminalRun(`mkfifo ${fifo}`);
  await this.waitForFrame();
  await this.terminalRun(`cat ${fifo} &`);
  await this.waitForFrame();
});

When("I fire the output trigger", async function (this: KoluWorld) {
  // Write to the FIFO from the test process — bypasses xterm keyboard input
  // entirely, so scrollOnUserInput doesn't interfere with scroll lock state.
  const lines = Array.from({ length: 10 }, (_, i) => `triggered-${i + 1}`);
  await writeFile(scrollFifo(this), lines.join("\n") + "\n");
  // When scroll-locked, data is buffered — wait for the activity indicator
  await this.page
    .locator('[data-testid="scroll-to-bottom"][data-active]')
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

When(
  "I fire the output trigger with {int} lines",
  async function (this: KoluWorld, count: number) {
    const lines = Array.from({ length: count }, (_, i) => `triggered-${i + 1}`);
    await writeFile(scrollFifo(this), lines.join("\n") + "\n");
    // When scroll-locked, data is buffered — wait for the activity indicator
    await this.page
      .locator('[data-testid="scroll-to-bottom"][data-active]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** Read the first visible row from the xterm buffer at the current viewport position. */
function readFirstVisibleLine(world: KoluWorld) {
  return world.page.evaluate(() => {
    const container = document.querySelector(
      "[data-visible][data-terminal-id]",
    );
    const term = (container as any)?.__xterm;
    if (!term) return "";
    const buf = term.buffer.active;
    return buf.getLine(buf.viewportY)?.translateToString(true) ?? "";
  });
}

When("I note the visible terminal text", async function (this: KoluWorld) {
  this.savedVisibleText = await readFirstVisibleLine(this);
});

When("I click the scroll-to-bottom button", async function (this: KoluWorld) {
  await this.page.click('[data-testid="scroll-to-bottom"]');
  await this.waitForFrame();
});

When("I click the scroll lock toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="scroll-lock-toggle"]');
  await this.waitForFrame();
});

Then(
  "the scroll-to-bottom button should be visible",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the scroll-to-bottom button should be active",
  async function (this: KoluWorld) {
    const btn = this.page.locator(
      '[data-testid="scroll-to-bottom"][data-active]',
    );
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the scroll-to-bottom button should not be active",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const active = await btn.getAttribute("data-active");
    assert.strictEqual(active, null, "Expected button to not be active");
  },
);

Then(
  "the scroll-to-bottom button should not be visible",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the visible terminal text should be unchanged",
  async function (this: KoluWorld) {
    assert.ok(
      this.savedVisibleText,
      "No saved visible text — was 'I note the visible terminal text' called first?",
    );
    const current = await readFirstVisibleLine(this);
    assert.strictEqual(
      current,
      this.savedVisibleText,
      `Viewport content drifted: was "${this.savedVisibleText}", now "${current}"`,
    );
  },
);

Then(
  "the terminal should be scrolled to the bottom",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const container = document.querySelector(
          "[data-visible][data-terminal-id]",
        );
        const term = (container as any)?.__xterm;
        if (!term) return false;
        const buf = term.buffer.active;
        return buf.baseY <= buf.viewportY;
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the scroll position should be unchanged",
  async function (this: KoluWorld) {
    assert.ok(
      this.savedScrollTop !== undefined,
      "No saved scroll position — was 'I note the scroll position' called first?",
    );
    const current = await this.page
      .locator("[data-visible] .xterm-viewport")
      .evaluate((el) => el.scrollTop);
    // Allow small tolerance (1px) for rounding
    assert.ok(
      Math.abs(current - this.savedScrollTop!) <= 1,
      `Scroll position changed: was ${this.savedScrollTop}, now ${current}`,
    );
  },
);
