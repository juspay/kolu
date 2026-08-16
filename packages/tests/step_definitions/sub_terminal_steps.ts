import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { padiCall } from "../support/rpcWire.ts";
import {
  ACTIVE_CANVAS_TILE_SELECTOR,
  COARSE_POINTER_QUERY,
  type KoluWorld,
  MOD_KEY,
  POLL_TIMEOUT,
} from "../support/world.ts";

const PALETTE = '[data-testid="command-palette"]';

/** The visible split — the pane a user is actually looking at. */
const VISIBLE_SUB = "[data-sub-terminal][data-visible]";

/** Payload for the hidden-split render scenario: 40 lines of ~95 columns.
 *  Wider than xterm's fabricated 80-column default on purpose — a snapshot the
 *  host serialized at the REAL grid, painted into that invented grid, wraps
 *  every line and leaves the viewport pointing at the wrong rows.
 *
 *  The trailing marker is shell-QUOTED here so the shell's own echo of this
 *  command line reads `SPLIT-"BOTTOM"-MARK` and can never satisfy an assertion
 *  looking for the unquoted `SPLIT-BOTTOM-MARK` that only `echo`'s OUTPUT
 *  produces (`.claude/rules/e2e-testing.md` — no vacuous assertions). */
const WIDE_OUTPUT_COMMAND =
  `clear; for i in $(seq 1 40); do printf 'L%02d' $i; ` +
  `printf '%*s' 88 '' | tr ' ' '.'; printf 'END%02d\\n' $i; done; ` +
  `echo SPLIT-"BOTTOM"-MARK`;

/** Printed last, so seeing it means seeing the LIVE BOTTOM of the split. */
const BOTTOM_MARKER = "SPLIT-BOTTOM-MARK";

/**
 * Open command palette, fill a query, click the first result, wait for close.
 * Uses evaluate to fill the input and click the result because Corvu's dialog
 * content visibility is state-based — Playwright's actionability checks see
 * elements as "hidden" during the open transition even with CSS animations
 * disabled. The evaluate approach bypasses these checks entirely.
 */
async function paletteCommand(world: KoluWorld, query: string) {
  // Ensure focus is in the app (previous palette close may leave focus nowhere)
  const terminal = world.page.locator("[data-visible] [data-terminal-screen]");
  if ((await terminal.count()) > 0) await terminal.first().click();
  await world.page.keyboard.press(`${MOD_KEY}+k`);
  await world.page.waitForFunction(
    (sel) => document.querySelector(`${sel}[data-open]`) !== null,
    PALETTE,
    { timeout: POLL_TIMEOUT },
  );
  await world.page.evaluate(
    ({ sel, q }) => {
      const input = document.querySelector(`${sel} input`) as HTMLInputElement;
      if (!input) throw new Error("Palette input not found");
      // Bypass Solid's reactivity by calling the native HTMLInputElement.value
      // setter directly. Both lookups should always succeed in a real browser
      // — the explicit guards turn an environmental misconfiguration into a
      // descriptive throw rather than `Cannot read properties of undefined`.
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      const nativeSet = descriptor?.set;
      if (!nativeSet) throw new Error("HTMLInputElement.value setter missing");
      nativeSet.call(input, q);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { sel: PALETTE, q: query },
  );
  // Prefer exact data-palette-name match — with fleet ranking, a looser
  // filter can put "Toggle terminal split" ahead of "Split terminal".
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
    { sel: PALETTE, q: query },
    { timeout: POLL_TIMEOUT },
  );
  await world.page.waitForFunction(
    (sel) => document.querySelector(`${sel}[data-open]`) === null,
    PALETTE,
    { timeout: POLL_TIMEOUT },
  );
  // Wait for focus to land in a terminal — Corvu's focus trap release is async
  // and waitForFrame (2x rAF) is insufficient on loaded CI. On touch the
  // refocus-terminal-on-dialog-close is intentionally suppressed (it would
  // summon the soft keyboard with no tap), so the terminal stays unfocused by
  // design — short-circuit the wait there; the typing steps focus their target
  // explicitly.
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
    // handleCreateSubTerminal is async (RPC) but onSelect is fire-and-forget.
    // Wait for the sub-terminal to actually exist before proceeding — otherwise
    // the next "toggle" command may see no subs and create again instead.
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

/** Create a split of a split via the daemon RPC — the product UI only ever
 *  parents under a top-level tile, so nested depth arrives from MCP /
 *  `padi-tui create --parent` (the #2059 bug class). Uses the remembered
 *  sub-terminal id as the parent. */
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
    await padiCall("lifecycle/create", { parentId });
    // Nested create must appear as another flat tab on the root tile's strip.
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
    // Focus the visible sub-terminal before typing — desktop auto-focuses it on
    // expand, but on touch the sub no longer auto-focuses (the soft keyboard
    // rises only on a tap), so this stands in for the tap. Either way, typing
    // lands in the sub-terminal, not the main one.
    await this.focusForTyping("[data-visible][data-sub-terminal]");
    // Type immediately — `__xterm` is published only after the attach
    // snapshot. Waiting for it here would delay echo until after that
    // snapshot and leave the buffer empty of the command's output.
    await this.page.keyboard.type(command);
    await this.page.keyboard.press("Enter");
    await this.waitForFrame();
  },
);

