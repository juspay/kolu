// @vitest-environment happy-dom
/** A PALETTE WITH NOTHING TO SHOW REPUBLISHES NOTHING.
 *
 *  The palette is force-mounted for the app's whole lifetime, so its list
 *  memos are live while it is shut. Two shapes make those memos publish an
 *  array that is equivalent to the one before it — which is what Solid's
 *  unstable-output check counts:
 *
 *  - SHUT: `commandTree` holds `[]` while `props.open` is false, so every row
 *    source is frozen; the "where the user already is" fact was the one
 *    dependency that bypassed that gate, so each activation on the canvas
 *    re-ran `filtered` → `displayed` → `keyedDisplay` for an empty list.
 *  - OPEN WITH NO MATCHES: a query nobody matches makes the same three memos
 *    mint a fresh empty array per keystroke.
 *
 *  Both assert the diagnostics are EMPTY, advisory relay tears included, so a
 *  republish fails at its first sighting rather than at the threshold the
 *  dev-lane judge escalates on. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

/** The canvas's tiles, in the order the palette lists them. Three, so the
 *  whole set fits the Recent band (`RECENT_TERMINAL_LIMIT`) and the one row
 *  missing from an open palette is the one the band withheld. */
const TILES = ["t1", "t2", "t3"];

// The active tile is the subject here, so it is a REAL signal the test
// writes, read through the palette's real `view.activeId()` call.
const [activeId, setActiveId] = createSignal<string | null>(null);

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
  useViewState: () => ({ activeId }),
}));
vi.mock("./wire", () => ({
  encActiveHost: () => "local",
  activeHost: () => ({ kind: "local" }),
  padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
}));
vi.mock("./host/useHostKaval", () => ({
  useHostKavalChain: () => () => ({ kind: "serving" }),
}));
vi.mock("./attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));
vi.mock("./palette/CreateIdentityPreview", () => ({ default: () => null }));
// Imported after the mocks above so the palette's module graph is built
// against them — a static import would be hoisted ahead of them.
const { default: CommandPalette } = await import("./CommandPalette");

/** The rows the palette ranks: three tiles on the canvas host, plus plain
 *  commands. A TERMINAL row is what `currentSelection` is read for — the
 *  empty-root Recent band withholds the tile you are already on, which is what
 *  makes open-then-Enter a toggle — so the gated fact's answer is visible in
 *  the list an opened palette paints. */
const tree = (): PaletteItem[] => [
  ...TILES.map((id) => ({
    kind: "action" as const,
    name: `tile ${id}`,
    onSelect: () => {},
    row: {
      kind: "terminal" as const,
      terminalId: id as TerminalId,
      hostKey: { kind: "local" } as HostKey,
    },
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    kind: "action" as const,
    name: `row-${i}`,
    onSelect: () => {},
  })),
];

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  setActiveId(null);
  document.body.replaceChildren();
});

const typeQuery = (text: string) => {
  const input = document.querySelector("input");
  if (!input) throw new Error("the palette rendered no search input");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
};

/** The rows on screen, in paint order. */
const optionNames = (): string[] =>
  [...document.querySelectorAll('[role="option"]')].map(
    (row) => row.getAttribute("data-palette-name") ?? "",
  );

/** The row Enter would run. */
const highlighted = (): string | null =>
  document
    .querySelector('[role="option"][aria-selected="true"]')
    ?.getAttribute("data-palette-name") ?? null;

it("stays silent while shut, and opens knowing which tile the user is on", () => {
  const [commands] = createSignal(tree());
  const [open, setOpen] = createSignal(false);
  dispose = render(
    () => (
      <CommandPalette
        commands={commands}
        open={open()}
        onOpenChange={() => {}}
      />
    ),
    document.body,
  );
  flush();
  // The mount itself is not the subject.
  takeSolidDiagnostics();

  // Five activations — one past the streak the unstable-output check needs.
  for (const id of ["t1", "t2", "t3", "t1", "t2"]) {
    setActiveId(id);
    flush();
  }

  expect(takeSolidDiagnostics().map((e) => `${e.code} ${e.message}`)).toEqual(
    [],
  );

  // WHAT THE GATE OWES BEYOND SILENCE: a shut palette drops the DEPENDENCY,
  // not the fact. The open edge re-reads it, so the list is ranked against the
  // tile the user is on NOW — `tile t2` is the row the Recent band withholds
  // (open-then-Enter is a toggle, not a no-op) and the highlight lands on a
  // tile they can actually go to. A gate that answered its remembered value
  // across the open edge would offer the tile already under the cursor and
  // hide one they left.
  setOpen(true);
  flush();
  expect(optionNames().filter((name) => name.startsWith("tile "))).toEqual([
    "tile t1",
    "tile t3",
  ]);
  expect(highlighted()).toBe("tile t1");
});

it("stays silent while open on a query nothing matches, and paints a match", () => {
  const [commands] = createSignal(tree());
  dispose = render(
    () => (
      <CommandPalette commands={commands} open={true} onOpenChange={() => {}} />
    ),
    document.body,
  );
  flush();
  takeSolidDiagnostics();

  // Six keystrokes, each extending a query no row matches: the first lands
  // the empty list, the five after it republish an equivalent one.
  for (const q of ["zz", "zzz", "zzzz", "zzzzz", "zzzzzz", "zzzzzzz"]) {
    typeQuery(q);
    // The shared empty list is still an EMPTY LIST: the palette paints no row
    // for a query nothing matches, however many republishes it withholds.
    expect(optionNames()).toEqual([]);
  }

  expect(takeSolidDiagnostics().map((e) => `${e.code} ${e.message}`)).toEqual(
    [],
  );

  // …and that one reference is not a list the palette got stuck on: a query
  // that matches paints its row again.
  typeQuery("row-3");
  expect(optionNames()).toEqual(["row-3"]);
});
