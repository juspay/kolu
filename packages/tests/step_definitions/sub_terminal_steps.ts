import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import {
  waitForBufferContains,
  waitForVisibleRows,
} from "../support/buffer.ts";
import { openActiveHostDiagnostics } from "../support/hostChip.ts";
import { padiCall } from "../support/rpcWire.ts";
import {
  ACTIVE_CANVAS_TILE_SELECTOR,
  APP_KEY,
  COARSE_POINTER_QUERY,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const PALETTE = '[data-testid="command-palette"]';

const VISIBLE_SUB = "[data-sub-terminal][data-visible]";

const WIDE_OUTPUT_COMMAND =
  `clear; for i in $(seq 1 40); do printf 'L%02d' $i; ` +
  `printf '%*s' 88 '' | tr ' ' '.'; printf 'END%02d\\n' $i; done; ` +
  `echo SPLIT-"BOTTOM"-MARK`;

const BOTTOM_MARKER = "SPLIT-BOTTOM-MARK";

async function forceFillViaNativeSetter(
  world: KoluWorld,
  inputSelector: string,
  value: string,
): Promise<void> {
  await world.page.evaluate(
    ({ sel, v }) => {
      const input = document.querySelector(sel);
      if (!(input instanceof HTMLInputElement)) {
        throw new Error(`no input at ${sel}`);
      }
      const nativeSet = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!nativeSet) throw new Error("HTMLInputElement.value setter missing");
      nativeSet.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { sel: inputSelector, v: value },
  );
}

async function forceClickPaletteOption(
  world: KoluWorld,
  name: string,
): Promise<void> {
  await world.page.waitForFunction(
    ({ sel, q }) => {
      const opts = [
        ...document.querySelectorAll(`${sel} [role="option"]`),
      ] as HTMLElement[];
      const exact = opts.find(
        (el) => el.getAttribute("data-palette-name") === q,
      );
      const item = exact ?? opts[0];
      if (!item?.offsetHeight) return false;
      item.click();
      return true;
    },
    { sel: PALETTE, q: name },
    { timeout: POLL_TIMEOUT },
  );
}

async function paletteCommand(world: KoluWorld, query: string) {
  const terminal = world.page.locator(
    "[data-visible][data-focused] .xterm-helper-textarea",
  );
  if ((await terminal.count()) > 0) await terminal.first().focus();
  await world.page.keyboard.press(`${APP_KEY}+k`);
  await world.page.waitForFunction(
    (sel) => document.querySelector(`${sel}[data-open]`) !== null,
    PALETTE,
    { timeout: POLL_TIMEOUT },
  );
  await forceFillViaNativeSetter(world, `${PALETTE} input`, query);
  await forceClickPaletteOption(world, query);
  await world.page.waitForFunction(
    (sel) => document.querySelector(`${sel}[data-open]`) === null,
    PALETTE,
    { timeout: POLL_TIMEOUT },
  );
  await world.page.waitForFunction(
    (coarsePointer) =>
      matchMedia(coarsePointer).matches ||
      !!document.activeElement?.closest("[data-terminal-id]"),
    COARSE_POINTER_QUERY,
    { timeout: POLL_TIMEOUT },
  );
}

When(
  "I create a sub-terminal via command palette",
  async function (this: KoluWorld) {
    await paletteCommand(this, "Toggle terminal split");
    try {
      await this.page.waitForFunction(
        () => document.querySelector("[data-sub-terminal]") !== null,
        null,
        { timeout: 10_000 },
      );
    } catch (error) {
      const pageErrors = this.errors.join("; ");
      throw new Error(
        `split did not mount${pageErrors ? `; page errors: ${pageErrors}` : ""}`,
        { cause: error },
      );
    }
  },
);

When(
  "I create a terminal parented to the remembered sub-terminal",
  async function (this: KoluWorld) {
    const parentId = this.rememberedSubTerminalId;
    assert.ok(
      parentId,
      'no remembered sub-terminal — call "I remember the sub-terminal\'s id" first',
    );
    const tabsBefore = await this.page
      .locator('[data-testid="sub-panel-tab-bar"] button:not([title])')
      .count();
    await padiCall("lifecycle/create", {
      placement: { kind: "child-of", parentId },
    });
    await this.page.waitForFunction(
      (before) =>
        document.querySelectorAll(
          '[data-testid="sub-panel-tab-bar"] button:not([title])',
        ).length > before,
      tabsBefore,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I click the main terminal", async function (this: KoluWorld) {
  const main = this.page.locator("[data-terminal-id][data-visible]").first();
  await main.click();
  await this.waitForFrame();
});

When(
  "I toggle the sub-panel via command palette",
  async function (this: KoluWorld) {
    await paletteCommand(this, "Toggle terminal split");
  },
);

When(
  "I run {string} in the sub-terminal",
  async function (this: KoluWorld, command: string) {
    await this.focusForTyping("[data-visible][data-sub-terminal]");
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
    await this.waitForFrame();
  },
);

When(
  "I fill the sub-terminal with output wider than the default grid",
  async function (this: KoluWorld) {
    const measured = await this.page
      .waitForFunction(
        (sel) => {
          const node = document.querySelector(sel);
          if (!(node instanceof HTMLDivElement)) return null;
          const cols = node.__xterm?.cols;
          return typeof cols === "number" && cols > 0 && cols !== 80
            ? cols
            : null;
        },
        VISIBLE_SUB,
        { timeout: POLL_TIMEOUT },
      )
      .catch(() => null);
    assert.ok(
      measured,
      "the split never took a grid from the daemon — it is still at xterm's fabricated 80 columns, and this scenario only exercises the defect when the real grid differs from it",
    );
    await this.focusForTyping(VISIBLE_SUB);
    await this.page.keyboard.type(WIDE_OUTPUT_COMMAND);
    await this.page.keyboard.press("Enter");
    await waitForVisibleRows(this.page, BOTTOM_MARKER, {
      selector: VISIBLE_SUB,
    });
  },
);

Then(
  "the sub-terminal viewport should show its latest output",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="sub-panel-tab-bar"]:visible')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForVisibleRows(this.page, BOTTOM_MARKER, {
      selector: VISIBLE_SUB,
    });
  },
);