When(
  "I fill the sub-terminal with output wider than the default grid",
  async function (this: KoluWorld) {
    // Pin the precondition the whole scenario rests on: the split's REAL width
    // must differ from the 80 columns xterm's constructor invents. If a viewport,
    // font, dock or layout change ever made them equal, the pre-fix code would
    // receive and paint an 80-column snapshot correctly and this scenario would
    // pass while the bug was fully present — a vacuous guard. Assert it rather
    // than assume it.
    //
    // POLLED, not read once: the grid is measured by a ResizeObserver + a
    // rAF-debounced `applyFit`, and the preceding step only waits for the split's
    // DOM presence — so a bare read on a loaded CI box can land on 0 or a pre-fit
    // value and fail spuriously. Wait until the split reports a measured,
    // non-zero `cols`, then assert what that measurement is.
    const measured = await this.page.waitForFunction(
      (sel) => {
        const node = document.querySelector(sel);
        const cols = (node as unknown as { __xterm?: { cols: number } })
          ?.__xterm?.cols;
        return typeof cols === "number" && cols > 0 ? cols : null;
      },
      VISIBLE_SUB,
      { timeout: POLL_TIMEOUT },
    );
    const cols = await measured.jsonValue();
    assert.ok(
      cols !== 80,
      `split is ${cols} columns; this scenario only exercises the defect when the real grid differs from xterm's fabricated 80`,
    );
    await this.focusForTyping(VISIBLE_SUB);
    await this.page.keyboard.type(WIDE_OUTPUT_COMMAND);
    await this.page.keyboard.press("Enter");
    // Prove the payload actually RAN before the scenario hides the panel. Without
    // this the arrangement is unconditional, and a shell still initializing would
    // surface three steps later as a confusing viewport failure that reads like
    // the render defect itself. VIEWPORT, not buffer: the claim is that the user
    // can SEE the bottom of the output, not merely that the bytes arrived.
    await waitForBufferContains(this.page, BOTTOM_MARKER, {
      selector: VISIBLE_SUB,
      viewport: true,
    });
  },
);

Then(
  "the sub-terminal viewport should show its latest output",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="sub-panel-tab-bar"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // VIEWPORT, not buffer: the defect delivers every byte correctly and then
    // shows the wrong window onto them, so a whole-buffer read passes on a
    // screen the user sees as broken. Only the on-screen rows can fail here.
    await waitForBufferContains(this.page, BOTTOM_MARKER, {
      selector: VISIBLE_SUB,
      viewport: true,
    });
  },
);

