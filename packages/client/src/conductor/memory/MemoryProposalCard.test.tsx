// @vitest-environment happy-dom
import type { MemoryProposal } from "kolu-common/conductorMemory";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import MemoryProposalCard from "./MemoryProposalCard";

const memory = vi.hoisted(() => {
  const state = {
    proposals: [] as MemoryProposal[],
    refusal: null as string | null,
  };
  return {
    state,
    approve: vi.fn(async () => state.refusal),
    decline: vi.fn(async () => null),
  };
});
const edit = vi.hoisted(() => vi.fn());

vi.mock("./useMemory", () => ({
  useMemory: () => ({
    waiting: (id: string) => proposals().find((one) => one.id === id),
    inBatch: (id: string) => {
      const batch = proposals().find((one) => one.id === id)?.batch;
      return proposals().filter((one) => one.batch === batch).length;
    },
    approve: memory.approve,
    decline: memory.decline,
  }),
}));
vi.mock("./MemoryEditor", () => ({ editMemory: edit }));
vi.mock("../../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: () => {} }),
}));

const [proposals, setProposals] = createSignal<MemoryProposal[]>([]);

const AT = "2026-12-02T09:15:00.000Z";
const proposal = (
  id: string,
  batch: string,
  title: string,
): MemoryProposal => ({
  id,
  change: { kind: "add", title, about: "demo-app", body: `${title}, always.` },
  why: "you said so on «Fix the login error»",
  at: AT,
  batch,
});

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  memory.state.refusal = null;
  memory.approve.mockClear();
  edit.mockClear();
});

const draw = (
  one: MemoryProposal,
  ended: null | "remembered" | "edited" | "declined" = null,
) => {
  dispose = render(
    () => (
      <MemoryProposalCard
        shown={{
          proposal: one.id,
          title: one.change.kind === "forget" ? "Old host" : one.change.title,
          change: one.change,
          why: one.why,
          ended,
        }}
      />
    ),
    document.body,
  );
  return document.body;
};

const buttons = (root: HTMLElement): string[] =>
  [...root.querySelectorAll("button")].map((one) => one.textContent ?? "");

describe("a proposal to remember", () => {
  it("waiting alone in its turn, is the card that asks, with its three buttons", () => {
    const one = proposal("p1", "u1", "Run the linter first");
    setProposals([one]);
    const root = draw(one);
    expect(root.textContent).toContain("Conductor would like to remember");
    expect(root.textContent).toContain(
      "Nothing is remembered until you choose.",
    );
    expect(buttons(root)).toEqual(["Remember", "Edit…", "Don't"]);
  });

  it("waiting with others from its turn, is one line with the same buttons and its text one click away", () => {
    const batch = [
      proposal("p1", "u1", "One"),
      proposal("p2", "u1", "Two"),
      proposal("p3", "u1", "Three"),
    ];
    setProposals(batch);
    const root = draw(batch[1] as MemoryProposal);
    expect(root.textContent).not.toContain("would like to remember");
    expect(buttons(root)).toEqual(["▸", "Remember", "Edit…", "Don't"]);
    expect(root.textContent).not.toContain("Two, always.");
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="memory-proposal-unfold"]',
      )
      ?.click();
    expect(root.textContent).toContain("Two, always.");
  });

  it("settled, says how it ended and offers nothing", () => {
    const one = proposal("p1", "u1", "Squash-merge");
    setProposals([]);
    const root = draw(one, "edited");
    expect(
      root.querySelector('[data-testid="memory-proposal-ended"]')?.textContent,
    ).toBe("remembered, edited");
    expect(buttons(root)).toEqual([]);
  });

  it("refused when remembered, says why on the card", async () => {
    const one = proposal("p1", "u1", "Big one");
    setProposals([one]);
    memory.state.refusal =
      "Memory is full: this needs 512 characters and 380 are left. Delete or shorten an entry first.";
    const root = draw(one);
    root
      .querySelector<HTMLButtonElement>(
        '[data-testid="memory-proposal-remember"]',
      )
      ?.click();
    await vi.waitFor(() =>
      expect(
        root.querySelector('[data-testid="memory-proposal-refusal"]')
          ?.textContent,
      ).toContain("this needs 512 characters and 380 are left"),
    );
    expect(memory.approve).toHaveBeenCalledWith("p1", null);
  });

  it("to forget, offers no Edit", () => {
    const one: MemoryProposal = {
      ...proposal("p1", "u1", "x"),
      change: { kind: "forget", entry: "m3" },
    };
    setProposals([one]);
    const root = draw(one);
    expect(root.textContent).toContain("Conductor would like to forget");
    expect(buttons(root)).toEqual(["Forget it", "Don't"]);
  });
});
