import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

/** Expand the Inspector's Attach section — it ships COLLAPSED (reference
 *  tier), so any step that reads a kaval command opens the disclosure first,
 *  through the same summary click a user makes. Idempotent: a no-op when a
 *  previous step in the scenario already opened it. */
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

// ── Actions ──

When("I press the toggle inspector shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(`${MOD_KEY}+Alt+b`);
  await this.waitForFrame();
});

When("I collapse the right panel", async function (this: KoluWorld) {
  // RightPanel's chrome-bar collapse button — clicking it from the
  // expanded state toggles `rightPanel.collapsed` to true (Resizable
  // shrinks the panel to ~0 width while the DOM stays mounted).
  const btn = this.page.locator('button[aria-label="Collapse panel"]');
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
  await this.waitForFrame();
});

When(
  "I click the inspector toggle icon in the header",
  async function (this: KoluWorld) {
    // The right-panel toggle in the header — `data-testid="inspector-toggle"`
    // (the test-id is kept stable even though the visible label is now
    // "Toggle right panel").
    const toggle = this.page.locator('header [data-testid="inspector-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await toggle.click();
    await this.waitForFrame();
  },
);

When(
  "I click the theme name in the inspector",
  async function (this: KoluWorld) {
    // The theme section in MetadataInspector renders a clickable button with the theme name.
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
    // `.fill` sets the value and fires an `input` event, which drives the
    // SolidJS `onInput` → `setDraft` (and its localStorage write).
    await box.fill(text);
    // Remember it so a follow-up step can assert it reached the terminal.
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

// ── Assertions ──

Then(
  "the terminal should contain the composed draft",
  async function (this: KoluWorld) {
    const draft = this.composedDraft;
    assert.ok(
      draft,
      "No composed draft — was 'I type … in the compose box' called first?",
    );
    // The draft was inserted (not submitted), so it sits on the active
    // terminal's current input line. `waitForBufferContains` polls the
    // focused terminal's xterm buffer (timer-based, not rAF) until it carries
    // the text — the send → PTY → attach-stream → xterm round-trip is async, so
    // a bare snapshot would race the echo.
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
  // "Visible" means the tab content area exists — assert one of its
  // tab buttons is reachable (the expanded Resizable panel shows the tab bar).
  const tab = this.page.locator('[data-testid="right-panel-tab-inspector"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then("the right panel should not be visible", async function (this: KoluWorld) {
  // The Resizable panel collapses to 0 width (no rail or visible indicator).
  // `data-collapsed` on the RightPanel root is the canonical state seam.
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
  "the inspector should show a CWD section",
  async function (this: KoluWorld) {
    const cwd = this.page.locator('[data-testid="inspector-cwd"]');
    await cwd.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // CWD section should contain a non-empty path
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
    // The test suite runs inside a git repo, so the git section should be present.
    // The Work cluster renders the branch as a CHIP (no "Branch" label since
    // the inspector revamp) — assert the chip row exists and carries a name.
    const git = this.page.locator('[data-testid="inspector-branch"]');
    await git.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const text = await git.textContent();
    assert.ok(
      text && text.trim().length > 0,
      `Expected inspector git chips to show branch info, got "${text}"`,
    );
  },
);

Then(
  "the inspector should show a theme section",
  async function (this: KoluWorld) {
    // Theme section renders a clickable button with the theme name inside the right panel.
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
    // The Attach section (collapsed by default) renders a picker whose command
    // line defaults to `attach` on the main pane. We assert the whole
    // deliberate contract: the button SHOWS the short id, its `title` carries
    // the FULL command (the on-hover disambiguator), and CLICKING it copies
    // the short form (WYSIWYG-copy) — not just that some text matches.
    await openAttachSection(this);
    const attach = this.page.locator(
      '[data-testid="inspector-attach-command"]',
    );
    await attach.waitFor({ state: "visible", timeout: POLL_TIMEOUT });

    // The SHOWN command (the idle affordance is an icon with no text, so the
    // button's textContent is exactly the command — incl. any `--socket <path>`
    // the inspector pins after the id).
    const shown = (await attach.textContent())?.trim() ?? "";
    // The id token is the 8-char short form, not the full uuid.
    const shortId = shown.match(/^kaval-tui attach ([0-9a-f]{8})\b/)?.[1] ?? "";
    assert.ok(
      /^[0-9a-f]{8}$/.test(shortId),
      `Expected the shown command to start with an 8-char short id, got "${shown}"`,
    );

    // The hover/title carries the FULL command (the on-hover disambiguator):
    // same shape, but its id token is the full-length uuid that the short id
    // prefixes.
    const title = (await attach.getAttribute("title")) ?? "";
    const fullId = title.match(/^kaval-tui attach ([0-9a-f-]+)/)?.[1] ?? "";
    assert.ok(
      fullId.startsWith(shortId) && fullId.length >= 36,
      `Expected the title to carry the full-uuid attach command, got "${title}"`,
    );

    // Clicking copies EXACTLY what's shown (WYSIWYG) — short id and, when the
    // daemon socket is known, the `--socket` that pins the command to THIS
    // server's kaval. Comparing to the shown text keeps the assertion correct
    // whether or not the socket has resolved in the fixture.
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
    // The Attach picker offers every pane — the tile's main pane plus every
    // split, since each split is its own PTY in the daemon — one command at a
    // time: a terminal picker × a verb picker drive a single command line
    // whose testid keeps the per-pane naming (`inspector-{verb}-command` for
    // the main, `inspector-{verb}-command-split-N` for the Nth split). Walk
    // all four picker states and assert the same id contract the old
    // six-button layout carried.
    await openAttachSection(this);
    // The terminal picker only renders once the split's metadata has streamed
    // in (a lone pane shows no picker at all) — wait for its second segment.
    const splitSeg = this.page.locator(
      '[data-testid="inspector-attach-term-1"]',
    );
    await splitSeg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });

    // The 8-char short-id token the command line carries in a given state.
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

    // Main pane (picker defaults): attach, then snapshot.
    const mainAttach = await shortId("inspector-attach-command", "attach");
    await pick("inspector-attach-verb-snapshot");
    const mainSnapshot = await shortId(
      "inspector-snapshot-command",
      "snapshot",
    );
    // Switch to the split: snapshot, then attach.
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

    // attach and snapshot for the same terminal target the same id…
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
    // …and the split is a DIFFERENT terminal than the main (not a duplicated row).
    assert.notEqual(
      splitAttach,
      mainAttach,
      "the split's commands must target a different terminal than the main",
    );

    // The hover/title carries the FULL uuid for the split too (the on-hover
    // disambiguator), same contract the main attach command already keeps.
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
    // Beyond attach/snapshot, the picker offers a `send` verb (the one that
    // drives an agent in the pane), and the section carries a drive-an-agent
    // callout that links the llm-debate worked example. Assert both so the
    // redesign's affordances don't silently regress.
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

    // The agent-driving callout links llm-debate as the worked example.
    const example = this.page.locator(
      'a[href="https://github.com/srid/llm-debate"]',
    );
    await example.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the inspector should not show a kaval-tui attach command",
  async function (this: KoluWorld) {
    // A sleeping tile released its PTY (and its splits were closed), so it is no
    // longer one of kaval's terminals — the Attach section must disappear, not
    // hand the user a `kaval-tui attach <id>` that can't connect. Assert the
    // inspector is still rendered (so this isn't a vacuous pass from a closed
    // panel) yet carries no attach OR snapshot command for any terminal.
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
    // The header toggle drops its `data-active` marker when the panel isn't
    // effectively open — which an empty workspace forces regardless of the
    // terminal's collapsed state.
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
    // Use the `:disabled` selector with waitFor so the assertion polls until
    // SolidJS reactivity has flushed the `disabled` attribute onto the button —
    // the same idiom as "the Code tab back/forward button should be disabled".
    // A bare isDisabled() snapshot after waitFor(attached) is a race: the
    // element can exist in the DOM before the reactive flush propagates
    // `disabled={true}`.
    const toggle = this.page.locator(
      'header [data-testid="inspector-toggle"]:disabled',
    );
    await toggle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the chrome bar should reserve no right-panel space",
  async function (this: KoluWorld) {
    // The ghost: the floating chrome's inline `right` offset reserves the
    // panel's width. With no panel mounted it must collapse to 0 so the
    // control cluster sits flush against the viewport's right edge.
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
    // Handle uses w-0 with ::before pseudo-element — check attached, not visible
    const handle = this.page.locator('[data-testid="right-panel-handle"]');
    await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the right panel resize handle should be hittable at its full width",
  async function (this: KoluWorld) {
    // The outer handle's ::before extends `before:-left-1 before:w-2`
    // (-4px..+4px from the handle's left edge in Tailwind units). Sample
    // points across that 8px-wide strip and assert each one resolves to
    // the handle button via elementFromPoint.
    //
    // Force the active canvas tile's right edge to coincide with the
    // handle's left edge before sampling. Canvas tiles use
    // `position: absolute; z-index: 10` only when active (inactive tiles
    // sit at z-index: 1 and cannot shadow the handle), so a generic
    // `[data-testid="canvas-tile"]` lookup could pick an inactive tile,
    // shift an irrelevant element, and silently pass. Without this
    // step the default tile placement might not reach the boundary at
    // all, and the assertion would only mean "no tile happened to
    // overlap" — not "the handle stacks above tiles when they do."
    //
    // Positioning happens via the absolute `left` offset rather than by
    // appending to the inline `transform`. That keeps the test on the
    // tile's stable boundary (its bounding rect's right edge) instead
    // of riding on `CanvasTile`'s internal transform composition — a
    // separate volatility axis the assertion has no business coupling
    // to.
    //
    // Double-rAF before sampling so SolidJS reactivity + Corvu's
    // Resizable transitions are flushed — without it, a stale layout
    // snapshot could either silently pass (tile not yet at boundary)
    // or flake on slower CI runners. The detailed `dead` list in the
    // failure message is worth keeping over a generic
    // `waitForFunction` timeout: it names the exact (x, y) and the
    // covering element so a regression points at its cause.
    await this.waitForFrame();
    const result = await this.page.evaluate(() => {
      const handle = document.querySelector(
        '[data-testid="right-panel-handle"]',
      );
      if (!handle) return { ok: false, setupError: "handle missing" } as const;
      const tile = document.querySelector(
        '[data-testid="canvas-tile"][data-active="true"]',
      ) as HTMLElement | null;
      if (!tile) {
        return {
          ok: false,
          setupError: "active tile missing",
        } as const;
      }
      const handleRect = handle.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      const currentLeft = parseFloat(tile.style.left || "0");
      const shift = handleRect.left - tileRect.right;
      tile.style.left = `${currentLeft + shift}px`;
      const newTileRect = tile.getBoundingClientRect();
      const dead: { x: number; y: number; covered: string }[] = [];
      for (const yFrac of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const y = newTileRect.top + newTileRect.height * yFrac;
        // ::before spans [-4, +4) — `before:-left-1` puts its left edge
        // at -4, `before:w-2` makes it 8px wide, so its painted pixels
        // run -4..+3 inclusive (right edge at +4 is exclusive per CSS
        // box geometry). Sample at both inclusive boundaries plus three
        // interior points so the assertion enforces the full hit zone.
        for (const dx of [-4, -2, 0, 2, 3]) {
          const x = handleRect.left + dx;
          const el = document.elementFromPoint(x, y);
          const id = el?.getAttribute("data-testid");
          if (id !== "right-panel-handle") {
            dead.push({ x, y, covered: id ?? el?.tagName ?? "<null>" });
          }
        }
      }
      return { ok: dead.length === 0, dead } as const;
    });
    if (!result.ok && "setupError" in result) {
      assert.fail(`Setup failed: ${result.setupError}`);
    }
    assert.ok(
      result.ok,
      `Resize handle is shadowed at: ${JSON.stringify("dead" in result ? result.dead : [])}`,
    );
  },
);
