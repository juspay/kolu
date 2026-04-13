import { Given, When, Then } from "@cucumber/cucumber";
import {
  KoluWorld,
  SIDEBAR_ENTRY_SELECTOR,
  POLL_TIMEOUT,
} from "../support/world.ts";
import { waitForBufferContains } from "../support/buffer.ts";
import * as assert from "node:assert";

When("I create a terminal", async function (this: KoluWorld) {
  const id = await this.createTerminal();
  this.createdTerminalIds.push(id);
});

/** Shrinks the sidebar nav to roughly 1.5 entry-heights so overflow is
 *  forced with just 2 real terminals. Keeps parallel darwin CI workers
 *  from getting overloaded by large PTY spawn storms. */
async function clampSidebarNav(page: KoluWorld["page"]) {
  await page.evaluate(() => {
    const nav = document.querySelector(
      '[data-testid="sidebar"] nav',
    ) as HTMLElement | null;
    if (!nav) throw new Error("sidebar nav not found");
    const firstEntry = nav.querySelector(
      "[data-terminal-id]",
    ) as HTMLElement | null;
    if (!firstEntry) throw new Error("no sidebar entries to clamp against");
    const entryH = firstEntry.offsetHeight;
    nav.style.height = `${Math.round(entryH * 1.5)}px`;
    nav.style.flex = "none";
  });
}

When(
  "I clamp the sidebar nav and scroll to the top",
  async function (this: KoluWorld) {
    await clampSidebarNav(this.page);
    await this.page.evaluate(() => {
      const nav = document.querySelector(
        '[data-testid="sidebar"] nav',
      ) as HTMLElement;
      nav.scrollTop = 0;
    });
  },
);

When(
  "I clamp the sidebar nav and scroll to the bottom",
  async function (this: KoluWorld) {
    await clampSidebarNav(this.page);
    await this.page.evaluate(() => {
      const nav = document.querySelector(
        '[data-testid="sidebar"] nav',
      ) as HTMLElement;
      nav.scrollTop = nav.scrollHeight;
    });
  },
);

Then(
  "the active sidebar entry should be within the sidebar viewport",
  async function (this: KoluWorld) {
    // The active card's bounding box must sit fully inside the scrollable nav.
    // Without auto-scroll-on-active, switching to an off-screen terminal
    // leaves the active card outside these bounds.
    await this.page.waitForFunction(
      () => {
        const nav = document.querySelector(
          '[data-testid="sidebar"] nav',
        ) as HTMLElement | null;
        const active = nav?.querySelector(
          "[data-active]",
        ) as HTMLElement | null;
        if (!nav || !active) return false;
        const navBox = nav.getBoundingClientRect();
        const box = active.getBoundingClientRect();
        return box.top >= navBox.top && box.bottom <= navBox.bottom;
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I select terminal {int} in the sidebar",
  async function (this: KoluWorld, index: number) {
    // Select by the Nth terminal created in this scenario (1-based)
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    await this.page
      .locator(`[data-testid="sidebar"] [data-terminal-id="${id}"]`)
      .click();
    // Wait for the selected terminal to become active (data-visible attribute appears)
    await this.page
      .locator(`[data-terminal-id="${id}"][data-visible]`)
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
    // Let Terminal.tsx visibility effect fire (auto-focus + remeasure)
    await this.waitForFrame();
  },
);

Then(
  "the empty state tip should not be visible",
  async function (this: KoluWorld) {
    const tip = this.page.locator('[data-testid="empty-state"]');
    await tip.waitFor({ state: "hidden" });
  },
);

Given("I note the sidebar entry count", async function (this: KoluWorld) {
  this.savedSidebarCount = await this.page
    .locator(SIDEBAR_ENTRY_SELECTOR)
    .count();
});

Then(
  "the sidebar should have {int} more terminal entry/entries",
  async function (this: KoluWorld, delta: number) {
    const expected = (this.savedSidebarCount ?? 0) + delta;
    // Wait for entries to appear (onMount restores terminals asynchronously after refresh)
    const buttons = this.page.locator(SIDEBAR_ENTRY_SELECTOR);
    await buttons
      .nth(expected - 1)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const current = await buttons.count();
    const baseline = this.savedSidebarCount ?? 0;
    assert.strictEqual(
      current - baseline,
      delta,
      `Expected ${delta} new sidebar entries (baseline ${baseline}), got ${current - baseline} (total ${current})`,
    );
  },
);

Then(
  "the terminal should have keyboard focus",
  async function (this: KoluWorld) {
    // Ghostty uses a hidden textarea for keyboard input.
    // Verify focus is inside the active terminal container (data-visible), not the sidebar.
    // Poll — Corvu's focus trap release is async and can be slow under load.
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-visible]"),
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active terminal should show {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForBufferContains(this.page, expected);
  },
);

Then(
  "all terminals should report the same grid dimensions",
  async function (this: KoluWorld) {
    // Read every mounted xterm's cols/rows from the main terminal viewport.
    // Terminal.tsx exposes each xterm via containerRef.__xterm — we pull
    // cols/rows directly off it. Non-active terminals stuck at the default
    // 80×24 (because fit() can't measure a display:none container) will
    // disagree with the active terminal's fitted grid. Regression guard for
    // #398.
    await this.page.waitForFunction(
      () => {
        const nodes = Array.from(
          document.querySelectorAll(
            '[data-testid="terminal-viewport"] [data-terminal-id]',
          ),
        ) as (HTMLElement & {
          __xterm?: { cols: number; rows: number };
        })[];
        if (nodes.length < 2) return false;
        const first = nodes[0]!.__xterm;
        if (!first || first.cols <= 0 || first.rows <= 0) return false;
        return nodes.every(
          (n) =>
            n.__xterm &&
            n.__xterm.cols === first.cols &&
            n.__xterm.rows === first.rows,
        );
      },
      { timeout: POLL_TIMEOUT },
    );
    const dims = await this.page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll(
          '[data-testid="terminal-viewport"] [data-terminal-id]',
        ),
      ) as (HTMLElement & {
        __xterm?: { cols: number; rows: number };
      })[];
      return nodes.map((n) => ({
        id: n.getAttribute("data-terminal-id"),
        cols: n.__xterm?.cols ?? null,
        rows: n.__xterm?.rows ?? null,
      }));
    });
    assert.ok(dims.length >= 2, `Expected ≥2 terminals, got ${dims.length}`);
    const first = dims[0]!;
    for (const d of dims) {
      assert.strictEqual(
        `${d.cols}x${d.rows}`,
        `${first.cols}x${first.rows}`,
        `Terminal ${d.id} grid ${d.cols}x${d.rows} differs from ${first.id} ${first.cols}x${first.rows} — ${JSON.stringify(dims)}`,
      );
    }
  },
);
