import { encodeHostKey } from "kolu-common/hostKey";
import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

// Keep the palette's real navigation, list rendering, and click dispatch;
// replace surrounding app services and row decoration with inert surfaces.
vi.mock("@corvu/dialog", () => ({
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

it("keeps a worktree agent row mounted across fresh command trees and submits once", () => {
  const submit = vi.fn();
  const tree = (): PaletteItem[] => [
    {
      kind: "value",
      name: "repo",
      prefill: () => "my-worktree",
      onSubmit: submit,
      children: [{ kind: "label", name: "codex --yolo", data: "codex --yolo" }],
    },
  ];
  const [commands, setCommands] = createSignal(tree());
  const [open, setOpen] = createSignal(true);
  dispose = render(
    () => (
      <CommandPalette
        commands={commands}
        open={open()}
        onOpenChange={setOpen}
      />
    ),
    document.body,
  );
  document
    .querySelector('[role="option"]')!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const pressed = document.querySelector('[role="option"]')!;
  pressed.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  for (let i = 0; i < 3; i++) setCommands(tree());
  // Browser click synthesis requires this SAME element to survive the press.
  expect(document.querySelector('[role="option"]')).toBe(pressed);
  pressed.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  pressed.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(submit).toHaveBeenCalledExactlyOnceWith(
    "my-worktree",
    expect.objectContaining({ data: "codex --yolo" }),
  );
  expect(open()).toBe(false);
});

it("preserves command identity through reordering and reads the latest callback", () => {
  const stale = vi.fn(),
    fresh = vi.fn();
  const [commands, setCommands] = createSignal<PaletteItem[]>([
    { kind: "action", name: "One", onSelect: stale },
    { kind: "action", name: "Two", onSelect: stale },
  ]);
  dispose = render(
    () => <CommandPalette commands={commands} open onOpenChange={() => {}} />,
    document.body,
  );
  const one = document.querySelector('[role="option"]')!;
  setCommands([
    { kind: "action", name: "Two", onSelect: stale },
    { kind: "action", name: "One", onSelect: fresh },
  ]);
  expect(document.querySelectorAll('[role="option"]')[1]).toBe(one);
  one.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(fresh).toHaveBeenCalledOnce();
  expect(stale).not.toHaveBeenCalled();
});

it("keeps equal repository labels distinct and follows the selected root after refresh", () => {
  const first = vi.fn(),
    second = vi.fn();
  const tree = (): PaletteItem[] =>
    ["/a/repo", "/b/repo"].map((id, i) => ({
      kind: "value",
      id,
      name: "repo",
      prefill: () => "branch",
      onSubmit: i === 0 ? first : second,
      children: [{ kind: "label", name: id }],
    }));
  const [commands, setCommands] = createSignal(tree());
  dispose = render(
    () => <CommandPalette commands={commands} open onOpenChange={() => {}} />,
    document.body,
  );
  const before = [...document.querySelectorAll('[role="option"]')];
  expect(before).toHaveLength(2);
  setCommands(tree());
  const after = document.querySelectorAll('[role="option"]');
  expect(after).toHaveLength(2);
  before.forEach((node, i) => {
    expect(after[i]).toBe(node);
  });
  expect(before[0]).not.toBe(before[1]);
  before[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  setCommands(tree());
  const option = document.querySelector('[role="option"]')!;
  expect(option.textContent).toBe("/b/repo");
  option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
});

it("keeps local and a remote host named local in separate header nodes", () => {
  const tree = (): PaletteItem[] => [
    {
      kind: "group",
      name: "Terminals",
      children: [
        { kind: "local" } as const,
        { kind: "remote", target: "local" } as const,
      ].map((host, i) => ({
        kind: "group",
        id: encodeHostKey(host),
        name: "local",
        row: { kind: "host", hostKey: host },
        children: [
          { kind: "action", name: `Terminal ${i}`, onSelect: () => {} },
        ],
      })),
    },
  ];
  const [commands, setCommands] = createSignal(tree());
  dispose = render(
    () => (
      <CommandPalette
        commands={commands}
        open
        onOpenChange={() => {}}
        initialPath={["Terminals"]}
      />
    ),
    document.body,
  );
  const before = [
    ...document.querySelectorAll('[data-testid="palette-host-header"]'),
  ];
  expect(before).toHaveLength(2);
  setCommands(tree());
  const after = document.querySelectorAll(
    '[data-testid="palette-host-header"]',
  );
  expect(after).toHaveLength(2);
  before.forEach((node, i) => {
    expect(after[i]).toBe(node);
  });
  before[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  setCommands(tree());
  expect(document.querySelector('[role="option"]')?.textContent).toBe(
    "Terminal 1",
  );
});
