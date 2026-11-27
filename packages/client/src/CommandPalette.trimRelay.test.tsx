// @vitest-environment happy-dom
/** A LIVE-TREE TRIM MUST NOT RELAY ITSELF THROUGH THE QUERY.
 *
 *  When the command tree drops a segment the user had drilled into (a host
 *  disconnects, a group hides), the path pops — a derivation — and the query
 *  that filtered inside that segment goes with it. Written from the trim
 *  effect's apply arm, that second half RELAYED the tree tick: the list chain
 *  reads the path and the query off the SAME tick, so it ran once in the flush
 *  the tree changed, against the stale query, and again once the clear landed.
 *  That is Solid's `EFFECT_RELAY_TEAR`, advisory on its first sighting and
 *  `warn` from its third — so this case takes the WHOLE drain, advisories
 *  included.
 *
 *  Three rounds, because the escalation is the third sighting. The imperative
 *  half is asserted beside it: the departed segment is still cancelled exactly
 *  once per trim, the input is empty, and the list is the root level again. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

// Keep the palette's real path, query, filter and list graph; replace the
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
vi.mock("./palette/PaletteRow", () => ({
  default: (props: { cmd: { name: string }; onSelect: () => void }) => (
    <button type="button" role="option" onClick={() => props.onSelect()}>
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

const rows = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[role="option"]'),
];
const rowNames = (): string[] => rows().map((el) => el.textContent ?? "");
const input = (): HTMLInputElement => {
  const el = document.querySelector("input");
  if (!el) throw new Error("the palette rendered no search input");
  return el;
};
const drained = (): string[] =>
  takeSolidDiagnostics().map((e) => `${e.severity} ${e.code} ${e.message}`);

const LEAVES = ["alpha-aaa", "beta-aaa", "gamma-aaa"];

it("clears the query on three live-tree trims without relaying it", () => {
  const cancelled = vi.fn();
  // A fresh group each round: the trim walks the path by NAME against the live
  // tree, so object identity is not what keeps the segment alive.
  const group = (): PaletteItem => ({
    kind: "group",
    name: "Fleet",
    onCancel: cancelled,
    children: LEAVES.map((name) => ({
      kind: "action",
      name,
      onSelect: () => {},
    })),
  });
  const solo: PaletteItem = {
    kind: "action",
    name: "solo",
    onSelect: () => {},
  };
  const [commands, setCommands] = createSignal<PaletteItem[]>([group(), solo]);
  // OPENED ON A DEEP LINK, which is what ARMS the trim: the path derivation
  // only walks the live tree on a run that reached `resolveLivePath`, and an
  // open with no `initialPath` returns before reading the tree at all. ⌘⇧K and
  // ⌘⇧H are the production openings that pass one.
  dispose = render(
    () => (
      <CommandPalette
        commands={commands}
        open
        initialPath={["Fleet"]}
        onOpenChange={() => {}}
      />
    ),
    document.body,
  );
  flush();
  expect(rowNames()).toEqual(LEAVES);
  expect(drained()).toEqual([]);

  for (let round = 1; round <= 3; round++) {
    // The segment comes back as a FRESH object: the trim walks the path by
    // NAME against the live tree, so identity is not what keeps it alive.
    setCommands([group(), solo]);
    flush();

    // Drill in (a no-op on the first round, which the deep link already
    // drilled), then filter inside the group.
    rows()
      .find((el) => el.textContent === "Fleet")
      ?.click();
    flush();
    expect(rowNames()).toEqual(LEAVES);
    input().value = "a";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    expect(input().value).toBe("a");
    // Drained so the round's verdict is the TRIM's, not the drill's. The
    // drill-out's own `onCancel` (the highlight leaving the group row) is
    // likewise outside the window measured below.
    expect(drained()).toEqual([]);
    const cancelsBefore = cancelled.mock.calls.length;

    // THE GESTURE: the live tree drops the drilled segment. One tree tick,
    // read by the list and by the trim effect that empties the query.
    setCommands([solo]);
    flush();

    expect(cancelled.mock.calls.length - cancelsBefore).toBe(1);
    expect(input().value).toBe("");
    expect(rowNames()).toEqual(["solo"]);
    expect(drained()).toEqual([]);
  }
});
