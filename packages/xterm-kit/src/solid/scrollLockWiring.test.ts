import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { wireScrollIntent } from "./scrollLockWiring";

/** A container with a textarea inside — where xterm listens for keys — wired,
 *  and the sources the wiring armed. */
function wired() {
  const container = document.createElement("div");
  const textarea = document.createElement("textarea");
  container.append(textarea);
  document.body.append(container);
  const armed: string[] = [];
  const dispose = createRoot((dispose) => {
    wireScrollIntent(container, {
      armUserScrollIntent: (source) => armed.push(source),
      holdUserScrollIntent: () => {},
      releaseUserScrollIntent: () => {},
    });
    return dispose;
  });
  return { container, textarea, armed, dispose };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.replaceChildren();
});

/** Key down on the textarea; reports whether the scroll intent was armed
 *  before xterm's own keydown listener there ran. */
function press(key: string, shiftKey: boolean): { armedFirst: boolean } {
  const w = wired();
  cleanup = w.dispose;
  let armedFirst = false;
  w.textarea.addEventListener("keydown", () => {
    armedFirst = w.armed.includes("keyboard");
  });
  w.textarea.dispatchEvent(
    new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
  );
  return { armedFirst };
}

describe("wireScrollIntent — keyboard", () => {
  it.each([
    "PageUp",
    "PageDown",
  ])("Shift+%s arms the intent before the terminal sees the key", (key) => {
    expect(press(key, true).armedFirst).toBe(true);
  });

  it.each([
    ["PageUp", false],
    ["Home", true],
    ["End", true],
    ["a", true],
  ] as const)("%s (shift: %s) arms nothing", (key, shift) => {
    const w = wired();
    cleanup = w.dispose;
    w.textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true }),
    );
    expect(w.armed).toEqual([]);
  });
});
