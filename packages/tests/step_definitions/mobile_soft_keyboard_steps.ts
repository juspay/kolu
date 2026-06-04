import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Browser-side window augmentation used by the focus-shuffle detection probe
 *  and the touch-scroll-no-focus probe. Listener refs are stashed alongside
 *  the counters so the Then-step can detach them after asserting, keeping
 *  state from leaking across scenarios that share the same page. */
type FocusProbeWindow = Window & {
  __screenFocusCount?: number;
  __screenFocusListener?: EventListener;
  __textareaFocusCount?: number;
  __textareaFocusListener?: EventListener;
};

const KEY_BAR = '[data-testid="mobile-key-bar"]';
const KEY = (testId: string) => `[data-testid="mobile-key-${testId}"]`;
const XTERM_SCREEN = "[data-visible][data-terminal-id] .xterm-screen";
const XTERM_TEXTAREA =
  "[data-visible][data-terminal-id] .xterm-helper-textarea";

/** Read the document-capture focus counter armed by "I arm the soft-keyboard
 *  focus probe", detach its listener, and return the count. Shared by every
 *  Then-step that asserts a touch interaction did NOT focus the helper
 *  textarea. The element-scoped probes (scroll, canceled-gesture) bind their
 *  listener to a single textarea and tear down differently, so they don't use
 *  this. */
function teardownDocumentCaptureProbe(world: KoluWorld): Promise<number> {
  return world.page.evaluate(() => {
    const w = window as FocusProbeWindow;
    // Guard against a vacuous pass: if the probe was never armed, the counter
    // is undefined and `?? 0` would let the assertion succeed on nothing.
    // The installed listener is the proof the arm step ran — its absence is a
    // hard error, not a silent zero.
    if (!w.__textareaFocusListener) {
      throw new Error(
        "Focus probe not armed — call 'I arm the soft-keyboard focus probe' before this assertion",
      );
    }
    const value = w.__textareaFocusCount ?? 0;
    document.removeEventListener("focus", w.__textareaFocusListener, true);
    w.__textareaFocusListener = undefined;
    return value;
  });
}

/** Assert the document-capture probe saw NO helper-textarea focus during the
 *  interaction just performed. Shared by every "must not summon the keyboard"
 *  Then. Some popping paths fire asynchronously — restoreFocus runs after the
 *  close transition, refocusTerminal runs in a requestAnimationFrame — so
 *  reading the counter immediately would race ahead of the bug and pass
 *  vacuously. Actively wait (bounded) for a pop; if none arrives the keyboard
 *  stayed down. Always tears the probe down so a later scenario can re-arm. */
async function expectNoTextareaPop(
  world: KoluWorld,
  context: string,
): Promise<void> {
  const popped = await world.page
    .waitForFunction(
      () => ((window as FocusProbeWindow).__textareaFocusCount ?? 0) > 0,
      { timeout: 1500 },
    )
    .then(() => true)
    .catch(() => false);
  const count = await teardownDocumentCaptureProbe(world);
  assert.ok(
    !popped && count === 0,
    `Expected no helper-textarea focus ${context} on touch (it must not summon the soft keyboard), got ${count}`,
  );
}

When(
  "I tap the mobile key {string}",
  async function (this: KoluWorld, testId: string) {
    await this.page.locator(KEY(testId)).tap();
    // Each tap fires `client.terminal.sendInput` which is fire-and-forget at
    // the call site. Yield a frame so the WebSocket frame leaves before the
    // next step runs — keeps multi-key sequences ordered.
    await this.waitForFrame();
  },
);

Then(
  "the mobile soft key bar should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(KEY_BAR)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile soft key bar should not scroll horizontally",
  async function (this: KoluWorld) {
    const overflows = await this.page.evaluate((sel) => {
      const bar = document.querySelector(sel) as HTMLElement | null;
      if (!bar) throw new Error("No mobile key bar");
      // +1 tolerates sub-pixel rounding; a real overflow is the full key width.
      return bar.scrollWidth > bar.clientWidth + 1;
    }, KEY_BAR);
    assert.ok(
      !overflows,
      "Expected the key bar to fit without horizontal scroll (scrollWidth <= clientWidth)",
    );
  },
);

