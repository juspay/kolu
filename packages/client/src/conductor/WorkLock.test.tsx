// @vitest-environment happy-dom
/**
 * THE LOCK IS ONE TERMINAL'S FRAME, AND IT IS DRAWN FROM ONE TERMINAL'S FACT.
 *
 * The works and the members arrive as the app's two collections and the
 * membership index is derived from them FOR REAL here — the point of the
 * third case is what that derivation does to a terminal that did not move,
 * and a scripted index could not say.
 */
import { render } from "@solidjs/web";
import {
  answerAsk,
  askQuestions,
  joinWork,
  type Membership,
  openWork,
  type Question,
  type Work,
  type WorkId,
  workIdOf,
  type WorkKey,
  type WorkMember,
} from "kolu-work";
import type * as WorkReadings from "./workReadings";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const A = "local/11111111-1111-4111-8111-111111111111";
const B = "local/22222222-2222-4222-8222-222222222222";
const REF = A;

const seam = vi.hoisted(() => ({
  setWorks: (_: ReadonlyMap<string, unknown>) => {},
  setMembers: (_: ReadonlyMap<string, unknown>) => {},
  taken: [] as string[],
  /** How many times the card's words have been folded — one per run of the
   *  binding that draws them. */
  cardWords: 0,
}));

// THE REAL READINGS, counted: every fold is the module's own, and the one
// the card's words come from says how often A's bindings ran.
vi.mock("./workReadings", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkReadings>();
  return {
    ...actual,
    lockCardWords: (at: Membership) => {
      seam.cardWords += 1;
      return actual.lockCardWords(at);
    },
  };
});

// THE TWO COLLECTIONS, as `useWorks` binds them: a key list and a per-key
// accessor. Everything above them — the works map, the members map and the
// membership index itself — is the real module.
vi.mock("../wire", async () => {
  // The factory is hoisted above this file's imports, so the primitive it
  // needs is reached from inside it.
  const solid = await import("solid-js");
  const bound = <V,>(read: () => ReadonlyMap<string, V>) => ({
    keys: () => [...read().keys()],
    byKey: (key: string) => () => read().get(key),
  });
  const [works, setWorks] = solid.createSignal<ReadonlyMap<string, unknown>>(
    new Map(),
  );
  const [members, setMembers] = solid.createSignal<
    ReadonlyMap<string, unknown>
  >(new Map());
  seam.setWorks = setWorks;
  seam.setMembers = setMembers;
  return {
    encActiveHost: () => "local",
    app: {
      collections: {
        works: { use: () => bound(works) },
        workMembers: { use: () => bound(members) },
      },
    },
  };
});

vi.mock("./useConductor", () => ({
  useConductor: () => ({
    takeOver: (ref: string) => seam.taken.push(ref),
    handBack: () => {},
  }),
}));

import WorkLock from "./WorkLock";
import { dismissLockCard, personInputAt } from "./personInput";

const T = (minute: number): string =>
  new Date(Date.UTC(2026, 10, 14, 10, minute)).toISOString();

const KEY: WorkKey = {
  kind: "branch",
  host: "local",
  repo: "/r",
  branch: "locked",
  repoBy: { kind: "git" },
};
const ID: WorkId = workIdOf(KEY);

const SETUP: ReadonlyArray<Question> = [
  {
    id: "q-mode",
    topic: "setup",
    key: "mode",
    question: "Which mode?",
    options: ["full", "trivial"],
    given: { kind: "ask" },
  },
];

/** A DRIVEN WORK, with both terminals in it: its mode is answered, so kolu
 *  types into its members and a member has a lock to draw. */
const drivenWork = (): Work => {
  const asked = askQuestions(
    openWork({ key: KEY, title: "w", at: T(0), request: { kind: "none" } }),
    { ask: "ask-1", questions: SETUP, at: T(1) },
  );
  const set = answerAsk(asked, {
    ask: "ask-1",
    at: T(2),
    from: "card",
    reply: { kind: "answered", values: new Map([["q-mode", ["full"]]]) },
  });
  return joinWork(
    joinWork(set, { terminal: A, role: "implementor", at: T(3) }),
    { terminal: B, role: "planner", at: T(3) },
  );
};

const memberOf = (role: WorkMember["role"]): WorkMember => ({
  work: ID,
  role,
  joinedAt: T(3),
});

/** Both terminals in the one work, A as its implementor. */
const bothJoined = (): void => {
  seam.setWorks(new Map([[ID, drivenWork()]]));
  seam.setMembers(
    new Map([
      [A, memberOf("implementor")],
      [B, memberOf("planner")],
    ]),
  );
  flush();
};

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
  seam.setWorks(new Map());
  seam.setMembers(new Map());
  flush();
  seam.taken = [];
});

const cards = () => document.querySelectorAll('[data-testid="work-lock-card"]');

describe("WorkLock", () => {
  it("keeps the card a press is inside open while the same terminal is drawn twice", () => {
    bothJoined();
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
    bothJoined();
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

  it("does not touch one terminal's frame while ANOTHER terminal's membership moves", () => {
    bothJoined();
    mountTwo();
    // The card up, so the words the frame draws are live bindings to count.
    expect(personInputAt(REF)).toBe(false);
    flush();
    const frame = document.querySelector<HTMLElement>(
      '[data-testid="work-lock"]',
    );
    if (frame === null) throw new Error("the lock drew no frame");
    // WHAT THE CARD'S WORDS COST: the fold runs once per run of the binding
    // that draws them, so counting it counts A's readers waking. Nothing B
    // does may wake one.
    const before = seam.cardWords;

    // B's role moves four times. A's membership says exactly what it said.
    for (const role of ["planner", "other", "planner", "other"] as const) {
      seam.setMembers(
        new Map([
          [A, memberOf("implementor")],
          [B, memberOf(role)],
        ]),
      );
      flush();
    }

    expect(seam.cardWords).toBe(before);
    expect(frame.dataset.role).toBe("implementor");
    expect(frame.dataset.driver).toBe("conductor");
  });
});
