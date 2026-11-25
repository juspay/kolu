// @vitest-environment happy-dom
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const REF = "local/11111111-1111-4111-8111-111111111111";

const seam = vi.hoisted(() => ({
  membership: new Map<string, unknown>(),
  taken: [] as string[],
}));

vi.mock("./useWorks", () => ({ useMembership: () => () => seam.membership }));
vi.mock("../wire", () => ({ encActiveHost: () => "local" }));
vi.mock("./useConductor", () => ({
  useConductor: () => ({
    takeOver: (ref: string) => seam.taken.push(ref),
    handBack: () => {},
  }),
}));

import WorkLock from "./WorkLock";
import { dismissLockCard, personInputAt } from "./personInput";

const disposers: Array<() => void> = [];

const mountTwo = () => {
  for (let i = 0; i < 2; i++) {
    const root = document.createElement("div");
    document.body.append(root);
    const dispose = render(() => <WorkLock terminal={REF} />, root);
    disposers.push(() => {
      dispose();
      root.remove();
    });
  }
  flush();
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  dismissLockCard();
  seam.membership.clear();
  seam.taken = [];
});

const cards = () => document.querySelectorAll('[data-testid="work-lock-card"]');

describe("WorkLock", () => {
  it("keeps the card a press is inside open while the same terminal is drawn twice", () => {
    seam.membership.set(REF, {
      work: "w",
      title: "w",
      role: "implementor",
      driver: "conductor",
    });
    mountTwo();
    expect(personInputAt(REF)).toBe(false);
    flush();
    expect(cards()).toHaveLength(2);

    const button = cards()[0]?.querySelector<HTMLButtonElement>(
      '[data-testid="work-take-over"]',
    );
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    button?.click();
    flush();

    expect(seam.taken).toEqual([REF]);
    expect(cards()).toHaveLength(0);
  });

  it("puts the card away for a press outside every card", () => {
    seam.membership.set(REF, {
      work: "w",
      title: "w",
      role: "implementor",
      driver: "conductor",
    });
    mountTwo();
    expect(personInputAt(REF)).toBe(false);
    flush();
    expect(cards()).toHaveLength(2);

    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    flush();

    expect(cards()).toHaveLength(0);
    expect(seam.taken).toHaveLength(0);
  });
});
