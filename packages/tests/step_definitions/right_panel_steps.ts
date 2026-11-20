import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import {
  ACTIVE_CANVAS_TILE_SELECTOR,
  type KoluWorld,
  MOD_KEY,
  POLL_TIMEOUT,
} from "../support/world.ts";

async function openAttachSection(world: KoluWorld): Promise<void> {
  const toggle = world.page.locator(
    '[data-testid="inspector-attach-section-toggle"]',
  );
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const isOpen = await world.page.evaluate(
    () =>
      document.querySelector<HTMLDetailsElement>(
        'details[data-testid="inspector-attach-section"]',
      )?.open === true,
  );
  if (!isOpen) {
    await toggle.click();
    await world.waitForFrame();
  }
}

When("I press the toggle inspector shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Alt+b`);
  await this.waitForFrame();
});

When("I collapse the right panel", async function (this: KoluWorld) {
  const btn = this.page.locator('button[aria-label="Collapse panel"]');
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
  await this.waitForFrame();
});

When(
  "I click the inspector toggle icon in the header",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('header [data-testid="inspector-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await toggle.click();
    await this.waitForFrame();
  },
);

When(
  "I click the theme name in the inspector",
  async function (this: KoluWorld) {
    const themeButton = this.page.locator(
      '[data-testid="inspector-theme-button"]',
    );
    await themeButton.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await themeButton.click();
    await this.waitForFrame();
  },
);

When(
  "I type {string} in the compose box",
  async function (this: KoluWorld, text: string) {
    const box = this.page.locator('[data-testid="compose-input"]');
    await box.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await box.fill(text);
    this.composedDraft = text;
    await this.waitForFrame();
  },
);

When("I click the compose Send button", async function (this: KoluWorld) {
  const send = this.page.locator('[data-testid="compose-send"]');
  await send.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await send.click();
  await this.waitForFrame();
});

Then(
  "the terminal should contain the composed draft",
  async function (this: KoluWorld) {
    const draft = this.composedDraft;
    assert.ok(
      draft,
      "No composed draft — was 'I type … in the compose box' called first?",
    );
    await waitForBufferContains(this.page, draft);
  },
);

Then(
  "the compose box should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const box = this.page.locator('[data-testid="compose-input"]');
    await box.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      ({ exp }) => {
        const el = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="compose-input"]',
        );
        return el?.value === exp;
      },
      { exp: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the right panel should be visible", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="right-panel-tab-inspector"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the right panel should not be visible", async function (this: KoluWorld) {
  await this.page.waitForFunction(
    () => {
      const shell = document.querySelector('[data-testid="right-panel"]');
      if (!shell) return true;
      return shell.hasAttribute("data-collapsed");
    },
    null,
    { timeout: POLL_TIMEOUT },
  );
});

Then(
  "the right panel pane label should be {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) =>
        document.querySelector('[data-testid="right-panel-pane-label"]')
          ?.textContent === exp,
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the right panel should show a pane label",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () =>
        (
          document.querySelector('[data-testid="right-panel-pane-label"]')
            ?.textContent ?? ""
        ).trim().length > 0,
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the right panel should show no pane label",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () =>
        document.querySelector('[data-testid="right-panel-tab-code"]') !==
          null &&
        document.querySelector('[data-testid="right-panel-pane-label"]') ===
          null,
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the right panel directory should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) =>
        (
          document.querySelector('[data-testid="right-panel-directory"]')
            ?.textContent ?? ""
        ).includes(exp),
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the inspector should show a CWD section",
  async function (this: KoluWorld) {
    const cwd = this.page.locator('[data-testid="inspector-cwd"]');
    await cwd.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = await cwd.textContent();
    assert.ok(
      text && text.trim().length > 0,
      `Expected inspector CWD to have content, got "${text}"`,
    );
  },
);

Then(
  "the inspector should show a git branch section",
  async function (this: KoluWorld) {
    const git = this.page.locator('[data-testid="inspector-branch"]');
    await git.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = (await git.textContent())?.trim() ?? "";
    assert.ok(
      /^\S+$/.test(text),
      `Expected the inspector branch chip to carry a branch name, got "${text}"`,
    );
  },
);

