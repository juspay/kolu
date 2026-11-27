// @vitest-environment happy-dom
/**
 * A WRITE THAT ASKS THE PALETTE FOR WHAT IT ALREADY HOLDS.
 *
 * The highlight and the query are each one composite state — the scope the
 * highlight belongs to beside its index, the two reset edges beside the
 * typed text — published through a memo. Master held a plain number and a
 * plain string, and a plain signal drops a write equal to what it holds; a
 * composite whose setter mints a state object per write does not, so a
 * gesture that asks for the row already highlighted (`ArrowUp` on the first
 * row) or clears a query that is already clear (a drill-in from an untyped
 * palette) woke the published memo with the value it had just given out.
 * Nothing downstream moved — both memos cut the value off — but that is the
 * shape review 64 found behind the CI red: a child handed a value, reporting
 * it back, writes the state it was reading.
 *
 * So each case counts the engine's own `rerun` records for the published
 * memo across the gesture, beside what the palette shows and an empty
 * diagnostics drain.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createSignal, flush, OBSERVE } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

// Keep the palette's real list, its real rows and their real highlighting;
// replace the surrounding app services with inert surfaces (the same seam as
// `CommandPalette.highlight.test.tsx`).
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

/** HOW MANY TIMES A NAMED MEMO HAS RUN — the engine's own `rerun` record,
 *  the census `palette/workActions.wideDeps.test.ts` takes of `create`.
 *  Subscribed at module load, so no run is missed. */
const runs = new Map<string, number>();
if (OBSERVE === undefined)
  throw new Error("this file needs Solid's development build");
OBSERVE.records.subscribe("rerun", (event) => {
  runs.set(event.nodeName, (runs.get(event.nodeName) ?? 0) + 1);
});
const ranFor = (name: string): number => runs.get(name) ?? 0;

const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity ?? "none"}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

const options = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[role="option"]'),
];

/** The names on screen, in order, and which one is highlighted. */
const shownRows = (): ReadonlyArray<string> =>
  options().map((el) => el.getAttribute("data-palette-name") ?? "");
const highlighted = (): string | undefined =>
  options()
    .find((el) => el.getAttribute("aria-selected") === "true")
    ?.getAttribute("data-palette-name") ?? undefined;

const open = (commands: PaletteItem[]): void => {
  const [tree] = createSignal(commands);
  dispose = render(
    () => (
      <CommandPalette commands={tree} open={true} onOpenChange={() => {}} />
    ),
    document.body,
  );
  flush();
};

/** A key, as the palette hears it: its handler is a capture listener on the
 *  window, ahead of the terminal's own. */
const press = (key: string): void => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  flush();
};

const ROWS: PaletteItem[] = [
  { kind: "action", name: "first row", onSelect: () => {} },
  { kind: "action", name: "second row", onSelect: () => {} },
  { kind: "action", name: "third row", onSelect: () => {} },
];

it("wakes no reader when a key asks for the row already highlighted", () => {
  open(ROWS);
  expect(highlighted(), "the palette opens on its first row").toBe("first row");
  findings();

  const before = ranFor("paletteSelectedIndex");
  // `ArrowUp` on the FIRST row: the index is clamped at 0, which is the
  // index the highlight already holds.
  press("ArrowUp");

  expect(ranFor("paletteSelectedIndex") - before, "the index's memo").toBe(0);
  expect(highlighted(), "the same row is still highlighted").toBe("first row");
  expect(shownRows(), "the same rows are shown").toEqual([
    "first row",
    "second row",
    "third row",
  ]);
  expect(findings(), "the equal highlight write").toEqual([]);
});

it("wakes no reader when a drill-in clears a query that is already clear", () => {
  open([
    ...ROWS,
    {
      kind: "group",
      name: "a group",
      children: [
        { kind: "action", name: "child one", onSelect: () => {} },
        { kind: "action", name: "child two", onSelect: () => {} },
      ],
    },
  ]);
  const field = document.querySelector("input");
  if (!field) throw new Error("the palette rendered no search input");
  expect(field.value, "nothing is typed yet").toBe("");
  findings();

  const before = ranFor("paletteQuery");
  // A drill-in clears the filter it is leaving — and there is nothing to
  // clear, so the query is handed the empty text it already holds.
  const group = options().find(
    (el) => el.getAttribute("data-palette-name") === "a group",
  );
  if (!group) throw new Error("the palette drew no group row");
  group.click();
  flush();

  expect(ranFor("paletteQuery") - before, "the query's memo").toBe(0);
  expect(field.value, "the field is still empty").toBe("");
  expect(shownRows(), "the group's children are shown").toEqual([
    "child one",
    "child two",
  ]);
  expect(findings(), "the equal query write").toEqual([]);
});

it("wakes no reader when a second mouse move re-arms hover", () => {
  open(ROWS);
  const list = document.querySelector<HTMLElement>(".overflow-y-auto");
  if (!list) throw new Error("the palette drew no list container");
  const move = (x: number, y: number): void => {
    list.dispatchEvent(
      new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
    );
    flush();
  };
  // The first move only seeds the gate; the second is the real delta that
  // arms hover, so the flag is already true before the third.
  move(10, 10);
  move(20, 20);
  expect(highlighted(), "the keyboard row still leads").toBe("first row");
  findings();

  const before = ranFor("paletteMouseActive");
  move(30, 30);

  expect(ranFor("paletteMouseActive") - before, "the flag's memo").toBe(0);
  expect(highlighted(), "the same row is still highlighted").toBe("first row");
  expect(shownRows(), "the same rows are shown").toEqual([
    "first row",
    "second row",
    "third row",
  ]);
  expect(findings(), "the equal hover write").toEqual([]);
});
