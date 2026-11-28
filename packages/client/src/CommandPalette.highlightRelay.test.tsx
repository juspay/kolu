// @vitest-environment happy-dom
/** THE DEFAULT HIGHLIGHT MUST NOT RELAY THE SCOPE CHANGE IT FOLLOWS FROM.
 *
 *  The rule — "whenever the scope changes, the highlight re-lands" — reads the
 *  path, the filter query and the current selection, which are the same
 *  sources `filtered()` reads. Written from an effect's apply arm into
 *  `selectedIndex`, everything that folds the index WITH the list ran twice
 *  for one keystroke: `effectiveIndex` (and the highlight notification under
 *  it) once in the flush the query changed, against the stale index, and again
 *  once the write landed. That is Solid's `EFFECT_RELAY_TEAR`, advisory on its
 *  first sighting and `warn` from its third — so this case takes the WHOLE
 *  drain, advisories included.
 *
 *  Three rounds, each an arrow move followed by a keystroke: the arrow puts
 *  the highlight somewhere the rule disagrees with, so the rule's answer is a
 *  real change and the victim is actually woken by it. The painted highlight
 *  is asserted beside the drain, so the repair cannot buy silence with a
 *  behaviour change — a typed filter still re-lands on the top row, and the
 *  arrow still moves off it. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

// Keep the palette's real path, query, filter and highlight graph; replace the
// surrounding app services and the row's own decoration with inert surfaces
// (the same seam as CommandPalette.render.test.tsx).
vi.mock("@corvu-next/dialog", () => ({
  default: {
    Content: (props: { children: JSX.Element }) => <div>{props.children}</div>,
  },
}));
vi.mock("./ui/ModalDialog", () => ({
  default: (props: { children: JSX.Element }) => <div>{props.children}</div>,
}));
vi.mock("./settings/useTips", () => ({
  useTips: () => ({ peekAmbientTipText: () => "" }),
}));
vi.mock("./useViewState", () => ({
  useViewState: () => ({ activeId: () => null }),
}));
vi.mock("./wire", () => ({ encActiveHost: () => "local" }));
vi.mock("./host/hostChipTone", () => ({
  hostHue: () => "0",
  hostLabel: () => "host",
}));
vi.mock("./palette/CreateIdentityPreview", () => ({ default: () => null }));
// `selected` stays reactive on the element, so the painted highlight is the
// one `effectiveIndex` published — the victim this file is about.
vi.mock("./palette/PaletteRow", () => ({
  default: (props: {
    cmd: { name: string };
    selected: boolean;
    onSelect: () => void;
  }) => (
    <button
      type="button"
      role="option"
      data-selected={props.selected ? "true" : undefined}
      onClick={() => props.onSelect()}
    >
      {props.cmd.name}
    </button>
  ),
}));
// Imported after the mocks so the palette's module graph is built against
// them — a static import would be hoisted ahead of them.
const { default: CommandPalette } = await import("./CommandPalette");

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

const rowNames = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (el) => el.textContent ?? "",
  );
const selectedRow = (): string | null =>
  document.querySelector<HTMLElement>('[role="option"][data-selected="true"]')
    ?.textContent ?? null;
const input = (): HTMLInputElement => {
  const el = document.querySelector("input");
  if (!el) throw new Error("the palette rendered no search input");
  return el;
};
const drained = (): string[] =>
  takeSolidDiagnostics().map((e) => `${e.severity} ${e.code} ${e.message}`);

/** Three rows every prefix of "aaa" matches, so the list never empties under
 *  the filters the rounds drive and the arrow always has somewhere to go. */
const ROWS: PaletteItem[] = ["alpha-aaa", "beta-aaa", "gamma-aaa"].map(
  (name) => ({ kind: "action", name, onSelect: () => {} }),
);

it("re-lands the default highlight on three typed filters without relaying it", () => {
  const [commands] = createSignal<PaletteItem[]>(ROWS);
  dispose = render(
    () => <CommandPalette commands={commands} open onOpenChange={() => {}} />,
    document.body,
  );
  flush();
  expect(rowNames()).toHaveLength(3);
  expect(selectedRow()).toBe(rowNames()[0]);
  // The mount's own findings are not this case's; the rounds below start clean.
  expect(drained()).toEqual([]);

  for (const filter of ["a", "aa", "aaa"]) {
    // Move the highlight off where the rule would put it, so the rule's answer
    // is a CHANGE and the readers that fold it are actually woken.
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    flush();
    expect(selectedRow()).toBe(rowNames()[1]);

    // One root write — the query — which the filtered list and the highlight
    // rule both read.
    input().value = filter;
    input().dispatchEvent(new Event("input", { bubbles: true }));
    flush();

    expect(rowNames()).toHaveLength(3);
    expect(input().value).toBe(filter);
    expect(selectedRow()).toBe(rowNames()[0]);
    expect(drained()).toEqual([]);
  }
});
