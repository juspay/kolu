import { createSignal } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import {
  type DisplayEntry,
  keyDisplayEntries,
  type PaletteItem,
} from "./CommandPalette";

// Keep the palette's real list rendering; replace surrounding app services
// and row decoration with inert surfaces (same seam as
// CommandPalette.render.test.tsx).
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
const { default: CommandPalette } = await import("./CommandPalette");
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

const row = (name: string, index: number): DisplayEntry => ({
  kind: "row",
  cmd: { kind: "action", name, onSelect: () => {} },
  index,
});

it("separates entries the tree cannot tell apart", () => {
  const keys = keyDisplayEntries([
    row("spare", 0),
    row("spare", 1),
    row("settings", 2),
    row("spare", 3),
  ]).map((k) => k.key);
  expect(new Set(keys).size).toBe(4);
});

it("keeps a distinct row's key stable when its neighbours move", () => {
  const [a, b, c] = [row("one", 0), row("two", 1), row("three", 2)];
  const before = keyDisplayEntries([a!, b!, c!]);
  const after = keyDisplayEntries([c!, a!, b!]);
  expect(after.find((k) => k.entry === a)!.key).toBe(
    before.find((k) => k.entry === a)!.key,
  );
});

// What this guards: every entry gets its own key, so every row is painted and
// a reorder moves the right node. Solid 2's keyed `mapArray` pairs same-key
// entries by occurrence order (`newIndices` / `newIndicesNext`,
// @solidjs/signals 2.0.3 `dist/dev.js`:3570-3593) — nothing vanishes, but two
// rows sharing a key swap nodes (and node-local state) whenever they move.
it("paints every same-named row, and keeps painting it across a refresh", () => {
  const tree = (): PaletteItem[] => [
    { kind: "action", name: "spare", onSelect: () => {} },
    { kind: "action", name: "spare", onSelect: () => {} },
    { kind: "action", name: "settings", onSelect: () => {} },
  ];
  const [commands, setCommands] = createSignal(tree());
  dispose = render(
    () => <CommandPalette commands={commands} open onOpenChange={() => {}} />,
    document.body,
  );
  const count = () => document.querySelectorAll('[role="option"]').length;
  expect(count()).toBe(3);
  setCommands(tree());
  expect(count()).toBe(3);
  setCommands([...tree()].reverse());
  expect(count()).toBe(3);
});
