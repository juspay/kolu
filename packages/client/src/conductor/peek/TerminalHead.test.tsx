// @vitest-environment happy-dom
/**
 * THE FIT WIDTH BUTTON, where it is drawn.
 *
 * With the choice on by default, a terminal that already fits must not offer
 * the button: pressing it would turn the choice off for every pane and then
 * disappear from this one, leaving no way back here. The button belongs to a
 * terminal that pans at its own size, whatever the choice says.
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalId } from "kolu-common/surface";
import { TerminalControls } from "./TerminalHead";

vi.mock("../../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => ({ kind: "here" }),
}));

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

function mount(pans: boolean, fit: boolean): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <TerminalControls
        kind="live"
        host="local"
        id={"00000000-0000-4000-8000-000000000001" as TerminalId}
        pans={pans}
        fit={fit}
        onFit={() => {}}
        onOpenTile={() => {}}
      />
    ),
    root,
  );
  return root;
}

const button = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-testid="live-fit"]');

describe("the Fit width button", () => {
  it("is drawn for a terminal that pans, lit by the choice", () => {
    expect(button(mount(true, true))?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(button(mount(true, false))?.getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("is not drawn for a terminal that already fits, whatever the choice", () => {
    expect(button(mount(false, true))).toBeNull();
    expect(button(mount(false, false))).toBeNull();
  });
});
