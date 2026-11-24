// @vitest-environment happy-dom
import type { JSX } from "solid-js";
import {
  MEMORY_CAP,
  type MemoryEntry,
  memoryUsed,
} from "kolu-common/conductorMemory";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySheet } from "./MemorySheet";

vi.mock("@corvu-next/dialog", () => ({
  default: {
    Content: (props: { children: JSX.Element }) => <div>{props.children}</div>,
    Label: (props: { children: JSX.Element }) => <h2>{props.children}</h2>,
  },
}));
vi.mock("../../ui/ModalDialog", () => ({
  default: (props: { children: JSX.Element }) => <div>{props.children}</div>,
}));
vi.mock("../../ui/shown", () => ({ useShown: () => () => true }));
vi.mock("../useConductorFacts", () => ({
  useConductorFacts: () => () => ({
    ownMemory: true,
    agentName: "Claude Code",
  }),
}));
vi.mock("./MemoryEditor", () => ({
  editMemory: () => {},
  memoryEditorOpen: () => false,
}));
vi.mock("./MemoryImport", () => ({
  memoryImport: { openDialog: () => {}, open: () => false },
}));
vi.mock("./MemoryProposalCard", () => ({ default: () => null }));
vi.mock("./useMemory", () => ({
  memorySheet: { open: () => true, onOpenChange: () => {}, close: () => {} },
  useMemory: () => ({
    view: () => ({ entries: entries(), proposals: [] }),
    used: () => memoryUsed(entries()),
    inBatch: () => 1,
    remove: async () => null,
  }),
}));

const [entries, setEntries] = createSignal<MemoryEntry[]>([]);

const entry = (n: number, body: string): MemoryEntry => ({
  id: `m${n}`,
  title: `Entry ${n}`,
  about: null,
  body,
  by: n % 2 === 0 ? "you" : "conductor",
  edited: false,
  at: "2026-11-03T10:00:00.000Z",
});

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

const size = (): HTMLElement | null =>
  document.body.querySelector('[data-testid="memory-size"]');

describe("the Memory sheet", () => {
  it("says the size in plain colour, and who wrote each entry", () => {
    setEntries([entry(1, "Always squash."), entry(2, "Never on a Friday.")]);
    dispose = render(() => <MemorySheet />, document.body);
    expect(size()?.textContent).toBe(
      `${memoryUsed(entries()).toLocaleString("en")} of 16,000 characters`,
    );
    expect(size()?.dataset.nearlyFull).toBeUndefined();
    expect(document.body.textContent).toContain(
      "the Conductor, approved by you",
    );
    expect(document.body.textContent).toContain("you · 3 Nov");
    expect(
      document.body.querySelector('[data-testid="memory-bring-over"]')
        ?.textContent,
    ).toBe("Bring over from Claude Code");
  });

  it("turns the size to the warning colour past nine tenths of the cap", () => {
    const body = "x".repeat(1_190);
    const near = Array.from({ length: 13 }, (_, n) => entry(n + 1, body));
    expect(memoryUsed(near) / MEMORY_CAP).toBeGreaterThan(0.9);
    setEntries(near);
    dispose = render(() => <MemorySheet />, document.body);
    expect(size()?.dataset.nearlyFull).toBe("");
    expect(size()?.classList.contains("text-warning")).toBe(true);
  });

  it("asks once, in place, before deleting", () => {
    setEntries([entry(2, "Never on a Friday.")]);
    dispose = render(() => <MemorySheet />, document.body);
    document.body
      .querySelector<HTMLButtonElement>('[data-testid="memory-entry-delete"]')
      ?.click();
    expect(document.body.textContent).toContain(
      "Delete this memory? The Conductor is told with its next message. There is no undo.",
    );
    expect(
      document.body.querySelector(
        '[data-testid="memory-entry-delete-confirm"]',
      ),
    ).not.toBeNull();
  });
});
