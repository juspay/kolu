// @vitest-environment happy-dom
/**
 * THE SIDEBAR — what each work's entry says and where it sits: the wait chip
 * only while the work waits on you, three terminal marks then a count, the
 * works that need you pinned above the rest, Finished folded on the
 * overview's switch, and the way back to all the works only while one is
 * picked.
 */

import { Option } from "effect";
import type { Work, WorkId, WorkRow } from "kolu-work";
import { render } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StandingLine } from "./workReadings";

const NOW = Date.parse("2026-01-01T00:10:00Z");

const world = vi.hoisted(() => ({
  facts: new Map<string, { members: number; at: unknown }>(),
}));

vi.mock("./workFacts", () => ({
  createWorkFacts: (id: () => string) => {
    const one = () => world.facts.get(id());
    return {
      members: () =>
        Array.from({ length: one()?.members ?? 0 }, (_, i) => ({
          terminal: `local/${i}`,
          split: { host: "local", id: `t${i}` },
          standing: undefined,
        })),
      livePr: () => null,
      checks: () => Option.none(),
      at: () => one()?.at,
    };
  },
}));
vi.mock("./MemberPip", () => ({
  default: () => <span data-testid="member-pip-stub" />,
}));
vi.mock("../ui/shown", async (actual) => ({
  ...(await actual<typeof import("../ui/shown")>()),
  useShownClock: () => () => NOW,
}));

import WorkRail from "./WorkRail";
import {
  isFinishedOpen,
  pickWork,
  toggleFinished,
  unpickWork,
} from "./workListing";
import { createSignal, flush } from "solid-js";
import { standingClock } from "./WorkStanding";

const standing = (who: StandingLine["who"], lead: string): StandingLine => ({
  who,
  lead,
  what: Option.none(),
  since: "2026-01-01T00:07:00Z",
  clock: "for",
});

const row = (id: string, title: string): WorkRow =>
  [
    id as WorkId,
    {
      key: { kind: "watch", terminal: "local/a" },
      title,
      events: [],
      decisions: [],
      startedAt: "2026-01-01T00:00:00Z",
      state: { kind: "open" },
      worktree: { kind: "unread" },
    } as Work,
  ] as WorkRow;

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

beforeEach(() => {
  world.facts = new Map();
  unpickWork();
  if (isFinishedOpen()) toggleFinished();
});
afterEach(() => {
  dispose?.();
  root?.remove();
});

type Groups = {
  waiting?: WorkRow[];
  moving?: WorkRow[];
  finished?: WorkRow[];
};

/** Hand the sidebar new groups, as the column does on any work's change. */
let setGroups: (groups: Groups) => void = () => {};

function mount(initial: Groups): HTMLElement {
  const [groups, set] = createSignal(initial);
  setGroups = set;
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <WorkRail
        groups={{
          get waiting() {
            return groups().waiting ?? [];
          },
          get moving() {
            return groups().moving ?? [];
          },
          watching: [],
          get finished() {
            return groups().finished ?? [];
          },
        }}
      />
    ),
    root,
  );
  return root;
}

const entry = (el: HTMLElement, id: string) => {
  const found = el.querySelector<HTMLElement>(`[data-rail-work="${id}"]`);
  if (found === null) throw new Error(`no entry for ${id}`);
  return found;
};

describe("the works sidebar", () => {
  it("shows the wait chip only while the work waits on you", () => {
    world.facts.set("a", { members: 1, at: standing("you", "Needs you") });
    world.facts.set("b", {
      members: 1,
      at: standing("agent", "Agents at work"),
    });
    const el = mount({
      waiting: [row("a", "Dark mode")],
      moving: [row("b", "CSV export")],
    });
    expect(
      entry(el, "a").querySelector('[data-testid="works-rail-wait"]')
        ?.textContent,
    ).toBe("3m");
    expect(
      entry(el, "b").querySelector('[data-testid="works-rail-wait"]'),
    ).toBeNull();
    // The card's own clock for a work at work (`standingClock`): a plain
    // duration, not an age.
    expect(
      entry(el, "b").querySelector('[data-testid="works-rail-since"]')
        ?.textContent,
    ).toBe(standingClock(standing("agent", "Agents at work"), NOW));
    expect(
      entry(el, "b").querySelector('[data-testid="works-rail-standing"]')
        ?.textContent,
    ).toBe("Agents at work");
  });

  it("keeps an entry and its marks when the works are handed over again", () => {
    world.facts.set("a", {
      members: 2,
      at: standing("agent", "Agents at work"),
    });
    world.facts.set("b", {
      members: 1,
      at: standing("agent", "Agents at work"),
    });
    const el = mount({ moving: [row("a", "CSV export"), row("b", "Docs")] });
    const before = entry(el, "a");
    const marks = [
      ...before.querySelectorAll('[data-testid="member-pip-stub"]'),
    ];
    // Another work's record changes: every row is minted afresh.
    setGroups({ moving: [row("a", "CSV export"), row("b", "Docs, again")] });
    flush();
    expect(entry(el, "a")).toBe(before);
    // Its own record changes.
    setGroups({ moving: [row("a", "CSV export, renamed"), row("b", "Docs")] });
    flush();
    const after = entry(el, "a");
    expect(after).toBe(before);
    const now = [...after.querySelectorAll('[data-testid="member-pip-stub"]')];
    expect(now).toHaveLength(marks.length);
    expect(now.every((mark, i) => mark === marks[i])).toBe(true);
    expect(after.textContent).toContain("CSV export, renamed");
  });

  it("draws three terminal marks, then counts the rest", () => {
    world.facts.set("a", {
      members: 5,
      at: standing("agent", "Agents at work"),
    });
    const one = entry(mount({ moving: [row("a", "Busy work")] }), "a");
    expect(
      one.querySelectorAll('[data-testid="member-pip-stub"]'),
    ).toHaveLength(3);
    expect(one.textContent).toContain("+2");
  });

  it("pins the works that need you above the rest", () => {
    world.facts.set("a", { members: 0, at: standing("you", "Needs you") });
    world.facts.set("b", {
      members: 0,
      at: standing("agent", "Agents at work"),
    });
    const el = mount({
      waiting: [row("a", "Dark mode")],
      moving: [row("b", "CSV export")],
    });
    const pinned = el.querySelector('[data-testid="works-rail-pinned"]');
    expect(pinned?.querySelector('[data-rail-work="a"]')).not.toBeNull();
    expect(pinned?.querySelector('[data-rail-work="b"]')).toBeNull();
    expect(pinned?.textContent).toContain("Needs you · 1");
  });

  it("folds Finished on the overview's switch", () => {
    world.facts.set("f", { members: 0, at: standing("done", "Merged #7") });
    const el = mount({ finished: [row("f", "Old work")] });
    expect(el.querySelector('[data-rail-work="f"]')).toBeNull();
    el.querySelector<HTMLElement>(
      '[data-testid="works-rail-finished-toggle"]',
    )?.click();
    flush();
    expect(isFinishedOpen()).toBe(true);
    expect(el.querySelector('[data-rail-work="f"]')).not.toBeNull();
  });

  it("offers the way back to all the works only while one is picked", () => {
    world.facts.set("a", {
      members: 0,
      at: standing("agent", "Agents at work"),
    });
    const el = mount({ moving: [row("a", "CSV export")] });
    expect(el.querySelector('[data-testid="works-all"]')).toBeNull();
    pickWork("a" as WorkId);
    flush();
    expect(el.querySelector('[data-testid="works-all"]')).not.toBeNull();
  });
});
