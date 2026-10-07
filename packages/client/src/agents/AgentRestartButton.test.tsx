// @vitest-environment happy-dom
/**
 * The stale-agents Restart button's guards: a plain shell restarts on the first
 * click; a live agent arms on the first click (the armed label for 5 s) and
 * restarts only on a second click inside that window; an agent going quiet
 * disarms it; and a restart in flight disables the button, so a double click is
 * one restart.
 */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentRestartButton, { RESTART_ARM_MS } from "./AgentRestartButton";

let dispose: (() => void) | undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/** A restart the test settles by hand. */
function pendingRestart() {
  let settle!: () => void;
  const onRestart = vi.fn(
    () =>
      new Promise<void>((r) => {
        settle = r;
      }),
  );
  return { onRestart, settle: () => settle() };
}

function mount(guarded: boolean, onRestart = vi.fn(() => Promise.resolve())) {
  const [isGuarded, setGuarded] = createSignal(guarded);
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <AgentRestartButton
        guarded={isGuarded()}
        armedLabel="Restart agent"
        buttonClass="tile-button"
        onRestart={onRestart}
      />
    ),
    root,
  );
  const button = root.querySelector<HTMLButtonElement>(
    '[data-testid="tile-agent-restart"]',
  );
  if (!button) throw new Error("no restart button rendered");
  return { button, onRestart, setGuarded };
}

describe("AgentRestartButton", () => {
  it("a plain shell restarts on the first click", () => {
    const { button, onRestart } = mount(false);
    expect(button.textContent).toBe("Restart");
    button.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("a live agent: the first click arms with the caller's label, the second restarts", () => {
    const { button, onRestart } = mount(true);
    button.click();
    expect(onRestart).not.toHaveBeenCalled();
    expect(button.textContent).toBe("Restart agent");
    expect(button.hasAttribute("data-armed")).toBe(true);
    button.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe("Restart");
  });

  it("an armed guard lapses after 5 s, and the next click only arms again", () => {
    const { button, onRestart } = mount(true);
    button.click();
    vi.advanceTimersByTime(RESTART_ARM_MS - 1);
    expect(button.textContent).toBe("Restart agent");
    vi.advanceTimersByTime(1);
    expect(button.textContent).toBe("Restart");
    button.click();
    expect(onRestart).not.toHaveBeenCalled();
    expect(button.textContent).toBe("Restart agent");
  });

  it("the agent going quiet while armed disarms it", () => {
    const { button, setGuarded } = mount(true);
    button.click();
    expect(button.textContent).toBe("Restart agent");
    setGuarded(false);
    expect(button.textContent).toBe("Restart");
    expect(button.hasAttribute("data-armed")).toBe(false);
  });

  it("a double click is one restart: the button is disabled until it settles", async () => {
    const { onRestart, settle } = pendingRestart();
    const { button } = mount(false, onRestart);
    button.click();
    button.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    settle();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    button.click();
    expect(onRestart).toHaveBeenCalledTimes(2);
  });
});