async function waitForInspectorChipText(
  world: KoluWorld,
  testId: string,
  expected: string,
): Promise<void> {
  await world.page.waitForFunction(
    ({ testId, expected }) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      return (el?.textContent ?? "").includes(expected);
    },
    { testId, expected },
    { timeout: POLL_TIMEOUT },
  );
}

Then(
  "the inspector branch chip should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForInspectorChipText(this, "inspector-branch", expected);
  },
);

Then(
  "the inspector repo chip should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForInspectorChipText(this, "inspector-repo", expected);
  },
);

Then(
  "the inspector directory should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForInspectorChipText(this, "inspector-directory", expected);
  },
);

Then(
  "the inspector agent card should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForInspectorChipText(this, "inspector-agent-card", expected);
  },
);

Then(
  "the inspector should show a theme section",
  async function (this: KoluWorld) {
    const themeButton = this.page.locator(
      '[data-testid="inspector-theme-button"]',
    );
    await themeButton.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = await themeButton.textContent();
    assert.ok(
      text && text.trim().length > 0,
      `Expected inspector theme section to have a theme name, got "${text}"`,
    );
  },
);

Then(
  "the inspector should show the kaval-tui attach command",
  async function (this: KoluWorld) {
    await openAttachSection(this);
    const attach = this.page.locator(
      '[data-testid="inspector-attach-command"]',
    );
    await attach.waitFor({ state: "visible", timeout: POLL_TIMEOUT });

    const shown = (await attach.textContent())?.trim() ?? "";
    const shortId = shown.match(/^kaval-tui attach ([0-9a-f]{8})\b/)?.[1] ?? "";
    assert.ok(
      /^[0-9a-f]{8}$/.test(shortId),
      `Expected the shown command to start with an 8-char short id, got "${shown}"`,
    );

    const title = (await attach.getAttribute("title")) ?? "";
    const fullId = title.match(/^kaval-tui attach ([0-9a-f-]+)/)?.[1] ?? "";
    assert.ok(
      fullId.startsWith(shortId) && fullId.length >= 36,
      `Expected the title to carry the full-uuid attach command, got "${title}"`,
    );

    await attach.click();
    await this.page.waitForFunction(
      (exp) => navigator.clipboard.readText().then((t) => t === exp),
      shown,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the inspector should show attach and snapshot commands for the main terminal and its split",
  async function (this: KoluWorld) {
    await openAttachSection(this);
    const splitSeg = this.page.locator(
      '[data-testid="inspector-attach-term-1"]',
    );
    await splitSeg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });

    const shortId = async (testId: string, verb: string): Promise<string> => {
      const line = this.page.locator(`[data-testid="${testId}"]`);
      await line.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
      const shown = (await line.textContent())?.trim() ?? "";
      const id =
        shown.match(new RegExp(`^kaval-tui ${verb} ([0-9a-f]{8})\\b`))?.[1] ??
        "";
      assert.ok(
        /^[0-9a-f]{8}$/.test(id),
        `Expected "${testId}" to show a "kaval-tui ${verb} <short id>" command, got "${shown}"`,
      );
      return id;
    };
    const pick = async (testId: string): Promise<void> => {
      await this.page.locator(`[data-testid="${testId}"]`).click();
      await this.waitForFrame();
    };

    const mainAttach = await shortId("inspector-attach-command", "attach");
    await pick("inspector-attach-verb-snapshot");
    const mainSnapshot = await shortId(
      "inspector-snapshot-command",
      "snapshot",
    );
    await pick("inspector-attach-term-1");
    const splitSnapshot = await shortId(
      "inspector-snapshot-command-split-0",
      "snapshot",
    );
    await pick("inspector-attach-verb-attach");
    const splitAttach = await shortId(
      "inspector-attach-command-split-0",
      "attach",
    );

    assert.equal(
      mainSnapshot,
      mainAttach,
      "main snapshot must target the same terminal as main attach",
    );
    assert.equal(
      splitSnapshot,
      splitAttach,
      "split snapshot must target the same terminal as split attach",
    );
    assert.notEqual(
      splitAttach,
      mainAttach,
      "the split's commands must target a different terminal than the main",
    );

    const splitTitle =
      (await this.page
        .locator('[data-testid="inspector-attach-command-split-0"]')
        .getAttribute("title")) ?? "";
    const splitFull =
      splitTitle.match(/^kaval-tui attach ([0-9a-f-]+)/)?.[1] ?? "";
    assert.ok(
      splitFull.startsWith(splitAttach) && splitFull.length >= 36,
      `Expected the split attach title to carry the full uuid, got "${splitTitle}"`,
    );
  },
);

