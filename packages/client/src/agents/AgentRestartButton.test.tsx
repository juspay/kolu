// @vitest-environment happy-dom
/**
 * The stale-agents Restart button's guard: a plain shell restarts on the first
 * click; a live agent arms on the first click ("Kill agent and restart" for
 * 5 s) and restarts only on a second click inside that window.
 */

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

function mount(guarded: boolean) {
  const onRestart = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <AgentRestartButton
        guarded={guarded}
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
  return { button, onRestart };
}

describe("AgentRestartButton", () => {
  it("a plain shell restarts on the first click", () => {
    const { button, onRestart } = mount(false);
    expect(button.textContent).toBe("Restart");
    button.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("a live agent: the first click arms, the second restarts", () => {
    const { button, onRestart } = mount(true);
    button.click();
    expect(onRestart).not.toHaveBeenCalled();
    expect(button.textContent).toBe("Kill agent and restart");
    expect(button.hasAttribute("data-armed")).toBe(true);
    button.click();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe("Restart");
  });

  it("an armed guard lapses after 5 s, and the next click only arms again", () => {
    const { button, onRestart } = mount(true);
    button.click();
    vi.advanceTimersByTime(RESTART_ARM_MS - 1);
    expect(button.textContent).toBe("Kill agent and restart");
    vi.advanceTimersByTime(1);
    expect(button.textContent).toBe("Restart");
    button.click();
    expect(onRestart).not.toHaveBeenCalled();
    expect(button.textContent).toBe("Kill agent and restart");
  });
});
