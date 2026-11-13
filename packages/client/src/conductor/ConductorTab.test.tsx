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
 * What it IS: a tab, current or not, carrying ONE badge — how many pieces of
 * work the conversation has in flight, violet while it is asking you
 * something.
 */

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cell = vi.hoisted(() => ({ pieces: 0, asking: false }));
vi.mock("./useConductorFacts", () => ({
  useConductorBadge: () => ({
    pieces: () => cell.pieces,
    asking: () => cell.asking,
  }),
}));

import ConductorTab from "./ConductorTab";
import { exitConductorMode, conductorMode } from "./useConductorMode";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

beforeEach(() => {
  cell.pieces = 0;
  cell.asking = false;
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

/** Take the tab down so the next `mount()` reads the cell's new values —
 *  the badge's facts are module-level in these tests, not props. */
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
    // The mark is its own element (it inherits the tab's ink), so the gap
    // between it and the word is the tab's flex gap rather than a space in the
    // text — assert the two parts, not the concatenation.
    expect(entry.textContent).toContain("◆");
    expect(entry.textContent).toContain("Conductor");
    // Not a host: no key to address it by, and nothing a host-switcher data
    // model could pick it up as.
    expect(entry.dataset.host).toBeUndefined();
    // No connection dot — and no inline `--host-hue` either: the tab's own
    // colour is a THEME TOKEN carried by `.conductor-tab` (index.css), which
    // is what keeps a raw hex off the only tab in the row that is not a
    // machine.
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

    // A tab, not a toggle: a host tab is the way back.
    entry.click();
    expect(conductorMode()).toBe(true);
  });

  it("counts the pieces of work, and is ABSENT at zero", () => {
    const el = mount();
    expect(el.querySelector('[data-testid="conductor-badge"]')).toBeNull();
    remount();
    cell.pieces = 2;
    expect(badgeOf(mount())?.textContent).toBe("2");
  });

  it("turns the needs-you colour while the conversation asks, keeping the one count", () => {
    cell.pieces = 2;
    cell.asking = true;
    const badge = badgeOf(mount());
    // The ask is a DATA fact on the badge, not a class name: what the reader
    // is promised is "this badge is the needs-you one", and a utility class
    // would pin the paint instead.
    expect(badge?.dataset.asking).toBe("");
    // ONE number. The work count is what it says; the ask only colours it.
    expect(badge?.textContent).toBe("2");
  });

  it("shows a dot — no number — when it asks with nothing in flight", () => {
    cell.asking = true;
    const badge = badgeOf(mount());
    expect(badge).not.toBeNull();
    expect(badge?.dataset.asking).toBe("");
    expect(badge?.textContent).toBe("");
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
