// @vitest-environment happy-dom

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForfeitSessionButton from "./ForfeitSessionButton";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mount(inFlight = false) {
  const onConfirm = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => <ForfeitSessionButton inFlight={inFlight} onConfirm={onConfirm} />,
    host,
  );
  const at = (testid: string) =>
    host?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? undefined;
  return { onConfirm, at };
}

describe("ForfeitSessionButton — one click can never discard the session", () => {
  it("the first click arms a confirm and forfeits NOTHING", () => {
    const { onConfirm, at } = mount();

    at("forfeit-session")?.click();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(at("forfeit-session")).toBeUndefined();
    expect(at("forfeit-session-confirm")).toBeDefined();
    expect(at("forfeit-session-cancel")).toBeDefined();
  });

  it("the confirmed click forfeits, exactly once", () => {
    const { onConfirm, at } = mount();

    at("forfeit-session")?.click();
    at("forfeit-session-confirm")?.click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Cancel walks back to the trigger with nothing discarded", () => {
    const { onConfirm, at } = mount();

    at("forfeit-session")?.click();
    at("forfeit-session-cancel")?.click();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(at("forfeit-session")).toBeDefined();
  });

  it("says plainly that the saved session goes, and that a backup gets it back", () => {
    const { at } = mount();
    at("forfeit-session")?.click();

    const copy = host?.textContent ?? "";
    expect(copy).toContain("discards the saved session");
    expect(copy).toContain("Restore state from backup");
  });

  it("the trigger's hit area is its label — a fit-content wrapper, not the card", () => {
    const { at } = mount();

    const trigger = at("forfeit-session");
    if (!trigger) throw new Error("no forfeit trigger rendered");
    expect(trigger.className).toContain("w-full");
    expect(trigger.parentElement?.className).toContain("w-fit");
  });

  it("is gated out while the card's restore is in flight", () => {
    const { onConfirm, at } = mount(true);

    const trigger = at("forfeit-session");
    expect((trigger as HTMLButtonElement | undefined)?.disabled).toBe(true);
    trigger?.click();
    expect(at("forfeit-session-confirm")).toBeUndefined();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
