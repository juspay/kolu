// @vitest-environment happy-dom
/**
 * The `◆ Orchestrator` entry in the chrome bar — and the one thing it must
 * never become.
 *
 * It sits in the tab row beside the host tabs, so the obvious shortcut is to
 * model it as a host: give it a key, put it in the host map, let the switcher
 * enumerate it. That shortcut is what this file exists to prevent. A host is a
 * machine whose reachability you watch; the orchestrator is one conversation
 * that reaches every machine and has no connection of its own to report, so a
 * fake host key would hand it a padi state, a hue, a status dot and a row in
 * every host-switcher list — four lies, each one a place for the two models to
 * disagree.
 *
 * What it IS: a pill, selected or not, carrying the violet count of questions
 * the conversation is blocked on.
 */

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const asks = vi.hoisted(() => ({ open: 0 }));
vi.mock("./useOrchestratorFacts", () => ({
  orchestratorAsksTotal: () => asks.open,
}));

import OrchestratorTab from "./OrchestratorTab";
import {
  exitOrchestratorMode,
  orchestratorMode,
} from "./useOrchestratorMode";

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

beforeEach(() => {
  asks.open = 0;
  exitOrchestratorMode();
});

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  exitOrchestratorMode();
});

function mount(): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <OrchestratorTab />, root);
  return root;
}

const entryOf = (el: HTMLElement): HTMLElement => {
  const entry = el.querySelector<HTMLElement>(
    '[data-testid="orchestrator-tab"]',
  );
  if (entry === null) throw new Error("the orchestrator entry did not render");
  return entry;
};

describe("the orchestrator's chrome-bar entry", () => {
  it("is present, and wears none of the host-tab chrome", () => {
    const entry = entryOf(mount());
    expect(entry.textContent).toContain("◆ Orchestrator");
    // Not a host: no key to address it by, and nothing a host-switcher data
    // model could pick it up as.
    expect(entry.dataset.host).toBeUndefined();
    expect(entry.getAttribute("role")).toBeNull();
    // No connection dot and no host hue — the two marks that say "a machine".
    expect(root?.querySelector('[data-testid="host-status-pip"]')).toBeNull();
    expect(entry.style.getPropertyValue("--host-hue")).toBe("");
  });

  it("selects and deselects the conversation, and says which it is", () => {
    const entry = entryOf(mount());
    expect(orchestratorMode()).toBe(false);
    expect(entry.dataset.active).toBeUndefined();
    expect(entry.getAttribute("aria-pressed")).toBe("false");

    entry.click();
    expect(orchestratorMode()).toBe(true);
    expect(entry.dataset.active).toBe("");
    expect(entry.getAttribute("aria-pressed")).toBe("true");

    entry.click();
    expect(orchestratorMode()).toBe(false);
  });

  it("wears the needs-you count, and ABSENT at zero", () => {
    const el = mount();
    expect(el.querySelector('[data-testid="orchestrator-badge"]')).toBeNull();
    dispose?.();
    root?.remove();
    asks.open = 3;
    const withAsks = mount();
    expect(
      withAsks.querySelector('[data-testid="orchestrator-badge"]')?.textContent,
    ).toBe("3");
  });

  it("never writes a host key — the selection is its own value", () => {
    const entry = entryOf(mount());
    entry.click();
    // The host tab the user left is untouched: the row's two halves are
    // separate values, which is what makes leaving a RETURN.
    expect(sessionStorage.getItem("kolu-active-host")).toBeNull();
    expect(sessionStorage.getItem("kolu-active-chrome-tab")).toBe(
      "orchestrator",
    );
  });
});
