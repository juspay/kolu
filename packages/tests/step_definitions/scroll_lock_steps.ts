import assert from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Then, When } from "@cucumber/cucumber";
import { shellQuoteArg } from "@kolu/shell-quote";
import { ACTIVE_TERMINAL, waitForBufferContains } from "../support/buffer.ts";
import {
  retireWorldScrollFifo,
  SCROLL_FIFO_DIR_PREFIX,
} from "../support/scrollFifo.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

function scrollFifo(world: KoluWorld): string {
  if (!world._scrollFifo) throw new Error("output trigger was not prepared");
  return world._scrollFifo;
}

When(
  "I generate {int} lines of output",
  async function (this: KoluWorld, count: number) {
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
  await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await this.page.mouse.wheel(0, -500);
  await this.waitForFrame();
});

When("I note the scroll position", async function (this: KoluWorld) {
  this.savedScrollTop = await this.page
    .locator("[data-visible] .xterm-viewport")
    .evaluate((el) => el.scrollTop);
});

async function cursorRowMatching(
  world: KoluWorld,
  expected: string | null,
): Promise<string> {
  const handle = await world.page.waitForFunction(
    ({ sel, want }) => {
      const term = document.querySelector<HTMLDivElement>(sel)?.__xterm;
      if (!term) return null;
      const buf = term.buffer.active;
      const row =
        buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? "";
      const hit = want === null ? row !== "" : row === want;
      return hit ? row : null;
    },
    { sel: ACTIVE_TERMINAL, want: expected },
    { timeout: POLL_TIMEOUT, polling: 20 },
  );
  return (await handle.jsonValue()) ?? "";
}

async function currentPromptRow(world: KoluWorld): Promise<string> {
  return cursorRowMatching(world, null);
}

async function waitForPromptBack(
  world: KoluWorld,
  prompt: string,
): Promise<void> {
  await cursorRowMatching(world, prompt);
}

When("I prepare a output trigger", async function (this: KoluWorld) {
  const fifoDir = await mkdtemp(join(tmpdir(), SCROLL_FIFO_DIR_PREFIX));
  const fifo = join(fifoDir, "trigger");
  await writeFile(join(fifoDir, "owner"), String(process.pid));
  this._scrollFifo = fifo;
  const quotedFifo = shellQuoteArg(fifo);
  const prompt = await currentPromptRow(this);
  await this.terminalRunAndWait(`mkfifo ${quotedFifo}`);
  await this.terminalRunAndWait(`cat ${quotedFifo} & true`);
  await waitForPromptBack(this, prompt);
});

When("I fire the output trigger", async function (this: KoluWorld) {
  const lines = Array.from({ length: 10 }, (_, i) => `triggered-${i + 1}`);
  await writeFile(scrollFifo(this), `${lines.join("\n")}\n`);
  await retireWorldScrollFifo(this);
  await this.page
    .locator('[data-testid="scroll-to-bottom"][data-active]')
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

When(
  "I fire the output trigger with {int} lines",
  async function (this: KoluWorld, count: number) {
    const lines = Array.from({ length: count }, (_, i) => `triggered-${i + 1}`);
    await writeFile(scrollFifo(this), `${lines.join("\n")}\n`);
    await retireWorldScrollFifo(this);
    await this.page
      .locator('[data-testid="scroll-to-bottom"][data-active]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "the terminal viewport is scrolled up programmatically",
  async function (this: KoluWorld) {
    await this.page.evaluate(() => {
      const container = document.querySelector<HTMLDivElement>(
        "[data-visible][data-terminal-id]",
      );
      const term = container?.__xterm;
      if (!term) throw new Error("xterm not found on active terminal");
      term.scrollLines(-10);
    });
    await this.waitForFrame();
  },
);

When(
  "I fire the output trigger expecting live output",
  async function (this: KoluWorld) {
    const lines = Array.from({ length: 10 }, (_, i) => `triggered-${i + 1}`);
    await writeFile(scrollFifo(this), `${lines.join("\n")}\n`);
    await retireWorldScrollFifo(this);
    await waitForBufferContains(this.page, "triggered-10");
  },
);

When("the browser tab is backgrounded", async function (this: KoluWorld) {
  // Playwright can't truly background a headless tab, so override the Page
  // Visibility API in-page: subsequent reads of document.visibilityState /
  // document.hidden report "hidden" until restored. A scroll-lock that
  // engages now is therefore recorded as having engaged while hidden — the
  // exact precondition handleTabVisible releases on return (#1272).
  // Method-shorthand getters (not `get: () =>`): the tsx/esbuild `keepNames`
  // transform wraps property-assigned arrows with a `__name()` helper that
  // isn't defined in the page, but leaves intrinsically-named accessors alone.
  await this.page.evaluate(() => {
    const win = window as unknown as { __koluHidden?: boolean };
    win.__koluHidden = true;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get() {
        return win.__koluHidden === true;
      },
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get() {
        return win.__koluHidden ? "hidden" : "visible";
      },
    });
  });
  await this.waitForFrame();
});

When("the browser tab becomes visible again", async function (this: KoluWorld) {
  await this.page.evaluate(() => {
    (window as unknown as { __koluHidden?: boolean }).__koluHidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await this.waitForFrame();
});

Then(
  "the terminal buffer should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForBufferContains(this.page, expected);
  },
);

function readFirstVisibleLine(world: KoluWorld) {
  return world.page.evaluate(() => {
    const container = document.querySelector<HTMLDivElement>(
      "[data-visible][data-terminal-id]",
    );
    const term = container?.__xterm;
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
        const container = document.querySelector<HTMLDivElement>(
          "[data-visible][data-terminal-id]",
        );
        const term = container?.__xterm;
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
    const saved = this.savedScrollTop;
    assert.ok(
      saved !== undefined,
      "No saved scroll position — was 'I note the scroll position' called first?",
    );
    const current = await this.page
      .locator("[data-visible] .xterm-viewport")
      .evaluate((el) => el.scrollTop);
    assert.ok(
      Math.abs(current - saved) <= 1,
      `Scroll position changed: was ${saved}, now ${current}`,
    );
  },
);
