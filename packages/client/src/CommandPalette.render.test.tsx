import { encodeHostKey } from "kolu-common/hostKey";
import { createEffect, createSignal, flush } from "solid-js";
import { type JSX, render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

// Keep the palette's real navigation, list rendering, and click dispatch;
// replace surrounding app services and row decoration with inert surfaces.
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
const rowWakes = vi.hoisted(() => new Map<string, number>());
vi.mock("./palette/PaletteRow", () => ({
  default: (props: {
    cmd: { name: string };
    selected: boolean;
    onSelect: () => void;
  }) => {
    createEffect(
      () => [props.selected, props.cmd.name] as const,
      ([, name]) => {
        rowWakes.set(name, (rowWakes.get(name) ?? 0) + 1);
      },
    );
    return (
      <button type="button" role="option" onClick={() => props.onSelect()}>
        {props.cmd.name}
      </button>
    );
  },
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
  flush();
  document
    .querySelector('[role="option"]')!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flush();
  const pressed = document.querySelector('[role="option"]')!;
  pressed.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  for (let i = 0; i < 3; i++) {
    setCommands(tree());
    flush();
  }
  // Browser click synthesis requires this SAME element to survive the press.
  expect(document.querySelector('[role="option"]')).toBe(pressed);
  pressed.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  pressed.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flush();
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
  flush();
  const one = document.querySelector('[role="option"]')!;
  setCommands([
    { kind: "action", name: "Two", onSelect: stale },
    { kind: "action", name: "One", onSelect: fresh },
  ]);
  flush();
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
  flush();
  const before = [...document.querySelectorAll('[role="option"]')];
  expect(before).toHaveLength(2);
  setCommands(tree());
  flush();
  const after = document.querySelectorAll('[role="option"]');
  expect(after).toHaveLength(2);
  before.forEach((node, i) => {
    expect(after[i]).toBe(node);
  });
  expect(before[0]).not.toBe(before[1]);
  before[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flush();
  setCommands(tree());
  flush();
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
  flush();
  const before = [
    ...document.querySelectorAll('[data-testid="palette-host-header"]'),
  ];
  expect(before).toHaveLength(2);
  setCommands(tree());
  flush();
  const after = document.querySelectorAll(
    '[data-testid="palette-host-header"]',
  );
  expect(after).toHaveLength(2);
  before.forEach((node, i) => {
    expect(after[i]).toBe(node);
  });
  before[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flush();
  setCommands(tree());
  flush();
  expect(document.querySelector('[role="option"]')?.textContent).toBe(
    "Terminal 1",
  );
});

it("moving the highlight wakes exactly the old and new rows", () => {
  rowWakes.clear();
  const host = document.createElement("div");
  document.body.append(host);
  const items: PaletteItem[] = ["a", "b", "c"].map((name) => ({
    kind: "action",
    name,
    onSelect: () => {},
  }));
  dispose = render(
    () => (
      <CommandPalette open commands={() => items} onOpenChange={() => {}} />
    ),
    host,
  );
  flush();
  const before = new Map(rowWakes);
  host
    .querySelector("input")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  flush();
  const changed = [...rowWakes].filter(
    ([name, count]) => count !== before.get(name),
  );
  expect(changed).toHaveLength(2);
  expect(
    changed.every(([name, count]) => count === (before.get(name) ?? 0) + 1),
  ).toBe(true);
});

it("navigates from the visible highlight after the command list shrinks", () => {
  const selected = vi.fn();
  const items: PaletteItem[] = ["a", "b", "c", "d"].map((name) => ({
    kind: "action",
    name,
    onSelect: () => selected(name),
  }));
  const [commands, setCommands] = createSignal(items);
  dispose = render(
    () => <CommandPalette open commands={commands} onOpenChange={() => {}} />,
    document.body,
  );
  flush();
  const press = (key: string) => {
    document
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    flush();
  };
  press("ArrowDown");
  press("ArrowDown");
  press("ArrowDown");
  setCommands(items.slice(0, 2));
  flush();
  press("ArrowUp");
  press("Enter");
  expect(selected).toHaveBeenCalledWith("a");
});

it("keeps its section headers still across four republished trees", () => {
  // `displayed()`/`keyedDisplay()` mint fresh entries on every refresh, so a
  // tree republished unchanged hands every keyed node a NEW header entry.
  // Four of those are Solid's `UNSTABLE_MEMO_OUTPUT`, which
  // `@kolu/solid-test-setup` fails the test on — the `sameDisplayEntry` gate
  // on the narrowings is what this holds.
  const tree = (): PaletteItem[] => [
    { kind: "action", name: "Split", section: "canvas", onSelect: () => {} },
    { kind: "action", name: "Theme", section: "ui", onSelect: () => {} },
    { kind: "action", name: "Docs", section: "help", onSelect: () => {} },
  ];
  const [commands, setCommands] = createSignal(tree());
  dispose = render(
    () => <CommandPalette commands={commands} open onOpenChange={() => {}} />,
    document.body,
  );
  flush();
  const sections = (): (string | null)[] =>
    Array.from(
      document.querySelectorAll('[data-testid="palette-section-header"]'),
    ).map((el) => el.getAttribute("data-section"));
  expect(sections()).toEqual(["canvas", "ui", "help"]);

  for (let i = 0; i < 4; i++) {
    setCommands(tree());
    flush();
  }

  expect(sections()).toEqual(["canvas", "ui", "help"]);
});

it("builds no command tree while it is closed, and a fresh one on open", () => {
  // The palette's content is force-mounted and merely hidden while closed,
  // so a palette that read its commands unconditionally held the whole app
  // tree — every fleet terminal, every work record — subscribed to a surface
  // nobody is looking at, and rebuilt it on every tick behind it.
  const [tick, setTick] = createSignal(0);
  let builds = 0;
  const commands = (): PaletteItem[] => {
    builds++;
    return [{ kind: "action", name: `Row ${tick()}`, onSelect: () => {} }];
  };
  const [open, setOpen] = createSignal(false);
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
  flush();
  expect(builds).toBe(0);

  for (let i = 0; i < 4; i++) {
    setTick(i + 1);
    flush();
  }
  expect(builds).toBe(0);

  // Opening reads the tree as it stands NOW — no stale frame to catch up on.
  setOpen(true);
  flush();
  expect(builds).toBe(1);
  expect(document.querySelector('[role="option"]')?.textContent).toBe("Row 4");
});