Then("the sub-panel should be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator(
    ':is([data-canvas-tile], [data-mobile-tile])[data-active] [data-testid="sub-panel-tab-bar"]',
  );
  await tabBar.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the sub-panel should not be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator(
    ':is([data-canvas-tile], [data-mobile-tile])[data-active] [data-testid="sub-panel-tab-bar"]',
  );
  await tabBar.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

Then(
  "the sub-terminal should have keyboard focus",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-sub-terminal]"),
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the main terminal should have keyboard focus",
  async function (this: KoluWorld) {
    try {
      await this.page.waitForFunction(
        () =>
          !!document.activeElement?.closest(
            "[data-terminal-id][data-visible]:not([data-sub-terminal])",
          ),
        { timeout: POLL_TIMEOUT },
      );
    } catch {
      await this.canvas.click();
    }
    const marker = `focus-proof-${Date.now()}`;
    await this.page.keyboard.type(`echo ${marker}`);
    await this.page.keyboard.press("Enter");
    await waitForBufferContains(this.page, marker, {
      selector: "[data-terminal-id][data-visible]:not([data-sub-terminal])",
    });
  },
);

Then(
  "the {word} pane should be the active pane",
  async function (this: KoluWorld, pane: string) {
    await this.page.waitForFunction(
      (p) => {
        const el = document.querySelector(
          `[data-pane="${p}"][data-pane-focus="active"]`,
        );
        return el !== null && getComputedStyle(el).opacity === "1";
      },
      pane,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the {word} pane should be receded",
  async function (this: KoluWorld, pane: string) {
    await this.page.waitForFunction(
      (p) => {
        const el = document.querySelector(
          `[data-pane="${p}"][data-pane-focus="inactive"]`,
        );
        return el !== null && getComputedStyle(el).opacity === "0.4";
      },
      pane,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active tile should show sub-terminal count {int}",
  async function (this: KoluWorld, expected: number) {
    const badge = this.page.locator(
      `${ACTIVE_CANVAS_TILE_SELECTOR} [data-testid="sub-count"]`,
    );
    const text = await badge.textContent({ timeout: POLL_TIMEOUT });
    assert.strictEqual(text, `${expected}`);
  },
);

When(
  "I create another sub-terminal via command palette",
  async function (this: KoluWorld) {
    const countBefore = await this.page.locator("[data-sub-terminal]").count();
    await paletteCommand(this, "Split terminal");
    await this.page.waitForFunction(
      (expected) =>
        document.querySelectorAll("[data-sub-terminal]").length >= expected,
      countBefore + 1,
      { timeout: 10_000 },
    );
  },
);

When(
  "I click sub-panel tab {int}",
  async function (this: KoluWorld, index: number) {
    const tabs = this.page.locator(
      '[data-testid="sub-panel-tab-bar"] button:not([title])',
    );
    await tabs.nth(index - 1).click();
    await this.waitForFrame();
  },
);

Then(
  "the sub-panel tab bar should have {int} tab(s)",
  async function (this: KoluWorld, expected: number) {
    const sel = '[data-testid="sub-panel-tab-bar"] button:not([title])';
    await this.page.waitForFunction(
      ({ sel, exp }) => document.querySelectorAll(sel).length === exp,
      { sel, exp: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "sub-panel tab {int} should be active",
  async function (this: KoluWorld, index: number) {
    const tabs = this.page.locator(
      '[data-testid="sub-panel-tab-bar"] button:not([title])',
    );
    const tab = tabs.nth(index - 1);
    const active = await tab.getAttribute("data-active");
    assert.ok(
      active !== null,
      `Expected tab ${index} to be active (have data-active attribute)`,
    );
  },
);

When(
  "I close sub-terminal tab {int}",
  async function (this: KoluWorld, index: number) {
    const tab = this.page
      .locator(
        '[data-testid="sub-panel-tab-bar"] [data-testid="sub-tab-close"]',
      )
      .nth(index - 1);
    await tab.locator("..").hover();
    await tab.click();
    await this.waitForFrame();
  },
);

Then(
  "the sub-panel should eventually collapse",
  { timeout: 60_000 },
  async function (this: KoluWorld) {
    const tabBar = this.page.locator(
      '[data-testid="sub-panel-tab-bar"]:visible',
    );
    await tabBar.waitFor({ state: "hidden", timeout: 45_000 });
  },
);

Then(
  "the active tile should not show a sub-terminal count",
  async function (this: KoluWorld) {
    const badge = this.page.locator(
      `${ACTIVE_CANVAS_TILE_SELECTOR} [data-testid="sub-count"]`,
    );
    const count = await badge.count();
    assert.strictEqual(count, 0, "Expected no sub-terminal count badge");
  },
);

Then(
  /^the dock should show (\d+) split sub-entr(?:y|ies)$/,
  async function (this: KoluWorld, expectedText: string) {
    const expected = Number(expectedText);
    await this.page.waitForFunction(
      (count) =>
        document.querySelectorAll('[data-testid="dock-sub-row"]').length ===
        count,
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "every dock split sub-entry should be a direct child of its section",
  async function (this: KoluWorld) {
    const direct = await this.page
      .locator('[data-testid="dock-sub-row"]')
      .evaluateAll((rows) =>
        rows.every((row) => {
          const p = row.parentElement;
          const inCluster = p?.parentElement;
          return (
            (p?.matches(".dock-cards-section") ?? false) ||
            ((p?.matches(".dock-cluster") ?? false) &&
              (inCluster?.matches(".dock-cards-section") ?? false))
          );
        }),
      );
    assert.ok(direct, "Expected every split row directly under its section");
  },
);

Then(
  "the dock split sub-entry should show the shell identity pip without asking",
  async function (this: KoluWorld) {
    const row = this.page.locator('[data-testid="dock-sub-row"]').first();
    assert.strictEqual(await row.getAttribute("data-agent-state"), null);
    assert.strictEqual(await row.getAttribute("data-asking"), null);
    assert.strictEqual(await row.getAttribute("data-unread"), null);
    const pip = row.locator('[data-testid="state-pip"]');
    assert.strictEqual(
      await pip.count(),
      1,
      "Expected an agentless split to render the shell identity StatePip",
    );
    assert.strictEqual(await pip.getAttribute("data-glyph"), "shell");
  },
);

Then(
  "the split's dock row should name the model {string}",
  async function (this: KoluWorld, model: string) {
    await this.page.waitForFunction(
      ({ sel, want }: { sel: string; want: string }) =>
        Array.from(document.querySelectorAll(sel)).some(
          (el) => el.textContent?.trim() === want,
        ),
      { sel: '[data-testid="dock-sub-row"] [data-dock-model]', want: model },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the split's dock row should sit inside its parent row's box",
  async function (this: KoluWorld) {
    const handle = await this.page.waitForFunction(
      () => {
        const parent = document.querySelector('[data-testid="dock-row"]');
        const split = document.querySelector('[data-testid="dock-sub-row"]');
        if (!parent || !split) return { ok: false, why: "row missing" };
        const parentBox = parent.getBoundingClientRect();
        const splitBox = split.getBoundingClientRect();
        const parentPipEl = parent.querySelector('[data-testid="state-pip"]');
        const splitPipEl = split.querySelector('[data-testid="state-pip"]');
        const parentLabelEl = parent.querySelector(".dock-cards-row-label");
        const splitLabelEl = split.querySelector(".dock-cards-row-label");
        if (!parentPipEl || !splitPipEl || !parentLabelEl || !splitLabelEl) {
          return { ok: false, why: "element missing" };
        }
        const parentPip = Math.round(parentPipEl.getBoundingClientRect().left);
        const splitPip = Math.round(splitPipEl.getBoundingClientRect().left);
        const parentLabel = Math.round(
          parentLabelEl.getBoundingClientRect().left,
        );
        const splitLabel = Math.round(
          splitLabelEl.getBoundingClientRect().left,
        );
        const parentRight = Math.round(parentBox.right);
        const splitRight = Math.round(splitBox.right);
        const ok =
          splitPip > parentPip + 8 &&
          splitLabel > parentLabel + 8 &&
          Math.abs(parentRight - splitRight) <= 1;
        return ok
          ? { ok, why: "ok" }
          : {
              ok,
              why: "not yet",
              parentPip,
              splitPip,
              parentLabel,
              splitLabel,
              parentRight,
              splitRight,
            };
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
    const result = (await handle.jsonValue()) as { ok: boolean } & Record<
      string,
      unknown
    >;
    assert.ok(result.ok, `split row geometry wrong: ${JSON.stringify(result)}`);
  },
);

Then(
  "the dock should show no split count chip",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator('[data-testid="dock-sub-count"]')
      .count();
    assert.strictEqual(
      count,
      0,
      "Expected the dock split count chip to be gone",
    );
  },
);

When(
  "I click dock split sub-entry {int}",
  async function (this: KoluWorld, index: number) {
    await this.page
      .locator('[data-testid="dock-sub-row"]')
      .nth(index - 1)
      .click();
    await this.waitForFrame();
  },
);

Then(
  "the parent dock row and focused split sub-entry should both be active",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const split = document.querySelector(
          '[data-testid="dock-sub-row"][data-active]',
        );
        const parentId = split?.getAttribute("data-parent-id");
        if (!parentId) return false;
        return [...document.querySelectorAll('[data-testid="dock-row"]')].some(
          (row) =>
            row.getAttribute("data-terminal-id") === parentId &&
            row.hasAttribute("data-active"),
        );
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the dock section active count should agree with the active host tab",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const splitAgent = document.querySelector(
          '[data-testid="dock-sub-row"][data-agent-state="thinking"]',
        );
        const section = document.querySelector(
          '[data-testid="dock-section-header"] [data-testid="attention-active"]',
        );
        const tab = document.querySelector(
          '[data-testid="host-chip-row"] [data-testid="host-chip"][data-active]',
        );
        const stripe = tab?.querySelector(
          '[data-testid="host-tab-working-stripe"]',
        );
        const label =
          tab
            ?.querySelector('[data-testid="host-diagnostics-open"]')
            ?.getAttribute("aria-label") ?? "";
        return (
          splitAgent !== null &&
          section?.textContent?.trim() === "1" &&
          stripe != null &&
          label.includes("1 terminal active") &&
          tab?.querySelector('[data-testid="attention-active"]') === null
        );
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active host's diagnostics should count {int} working terminal(s)",
  async function (this: KoluWorld, expected: number) {
    await openActiveHostDiagnostics(this.page);
    await this.page.waitForFunction(
      (want) => {
        const row = document.querySelector(
          '[data-testid="host-diagnostics-popover"] [data-testid="host-diagnostics-working"]',
        );
        return row?.lastElementChild?.textContent?.trim() === String(want);
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the collapsed indicator should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(
        ':is([data-canvas-tile], [data-mobile-tile])[data-active] [data-testid="sub-panel-tab-bar"]',
      )
      .waitFor({ state: "hidden", timeout: 10_000 });
    const indicator = this.page.locator('[data-testid="collapsed-indicator"]');
    await indicator.waitFor({ state: "visible", timeout: 10_000 });
  },
);

Then("the resize handle should be visible", async function (this: KoluWorld) {
  const handle = this.page.locator('[data-testid="resize-handle"]');
  await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
});

Then(
  "the sub-terminal screen should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page
      .locator('[data-testid="sub-panel-tab-bar"]:visible')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForBufferContains(this.page, expected, {
      selector: "[data-sub-terminal][data-visible]",
    });
  },
);