Then("the sub-panel should be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
  await tabBar.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the sub-panel should not be visible", async function (this: KoluWorld) {
  const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
  await tabBar.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

Then(
  "the sub-terminal should have keyboard focus",
  async function (this: KoluWorld) {
    // Wait for focus to land inside a [data-sub-terminal] container directly —
    // no indirect ID comparison with the workspace switcher's active entry.
    await this.page.waitForFunction(
      () => !!document.activeElement?.closest("[data-sub-terminal]"),
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the main terminal should have keyboard focus",
  async function (this: KoluWorld) {
    // Wait for focus to land specifically in a main terminal (not sub-terminal).
    // [data-visible] alone is too broad — matches any visible element.
    // Corvu's focus trap release is async; fall back to clicking the canvas.
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

// Assert both the internal marker AND the rendered opacity it drives, so the
// cue can't be silently broken (rule deleted / class typo'd) while the marker
// still flips. Transitions are forced to 0s in tests (hooks.ts), so opacity is
// settled, not mid-fade. The active pane is full strength (1); the receded one
// is the 0.4 the Tailwind `data-[pane-focus=inactive]:opacity-40` paints.
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
    // Wait for the new sub-terminal to mount (async RPC creation)
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
    // Poll — the second sub-terminal may still be initializing
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
    // Hover the parent to reveal the close button, then click.
    // Splits close directly — no confirmation dialog.
    await tab.locator("..").hover();
    await tab.click();
    await this.waitForFrame();
  },
);

Then(
  "the sub-panel should eventually collapse",
  { timeout: 60_000 },
  async function (this: KoluWorld) {
    const tabBar = this.page.locator('[data-testid="sub-panel-tab-bar"]');
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
        rows.every((row) => row.parentElement?.matches(".dock-cards-section")),
      );
    assert.ok(direct, "Expected every split row directly under its section");
  },
);

Then(
  "the dock split sub-entry should show the shell identity pip without asking",
  async function (this: KoluWorld) {
    // Owner supersession of FX2 "label + landing only": sub-entries match
    // top-level rows (identity pip + activity motion). A shell still cannot
    // ask — assert identity pip present and no asking attribute.
    const row = this.page.locator('[data-testid="dock-sub-row"]').first();
    assert.strictEqual(await row.getAttribute("data-agent-state"), null);
    assert.strictEqual(await row.getAttribute("data-asking"), null);
    // Fresh palette-spawned split: no agent has finished → not unread.
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
  "the dock section active count should equal the active host tab",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const splitAgent = document.querySelector(
          '[data-testid="dock-sub-row"][data-agent-state="thinking"]',
        );
        const section = document.querySelector(
          '[data-testid="dock-section-header"] [data-testid="attention-active"]',
        );
        const host = document.querySelector(
          '[data-testid="host-chip"][data-active] [data-testid="attention-active"]',
        );
        return (
          splitAgent !== null &&
          section?.textContent?.trim() === "1" &&
          host?.textContent?.trim() === "1"
        );
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the collapsed indicator should be visible",
  async function (this: KoluWorld) {
    // First wait for the tab bar to disappear (confirms collapse state settled)
    await this.page
      .locator('[data-testid="sub-panel-tab-bar"]')
      .waitFor({ state: "hidden", timeout: 10_000 });
    // Then wait for the collapsed strip to mount and be visible
    const indicator = this.page.locator('[data-testid="collapsed-indicator"]');
    await indicator.waitFor({ state: "visible", timeout: 10_000 });
  },
);

Then("the resize handle should be visible", async function (this: KoluWorld) {
  // Handle is an invisible hit zone (h-0 with ::before pseudo-element) — check attached, not visible
  const handle = this.page.locator('[data-testid="resize-handle"]');
  await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
});

Then(
  "the sub-terminal screen should contain {string}",
  async function (this: KoluWorld, expected: string) {
    // Wait for sub-panel to be fully expanded before reading buffer
    await this.page
      .locator('[data-testid="sub-panel-tab-bar"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForBufferContains(this.page, expected, {
      selector: "[data-sub-terminal][data-visible]",
    });
  },
);
