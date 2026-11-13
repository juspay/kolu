// @vitest-environment happy-dom
/**
 * The `◆ Conductor` tab, first in the chrome bar's tab row — and the one thing
 * it must never become.
 *
 * It is drawn the way a host tab is, so the obvious shortcut is to model it as
 * a host: give it a key, put it in the host map, let the switcher enumerate
 * it. That shortcut is what this file exists to prevent. A host is a machine
 * whose reachability you watch; the conductor is one conversation that
 * reaches every machine and has no connection of its own to report, so a
 * fake host key would hand it a padi state, a hue, a status dot and a row in
 * every host-switcher list — four lies, each one a place for the two models to
 * disagree.
 *
 * What it IS: a tab, current or not, carrying the violet count of questions
 * the conversation is blocked on.
 */

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const asks = vi.hoisted(() => ({ open: 0 }));
vi.mock("./useConductorFacts", () => ({
  conductorAsksTotal: () => asks.open,
}));

import ConductorTab from "./ConductorTab";
import { exitConductorMode, conductorMode } from "./useConductorMode";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

beforeEach(() => {
  asks.open = 0;
  exitConductorMode();
});

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  exitConductorMode();
});

function mount(): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <ConductorTab />, root);
  return root;
}

const entryOf = (el: HTMLElement): HTMLElement => {
  const entry = el.querySelector<HTMLElement>('[data-testid="conductor-tab"]');
  if (entry === null) throw new Error("the conductor entry did not render");
  return entry;
};

describe("the conductor's tab", () => {
  it("is present, and wears none of a host's marks", () => {
    const entry = entryOf(mount());
    // The mark is its own element (it carries the accent), so the gap between
    // it and the word is the tab's flex gap rather than a space in the text —
    // assert the two parts, not the concatenation.
    expect(entry.textContent).toContain("◆");
    expect(entry.textContent).toContain("Conductor");
    // Not a host: no key to address it by, and nothing a host-switcher data
    // model could pick it up as.
    expect(entry.dataset.host).toBeUndefined();
    // No connection dot, and the accent where a host's own hue would be.
    expect(root?.querySelector('[data-testid="host-status-pip"]')).toBeNull();
    expect(entry.style.getPropertyValue("--host-hue")).toBe(
      "var(--color-accent)",
    );
  });

  it("enters the conversation, says it is the current place, and stays there on a second press", () => {
    const entry = entryOf(mount());
    expect(conductorMode()).toBe(false);
    expect(entry.dataset.active).toBeUndefined();
    expect(entry.getAttribute("aria-current")).toBeNull();

    entry.click();
    expect(conductorMode()).toBe(true);
    expect(entry.dataset.active).toBe("");
    expect(entry.getAttribute("aria-current")).toBe("page");

    // A tab, not a toggle: a host tab is the way back.
    entry.click();
    expect(conductorMode()).toBe(true);
  });

  it("wears the needs-you count, and ABSENT at zero", () => {
    const el = mount();
    expect(el.querySelector('[data-testid="conductor-badge"]')).toBeNull();
    dispose?.();
    root?.remove();
    asks.open = 3;
    const withAsks = mount();
    expect(
      withAsks.querySelector('[data-testid="conductor-badge"]')?.textContent,
    ).toBe("3");
  });

  it("never writes a host key — the selection is its own value", () => {
    const entry = entryOf(mount());
    entry.click();
    // The host tab the user left is untouched: the row's two halves are
    // separate values, which is what makes leaving a RETURN.
    expect(sessionStorage.getItem("kolu-active-host")).toBeNull();
    expect(sessionStorage.getItem("kolu-active-chrome-tab")).toBe("conductor");
  });
});
