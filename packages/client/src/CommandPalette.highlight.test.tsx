// @vitest-environment happy-dom
/** A TYPED PALETTE HIGHLIGHTS EVERY ROW WITHOUT PUTTING EVERY ROW ON THE
 *  QUERY SIGNAL.
 *
 *  Each row used to take the raw `query` string and split its own headline
 *  against it, so a list of N rows was N subscribers on one signal: at kolu's
 *  root list that is hundreds of computations woken by a single keystroke,
 *  which Solid raises as `HUGE_FAN_OUT` (the engine's threshold is lowered to
 *  250 subscribers by `@kolu/solid-test-setup`, so 300 rows reproduce it). The
 *  split is now computed where the list is built — one tokenization for the
 *  whole list — and handed to each row as data.
 *
 *  Both halves are asserted here: the diagnostic is what the fix is for, and
 *  the painted segments are what must not change because of it. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

// Keep the palette's real list, its real rows and their real highlighting;
// replace the surrounding app services with inert surfaces.
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

const ROWS = 300;

/** Names with exactly one `w`, so one keystroke highlights one segment in
 *  every row and the split is trivially readable. */
const label = (i: number): string => `row-${String(i).padStart(3, "0")}`;

const tree = (): PaletteItem[] =>
  Array.from({ length: ROWS }, (_, i) => ({
    kind: "action" as const,
    name: label(i),
    onSelect: () => {},
  }));

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

const headlines = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid="palette-branch"]'),
];

it("highlights 300 rows on one keystroke without a huge fan-out", () => {
  const [commands] = createSignal(tree());
  dispose = render(
    () => (
      <CommandPalette commands={commands} open={true} onOpenChange={() => {}} />
    ),
    document.body,
  );
  flush();
  expect(headlines()).toHaveLength(ROWS);
  expect(headlines()[0]?.querySelectorAll("b")).toHaveLength(0);

  const input = document.querySelector("input");
  if (!input) throw new Error("the palette rendered no search input");
  input.value = "w";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();

  // Unchanged behaviour: every row still paints its name, with the one `w`
  // bold inside it.
  const painted = headlines();
  expect(painted).toHaveLength(ROWS);
  expect(painted.map((el) => el.textContent)).toEqual(
    Array.from({ length: ROWS }, (_, i) => label(i)),
  );
  expect(
    painted.map((el) =>
      [...el.querySelectorAll("b")].map((b) => b.textContent),
    ),
  ).toEqual(Array.from({ length: ROWS }, () => ["w"]));

  // The keystroke itself: no diagnostic, so no row is a subscriber on the
  // query. Taken off the collector only to name the finding here — the
  // `afterEach` in `@kolu/solid-test-setup` would otherwise throw with it.
  expect(takeSolidDiagnostics().map((e) => `${e.code} ${e.message}`)).toEqual(
    [],
  );
});