Then(
  "the mobile soft key bar keys should occupy two rows",
  async function (this: KoluWorld) {
    // grid-cols-6 lays the twelve controls (2 modifiers + 10 keys) into exactly
    // two rows of six. We assert the full contract: twelve keys present, and
    // their offsetTop baselines partition into two rows sized [6, 6] — not just
    // "some keys span two rows". The querySelectorAll is scoped to the bar's
    // descendants, so the bar element itself (whose testid also starts
    // "mobile-key-") is excluded — only the buttons are counted.
    const layout = await this.page.evaluate((sel) => {
      const bar = document.querySelector(sel);
      if (!bar) throw new Error("No mobile key bar");
      const keys = Array.from(
        bar.querySelectorAll('[data-testid^="mobile-key-"]'),
      ) as HTMLElement[];
      if (keys.length === 0) throw new Error("No keys in the mobile key bar");
      // Group keys by their offsetTop baseline (one entry per row), then report
      // each row's key count sorted top-to-bottom.
      const byRow = new Map<number, number>();
      for (const k of keys)
        byRow.set(k.offsetTop, (byRow.get(k.offsetTop) ?? 0) + 1);
      const rowSizes = [...byRow.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, count]) => count);
      return { total: keys.length, rowSizes };
    }, KEY_BAR);
    assert.strictEqual(
      layout.total,
      12,
      `Expected twelve controls in the key bar, got ${layout.total}`,
    );
    assert.deepStrictEqual(
      layout.rowSizes,
      [6, 6],
      `Expected the key bar to lay out as two rows of six, got rows ${JSON.stringify(
        layout.rowSizes,
      )}`,
    );
  },
);

When(
  "I type {string} on the soft keyboard",
  async function (this: KoluWorld, text: string) {
    // Focus xterm's hidden textarea — what the OS soft keyboard actually
    // targets — and type. This drives the `onData` path (where sticky
    // modifiers are folded in), distinct from the key-bar buttons that
    // `sendInput` directly.
    await this.page.locator(XTERM_TEXTAREA).focus();
    await this.page.keyboard.type(text);
    await this.waitForFrame();
  },
);

