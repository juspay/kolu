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
import { createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

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

const tree = (): PaletteItem[] =>
  Array.from({ length: 6 }, (_, i) => ({
    kind: "action" as const,
    name: `row-${i}`,
    onSelect: () => {},
  }));

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

it("stays silent while shut as the active tile moves", () => {
  const [commands] = createSignal(tree());
  dispose = render(
    () => (
      <CommandPalette
        commands={commands}
        open={false}
        onOpenChange={() => {}}
      />
    ),
    document.body,
  );
  flush();
  // The mount itself is not the subject.
  takeSolidDiagnostics();

  // Five activations — one past the streak the unstable-output check needs.
  for (const id of ["t1", "t2", "t3", "t4", "t5"]) {
    setActiveId(id);
    flush();
  }

  expect(takeSolidDiagnostics().map((e) => `${e.code} ${e.message}`)).toEqual(
    [],
  );
});

it("stays silent while open on a query nothing matches", () => {
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
  for (const q of ["zz", "zzz", "zzzz", "zzzzz", "zzzzzz", "zzzzzzz"])
    typeQuery(q);

  expect(takeSolidDiagnostics().map((e) => `${e.code} ${e.message}`)).toEqual(
    [],
  );
});
