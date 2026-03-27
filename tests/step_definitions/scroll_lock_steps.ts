import { When, Then } from "@cucumber/cucumber";
import assert from "node:assert";
import { writeFile } from "node:fs/promises";
import { KoluWorld } from "../support/world.ts";

const SCROLL_FIFO = "/tmp/kolu-scroll-fifo";

/** Locate the xterm viewport div inside the active terminal. */
function viewportLocator(world: KoluWorld) {
  return world.page.locator("[data-visible] .xterm-viewport");
}

When(
  "I generate {int} lines of output",
  async function (this: KoluWorld, count: number) {
    await this.terminalRun(
      `for i in $(seq 1 ${count}); do echo scroll-test-$i; done`,
    );
    await this.page.waitForTimeout(1000);
  },
);

When(
  "I generate {int} more lines of output",
  async function (this: KoluWorld, count: number) {
    await this.terminalRun(
      `for i in $(seq 1 ${count}); do echo extra-line-$i; done`,
    );
    await this.page.waitForTimeout(1000);
  },
);

When("I scroll the terminal up", async function (this: KoluWorld) {
  const viewport = viewportLocator(this);
  const box = await viewport.boundingBox();
  if (!box) throw new Error("Viewport not visible");
  // Move mouse to viewport center and scroll up
  await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await this.page.mouse.wheel(0, -500);
  await this.page.waitForTimeout(500);
});

When("I note the scroll position", async function (this: KoluWorld) {
  this.savedScrollTop = await viewportLocator(this).evaluate(
    (el) => el.scrollTop,
  );
});

When("I prepare a output trigger", async function (this: KoluWorld) {
  // Create a FIFO so we can inject output without typing (which would clear scroll lock).
  // A background cat blocks on the FIFO until the test process writes to it.
  await this.terminalRun(`mkfifo ${SCROLL_FIFO}`);
  await this.page.waitForTimeout(300);
  await this.terminalRun(`cat ${SCROLL_FIFO} &`);
  await this.page.waitForTimeout(300);
});

When("I fire the output trigger", async function (this: KoluWorld) {
  // Write to the FIFO from the test process — bypasses xterm keyboard input
  // entirely, so scrollOnUserInput doesn't interfere with scroll lock state.
  const lines = Array.from({ length: 10 }, (_, i) => `triggered-${i + 1}`);
  await writeFile(SCROLL_FIFO, lines.join("\n") + "\n");
  await this.page.waitForTimeout(1000);
});

When(
  "I fire the output trigger with {int} lines",
  async function (this: KoluWorld, count: number) {
    const lines = Array.from({ length: count }, (_, i) => `triggered-${i + 1}`);
    await writeFile(SCROLL_FIFO, lines.join("\n") + "\n");
    await this.page.waitForTimeout(2000);
  },
);

/**
 * Read text of the first visible row from the xterm buffer.
 * Uses the __xterm ref exposed on the container element.
 */
function readFirstVisibleLine(world: KoluWorld) {
  return world.page.evaluate(() => {
    const container = document.querySelector(
      "[data-visible][data-terminal-id]",
    ) as HTMLElement & {
      __xterm?: {
        buffer: {
          active: {
            viewportY: number;
            getLine(
              y: number,
            ): { translateToString(trimRight?: boolean): string } | undefined;
          };
        };
      };
    };
    const term = container?.__xterm;
    if (!term) return "";
    const vY = term.buffer.active.viewportY;
    return term.buffer.active.getLine(vY)?.translateToString(true) ?? "";
  });
}

When("I note the visible terminal text", async function (this: KoluWorld) {
  this.savedVisibleText = await readFirstVisibleLine(this);
});

When("I click the scroll-to-bottom button", async function (this: KoluWorld) {
  await this.page.click('[data-testid="scroll-to-bottom"]');
  await this.page.waitForTimeout(300);
});

When("I click the scroll lock toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="scroll-lock-toggle"]');
  await this.page.waitForTimeout(200);
});

Then(
  "the scroll-to-bottom button should be visible",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "the scroll-to-bottom button should be active",
  async function (this: KoluWorld) {
    const btn = this.page.locator(
      '[data-testid="scroll-to-bottom"][data-active]',
    );
    await btn.waitFor({ state: "visible", timeout: 3000 });
  },
);

Then(
  "the scroll-to-bottom button should not be active",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "visible", timeout: 3000 });
    const active = await btn.getAttribute("data-active");
    assert.strictEqual(active, null, "Expected button to not be active");
  },
);

Then(
  "the scroll-to-bottom button should not be visible",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
    await btn.waitFor({ state: "hidden", timeout: 3000 });
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
  "the scroll position should be unchanged",
  async function (this: KoluWorld) {
    assert.ok(
      this.savedScrollTop !== undefined,
      "No saved scroll position — was 'I note the scroll position' called first?",
    );
    const current = await viewportLocator(this).evaluate((el) => el.scrollTop);
    // Allow small tolerance (1px) for rounding
    assert.ok(
      Math.abs(current - this.savedScrollTop!) <= 1,
      `Scroll position changed: was ${this.savedScrollTop}, now ${current}`,
    );
  },
);