Then(
  "the inspector should show the send command and agent-driving guidance",
  async function (this: KoluWorld) {
    await openAttachSection(this);
    await this.page
      .locator('[data-testid="inspector-attach-verb-send"]')
      .click();
    await this.waitForFrame();
    const send = this.page.locator('[data-testid="inspector-send-command"]');
    await send.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const shown = (await send.textContent())?.trim() ?? "";
    assert.ok(
      /^kaval-tui send [0-9a-f]{8}\b/.test(shown),
      `Expected a "kaval-tui send <short id>" command, got "${shown}"`,
    );

    const example = this.page.locator(
      'a[href="https://github.com/srid/llm-debate"]',
    );
    await example.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the inspector should not show a kaval-tui attach command",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="inspector-cwd"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="inspector-attach-command"]')
          .length === 0 &&
        document.querySelectorAll('[data-testid^="inspector-snapshot-command"]')
          .length === 0,
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the inspector toggle should not be active",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const btn = document.querySelector(
          'header [data-testid="inspector-toggle"]',
        );
        return !!btn && !btn.hasAttribute("data-active");
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the inspector toggle should be disabled",
  async function (this: KoluWorld) {
    const toggle = this.page.locator(
      'header [data-testid="inspector-toggle"]:disabled',
    );
    await toggle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the chrome bar should reserve no right-panel space",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const bar = document.querySelector('[data-testid="chrome-bar"]');
        if (!bar) return false;
        return getComputedStyle(bar).right === "0px";
      },
      null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the right panel resize handle should be visible",
  async function (this: KoluWorld) {
    const handle = this.page.locator('[data-testid="right-panel-handle"]');
    await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

const HANDLE_HIT_DX = [-4, -2, 0, 2, 3];

const HANDLE_HIT_Y_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

async function alignActiveTileRightEdgeToHandle(world: KoluWorld): Promise<{
  handleLeft: number;
  tileTop: number;
  tileHeight: number;
}> {
  const aligned = await world.page.evaluate((activeTileSel) => {
    const handle = document.querySelector('[data-testid="right-panel-handle"]');
    if (!handle) return { setupError: "handle missing" } as const;
    const tile = document.querySelector(activeTileSel) as HTMLElement | null;
    if (!tile) return { setupError: "active tile missing" } as const;
    const handleRect = handle.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    const currentLeft = parseFloat(tile.style.left || "0");
    tile.style.left = `${currentLeft + (handleRect.left - tileRect.right)}px`;
    const moved = tile.getBoundingClientRect();
    return {
      handleLeft: handleRect.left,
      tileTop: moved.top,
      tileHeight: moved.height,
    } as const;
  }, ACTIVE_CANVAS_TILE_SELECTOR);
  if ("setupError" in aligned) {
    assert.fail(`Setup failed: ${aligned.setupError}`);
  }
  return aligned;
}

Then(
  "the right panel resize handle should be hittable at its full width",
  async function (this: KoluWorld) {
    await this.waitForFrame();
    const edge = await alignActiveTileRightEdgeToHandle(this);
    const dead = await this.page.evaluate(
      ({ handleLeft, tileTop, tileHeight, sampleDx, sampleYFractions }) => {
        const shadowed: { x: number; y: number; covered: string }[] = [];
        for (const yFrac of sampleYFractions) {
          const y = tileTop + tileHeight * yFrac;
          for (const dx of sampleDx) {
            const x = handleLeft + dx;
            const el = document.elementFromPoint(x, y);
            const id = el?.getAttribute("data-testid");
            if (id !== "right-panel-handle") {
              shadowed.push({ x, y, covered: id ?? el?.tagName ?? "<null>" });
            }
          }
        }
        return shadowed;
      },
      {
        ...edge,
        sampleDx: HANDLE_HIT_DX,
        sampleYFractions: HANDLE_HIT_Y_FRACTIONS,
      },
    );
    assert.deepStrictEqual(
      dead,
      [],
      `Resize handle is shadowed at: ${JSON.stringify(dead)}`,
    );
  },
);