Then(
  "the mobile key {string} should be armed",
  async function (this: KoluWorld, testId: string) {
    await this.page.waitForFunction(
      (sel) =>
        document.querySelector(sel)?.getAttribute("aria-pressed") === "true",
      KEY(testId),
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the mobile key {string} should not be armed",
  async function (this: KoluWorld, testId: string) {
    await this.page.waitForFunction(
      (sel) =>
        document.querySelector(sel)?.getAttribute("aria-pressed") === "false",
      KEY(testId),
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I tap the terminal canvas", async function (this: KoluWorld) {
  // Install a focus-event observer on .xterm-screen BEFORE the tap so we can
  // detect the iOS-style contenteditable auto-focus. The bug surfaces when the
  // browser focuses the contenteditable on pointerdown and our wrapper-click
  // handler then shuffles to the helper textarea — the smoking gun is a focus
  // event landing on .xterm-screen during the gesture.
  await this.page.evaluate((sel) => {
    const screen = document.querySelector(sel) as HTMLElement | null;
    if (!screen) throw new Error("No .xterm-screen on active terminal");
    const w = window as FocusProbeWindow;
    w.__screenFocusCount = 0;
    w.__screenFocusListener = () => {
      w.__screenFocusCount = (w.__screenFocusCount ?? 0) + 1;
    };
    screen.addEventListener("focus", w.__screenFocusListener);
  }, XTERM_SCREEN);

  // Real CDP touch via Playwright's touchscreen triggers the browser's native
  // contenteditable auto-focus heuristic — synthetic dispatchEvent doesn't.
  const canvas = this.page.locator(`${XTERM_SCREEN} canvas`).first();
  const box = await canvas.boundingBox();
  assert.ok(box, "xterm canvas has no bounding box");
  await this.page.touchscreen.tap(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
  await this.waitForFrame();
});

Then(
  "the xterm contenteditable screen should never have been focused",
  async function (this: KoluWorld) {
    const count = await this.page.evaluate((sel) => {
      const w = window as FocusProbeWindow;
      const value = w.__screenFocusCount ?? 0;
      const screen = document.querySelector(sel);
      if (screen && w.__screenFocusListener) {
        screen.removeEventListener("focus", w.__screenFocusListener);
      }
      w.__screenFocusListener = undefined;
      return value;
    }, XTERM_SCREEN);
    assert.strictEqual(
      count,
      0,
      `Expected .xterm-screen to never receive focus during the tap (focus-shuffle indicator), got ${count} focus events`,
    );
  },
);

Then(
  "xterm's helper textarea should be the active element",
  async function (this: KoluWorld) {
    // Poll until focus settles — touchscreen tap focus assignment may not be
    // synchronous by the time this step runs (mirrors the pattern used in
    // terminal_lifecycle_steps.ts for "[data-focused]" after dialog dismissal).
    await this.page.waitForFunction(
      () =>
        document.activeElement?.tagName === "TEXTAREA" &&
        document.activeElement.classList.contains("xterm-helper-textarea"),
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I touch-scroll inside the terminal canvas",
  async function (this: KoluWorld) {
    // Blur the textarea (mount auto-focuses it) and install a focus counter
    // before the gesture, so the assertion below can prove the scroll itself
    // didn't summon focus — not just that focus was already there.
    //
    // Synthetic PointerEvents drive the test because the handler under test
    // listens on pointerdown/pointerup. Playwright's touchscreen primitive is
    // tap-only and CDP swipes don't translate to PointerEvents in the same
    // shape the browser emits for real touch.
    await this.page.evaluate((sel) => {
      const ta = document.activeElement;
      if (ta instanceof HTMLElement) ta.blur();
      const textarea = document.querySelector(
        sel,
      ) as HTMLTextAreaElement | null;
      if (!textarea) throw new Error("No xterm helper textarea found");
      const w = window as FocusProbeWindow;
      w.__textareaFocusCount = 0;
      w.__textareaFocusListener = () => {
        w.__textareaFocusCount = (w.__textareaFocusCount ?? 0) + 1;
      };
      textarea.addEventListener("focus", w.__textareaFocusListener);
    }, XTERM_TEXTAREA);

    const screen = this.page.locator(XTERM_SCREEN).first();
    const box = await screen.boundingBox();
    assert.ok(box, "xterm screen has no bounding box");
    const x = box.x + box.width / 2;
    const startY = box.y + box.height - 30;
    const endY = box.y + 30;
    // Pre-compute the (type, clientY) pairs Node-side and pass as data.
    // No nested function declarations inside page.evaluate: swc wraps named
    // functions with a `__name` debug helper that doesn't exist in the
    // browser, so a dispatch arrow inside evaluate crashes the gesture (see
    // mobile_terminal_scroll_steps.ts for the same constraint).
    const intermediate = Array.from({ length: 6 }, (_, i) => ({
      type: "pointermove",
      y: startY + ((endY - startY) * (i + 1)) / 6,
    }));
    const events: { type: string; y: number }[] = [
      { type: "pointerdown", y: startY },
      ...intermediate,
      { type: "pointerup", y: intermediate.at(-1)?.y ?? startY },
    ];

    await this.page.evaluate(
      ({ sel, x, events }) => {
        const target = document.querySelector(sel) as HTMLElement | null;
        if (!target) throw new Error(`No element matches ${sel}`);
        for (const { type, y } of events) {
          target.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerId: 1,
              pointerType: "touch",
              isPrimary: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      },
      { sel: XTERM_SCREEN, x, events },
    );
    await this.waitForFrame();
  },
);

Then(
  "xterm's helper textarea should not have been focused by the scroll",
  async function (this: KoluWorld) {
    const count = await this.page.evaluate((sel) => {
      const w = window as FocusProbeWindow;
      const value = w.__textareaFocusCount ?? 0;
      const textarea = document.querySelector(sel);
      if (textarea && w.__textareaFocusListener) {
        textarea.removeEventListener("focus", w.__textareaFocusListener);
      }
      w.__textareaFocusListener = undefined;
      return value;
    }, XTERM_TEXTAREA);
    assert.strictEqual(
      count,
      0,
      `Expected the textarea to receive no focus event during a touch-scroll, got ${count}`,
    );
  },
);

When(
  "I cancel a pointer gesture on the terminal canvas mid-tap",
  async function (this: KoluWorld) {
    // Same install pattern as the touch-scroll step — blur the textarea and
    // install a focus counter so a stray focus during the sequence trips the
    // assertion. Then dispatch pointerdown → pointercancel → pointerup at the
    // same position. With the cancel branch live, the pointerup sees activeTap
    // cleared and short-circuits; without it, the pointerup would meet the
    // tap-threshold check (zero movement) and focus the textarea.
    await this.page.evaluate((sel) => {
      const ta = document.activeElement;
      if (ta instanceof HTMLElement) ta.blur();
      const textarea = document.querySelector(
        sel,
      ) as HTMLTextAreaElement | null;
      if (!textarea) throw new Error("No xterm helper textarea found");
      const w = window as FocusProbeWindow;
      w.__textareaFocusCount = 0;
      w.__textareaFocusListener = () => {
        w.__textareaFocusCount = (w.__textareaFocusCount ?? 0) + 1;
      };
      textarea.addEventListener("focus", w.__textareaFocusListener);
    }, XTERM_TEXTAREA);

    const screen = this.page.locator(XTERM_SCREEN).first();
    const box = await screen.boundingBox();
    assert.ok(box, "xterm screen has no bounding box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // No nested function declarations inside page.evaluate — see
    // mobile_terminal_scroll_steps.ts for the swc __name pitfall.
    const types = ["pointerdown", "pointercancel", "pointerup"];
    await this.page.evaluate(
      ({ sel, x, y, types }) => {
        const target = document.querySelector(sel) as HTMLElement | null;
        if (!target) throw new Error(`No element matches ${sel}`);
        for (const type of types) {
          target.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerId: 1,
              pointerType: "touch",
              isPrimary: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      },
      { sel: XTERM_SCREEN, x, y, types },
    );
    await this.waitForFrame();
  },
);

Then(
  "xterm's helper textarea should not have been focused by the canceled gesture",
  async function (this: KoluWorld) {
    const count = await this.page.evaluate((sel) => {
      const w = window as FocusProbeWindow;
      const value = w.__textareaFocusCount ?? 0;
      const textarea = document.querySelector(sel);
      if (textarea && w.__textareaFocusListener) {
        textarea.removeEventListener("focus", w.__textareaFocusListener);
      }
      w.__textareaFocusListener = undefined;
      return value;
    }, XTERM_TEXTAREA);
    assert.strictEqual(
      count,
      0,
      `Expected the textarea to receive no focus event after a canceled gesture, got ${count}`,
    );
  },
);

When("I arm the soft-keyboard focus probe", async function (this: KoluWorld) {
  // Count focus events landing on ANY xterm helper textarea, via a
  // capture-phase listener on document — the switch we're about to perform
  // moves `data-visible` to a different terminal, so a listener bound to one
  // element would miss focus on the newly-revealed tile. Capture sees focus
  // on whichever textarea receives it.
  await this.page.evaluate(() => {
    const w = window as FocusProbeWindow;
    // Tear down any prior install so re-arming doesn't leak an orphaned listener.
    if (w.__textareaFocusListener) {
      document.removeEventListener("focus", w.__textareaFocusListener, true);
    }
    w.__textareaFocusCount = 0;
    w.__textareaFocusListener = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.classList.contains("xterm-helper-textarea")) {
        w.__textareaFocusCount = (w.__textareaFocusCount ?? 0) + 1;
      }
    };
    document.addEventListener("focus", w.__textareaFocusListener, true);
  });
});

Then(
  "xterm's helper textarea should not have been focused by the terminal switch",
  async function (this: KoluWorld) {
    const count = await teardownDocumentCaptureProbe(this);
    assert.strictEqual(
      count,
      0,
      `Expected no helper-textarea focus when switching tiles on touch (selection must not summon the keyboard), got ${count}`,
    );
  },
);

Then(
  "xterm's helper textarea should not have been focused by closing the dock",
  async function (this: KoluWorld) {
    // The dock drawer carries restoreFocus={false} AND blurs the focused field
    // on close (`dismissSoftKeyboard`), so a backdrop dismiss must leave the
    // keyboard down.
    await expectNoTextareaPop(this, "when dismissing the dock");
  },
);

When("I tap the scroll-to-bottom button", async function (this: KoluWorld) {
  // Real CDP touch tap on the floating FAB — fires its onClick, which scrolls
  // to the bottom. On touch that must NOT also focus the terminal (the bug:
  // the onClick used to call terminal.focus() unconditionally).
  const btn = this.page.locator('[data-testid="scroll-to-bottom"]');
  const box = await btn.boundingBox();
  assert.ok(box, "scroll-to-bottom button has no bounding box");
  await this.page.touchscreen.tap(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
  await this.waitForFrame();
});

Then(
  "xterm's helper textarea should not have been focused by scrolling to the bottom",
  async function (this: KoluWorld) {
    await expectNoTextareaPop(this, "when tapping the scroll-to-bottom FAB");
  },
);

Then(
  "xterm's helper textarea should not have been focused by closing the dialog",
  async function (this: KoluWorld) {
    // refocusTerminal() (the dialog-close handler) .click()s the terminal,
    // which on touch would fire term.focus() and pop the keyboard. It is now an
    // isTouch() no-op; this guards that closing a dialog leaves the keyboard
    // down. The refocus is scheduled via requestAnimationFrame, so the wait
    // inside expectNoTextareaPop is load-bearing.
    await expectNoTextareaPop(this, "when closing a dialog");
  },
);

Then(
  "xterm's helper textarea should not have been focused by tapping the link",
  async function (this: KoluWorld) {
    // A tap on a file-ref link follows the link into the Code tab; it must NOT
    // focus the terminal. Without the fix the tap handler called term.focus()
    // unconditionally, popping the keyboard AND leaving the link unopened.
    await expectNoTextareaPop(this, "when tapping a terminal link");
  },
);

Then(
  "the --app-h CSS variable should match visualViewport.height",
  async function (this: KoluWorld) {
    // Wire-check: useVisualViewportHeight is mounted and the inline-style
    // override on the App root is consuming `--app-h`. Tolerate sub-pixel
    // rounding from the px-string round-trip.
    await this.page.waitForFunction(
      () => {
        const raw = document.documentElement.style.getPropertyValue("--app-h");
        if (!raw) return false;
        const cssH = Number.parseFloat(raw);
        const vvH = window.visualViewport?.height ?? Number.NaN;
        return Number.isFinite(cssH) && Math.abs(cssH - vvH) < 1;
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the active terminal should show {string} {int} time(s)",
  async function (this: KoluWorld, expected: string, count: number) {
    // Poll the buffer for at-least-N occurrences. Used to verify history
    // recall + Enter — after run, the buffer holds the typed line + output;
    // after recall + submit, both pairs appear, so the marker count grows
    // from 2 to 4. Asserting >= N tolerates extra renders.
    await this.page.waitForFunction(
      ([sel, exp, n]) => {
        const buf = window.__readXtermBuffer?.(sel, 0) ?? "";
        let occurrences = 0;
        let idx = 0;
        while ((idx = buf.indexOf(exp, idx)) !== -1) {
          occurrences++;
          idx += exp.length;
        }
        return occurrences >= n;
      },
      [ACTIVE_TERMINAL, expected, count] as const,
      { timeout: POLL_TIMEOUT },
    );
  },
);
