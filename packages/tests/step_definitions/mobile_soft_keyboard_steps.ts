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

When("I tap the terminal canvas", async function (this: KoluWorld) {
  // Install a focus-event observer on .xterm-screen BEFORE the tap so we can
  // detect the iOS-style contenteditable auto-focus. The bug surfaces when the
  // browser focuses the contenteditable on pointerdown and our wrapper-click
  // handler then shuffles to the helper textarea — the smoking gun is a focus
  // event landing on .xterm-screen during the gesture.
  await this.page.evaluate(() => {
    const screen = document.querySelector(
      "[data-visible][data-terminal-id] .xterm-screen",
    ) as HTMLElement | null;
    if (!screen) throw new Error("No .xterm-screen on active terminal");
    const w = window as FocusProbeWindow;
    w.__screenFocusCount = 0;
    w.__screenFocusListener = () => {
      w.__screenFocusCount = (w.__screenFocusCount ?? 0) + 1;
    };
    screen.addEventListener("focus", w.__screenFocusListener);
  });

  // Real CDP touch via Playwright's touchscreen triggers the browser's native
  // contenteditable auto-focus heuristic — synthetic dispatchEvent doesn't.
  const canvas = this.page
    .locator("[data-visible][data-terminal-id] .xterm-screen canvas")
    .first();
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
    const count = await this.page.evaluate(() => {
      const w = window as FocusProbeWindow;
      const value = w.__screenFocusCount ?? 0;
      const screen = document.querySelector(
        "[data-visible][data-terminal-id] .xterm-screen",
      );
      if (screen && w.__screenFocusListener) {
        screen.removeEventListener("focus", w.__screenFocusListener);
      }
      w.__screenFocusListener = undefined;
      return value;
    });
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
    await this.page.evaluate(() => {
      const ta = document.activeElement;
      if (ta instanceof HTMLElement) ta.blur();
      const textarea = document.querySelector(
        "[data-visible][data-terminal-id] .xterm-helper-textarea",
      ) as HTMLTextAreaElement | null;
      if (!textarea) throw new Error("No xterm helper textarea found");
      const w = window as FocusProbeWindow;
      w.__textareaFocusCount = 0;
      w.__textareaFocusListener = () => {
        w.__textareaFocusCount = (w.__textareaFocusCount ?? 0) + 1;
      };
      textarea.addEventListener("focus", w.__textareaFocusListener);
    });

    const screen = this.page
      .locator("[data-visible][data-terminal-id] .xterm-screen")
      .first();
    const box = await screen.boundingBox();
    assert.ok(box, "xterm screen has no bounding box");
    const x = box.x + box.width / 2;
    const startY = box.y + box.height - 30;
    const endY = box.y + 30;
    const steps = 6;
    const ys: number[] = [];
    for (let i = 1; i <= steps; i++) {
      ys.push(startY + ((endY - startY) * i) / steps);
    }

    await this.page.evaluate(
      ({ sel, x, startY, ys }) => {
        const target = document.querySelector(sel) as HTMLElement | null;
        if (!target) throw new Error(`No element matches ${sel}`);
        const dispatch = (type: string, clientY: number) => {
          target.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY,
              pointerId: 1,
              pointerType: "touch",
              isPrimary: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        dispatch("pointerdown", startY);
        for (const y of ys) dispatch("pointermove", y);
        dispatch("pointerup", ys[ys.length - 1] ?? startY);
      },
      { sel: "[data-visible][data-terminal-id] .xterm-screen", x, startY, ys },
    );
    await this.waitForFrame();
  },
);

Then(
  "xterm's helper textarea should not have been focused by the scroll",
  async function (this: KoluWorld) {
    const count = await this.page.evaluate(() => {
      const w = window as FocusProbeWindow;
      const value = w.__textareaFocusCount ?? 0;
      const textarea = document.querySelector(
        "[data-visible][data-terminal-id] .xterm-helper-textarea",
      );
      if (textarea && w.__textareaFocusListener) {
        textarea.removeEventListener("focus", w.__textareaFocusListener);
      }
      w.__textareaFocusListener = undefined;
      return value;
    });
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
    await this.page.evaluate(() => {
      const ta = document.activeElement;
      if (ta instanceof HTMLElement) ta.blur();
      const textarea = document.querySelector(
        "[data-visible][data-terminal-id] .xterm-helper-textarea",
      ) as HTMLTextAreaElement | null;
      if (!textarea) throw new Error("No xterm helper textarea found");
      const w = window as FocusProbeWindow;
      w.__textareaFocusCount = 0;
      w.__textareaFocusListener = () => {
        w.__textareaFocusCount = (w.__textareaFocusCount ?? 0) + 1;
      };
      textarea.addEventListener("focus", w.__textareaFocusListener);
    });

    const screen = this.page
      .locator("[data-visible][data-terminal-id] .xterm-screen")
      .first();
    const box = await screen.boundingBox();
    assert.ok(box, "xterm screen has no bounding box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.evaluate(
      ({ sel, x, y }) => {
        const target = document.querySelector(sel) as HTMLElement | null;
        if (!target) throw new Error(`No element matches ${sel}`);
        const dispatch = (type: string) => {
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
        };
        dispatch("pointerdown");
        dispatch("pointercancel");
        dispatch("pointerup");
      },
      { sel: "[data-visible][data-terminal-id] .xterm-screen", x, y },
    );
    await this.waitForFrame();
  },
);

Then(
  "xterm's helper textarea should not have been focused by the canceled gesture",
  async function (this: KoluWorld) {
    const count = await this.page.evaluate(() => {
      const w = window as FocusProbeWindow;
      const value = w.__textareaFocusCount ?? 0;
      const textarea = document.querySelector(
        "[data-visible][data-terminal-id] .xterm-helper-textarea",
      );
      if (textarea && w.__textareaFocusListener) {
        textarea.removeEventListener("focus", w.__textareaFocusListener);
      }
      w.__textareaFocusListener = undefined;
      return value;
    });
    assert.strictEqual(
      count,
      0,
      `Expected the textarea to receive no focus event after a canceled gesture, got ${count}`,
    );
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
