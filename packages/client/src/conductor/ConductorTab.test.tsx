// @vitest-environment happy-dom
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cell = vi.hoisted(() => ({ waiting: 0 }));
vi.mock("./useConductorFacts", () => ({
  useConductorBadge: () => ({ waiting: () => cell.waiting }),
}));

import ConductorTab from "./ConductorTab";
import { exitConductorMode, conductorMode } from "./useConductorMode";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

beforeEach(() => {
  cell.waiting = 0;
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

function remount(): void {
  dispose?.();
  root?.remove();
}

const badgeOf = (el: HTMLElement): HTMLElement | null =>
  el.querySelector<HTMLElement>('[data-testid="conductor-badge"]');

const entryOf = (el: HTMLElement): HTMLElement => {
  const entry = el.querySelector<HTMLElement>('[data-testid="conductor-tab"]');
  if (entry === null) throw new Error("the conductor entry did not render");
  return entry;
};

describe("the conductor's tab", () => {
  it("is present, and wears none of a host's marks", () => {
    const entry = entryOf(mount());
    expect(entry.textContent).toContain("◆");
    expect(entry.textContent).toContain("Conductor");
    expect(entry.dataset.host).toBeUndefined();
    expect(root?.querySelector('[data-testid="host-status-pip"]')).toBeNull();
    expect(entry.style.getPropertyValue("--host-hue")).toBe("");
    expect(entry.className).toContain("conductor-tab");
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

    entry.click();
    expect(conductorMode()).toBe(true);
  });

  it("counts what is waiting on you, and is ABSENT at zero", () => {
    const el = mount();
    expect(el.querySelector('[data-testid="conductor-badge"]')).toBeNull();
    remount();
    cell.waiting = 2;
    const badge = badgeOf(mount());
    expect(badge?.textContent).toBe("2");
    expect(badge?.dataset.waiting).toBe("2");
  });

  it("is the needs-you badge whenever it is there at all", () => {
    cell.waiting = 1;
    const el = mount();
    expect(badgeOf(el)?.dataset.asking).toBe("");
    expect(entryOf(el).dataset.asking).toBe("");
  });

  it("never writes a host key — the selection is its own value", () => {
    const entry = entryOf(mount());
    entry.click();
    expect(sessionStorage.getItem("kolu-active-host")).toBeNull();
    expect(sessionStorage.getItem("kolu-active-chrome-tab")).toBe("conductor");
  });
});
