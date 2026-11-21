// @vitest-environment happy-dom
/**
 * A work's terminal rows: role, name, what it runs, how it stands and for how
 * long, Look, and Take over or Hand back — read without opening the card.
 */

import type { TerminalId } from "kolu-common/surface";
import type { Work } from "kolu-work";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import type { MemberLine } from "./WorkTerminals";

const REMOTE_ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const LOCAL_ID = "22222222-2222-4222-8222-222222222222" as TerminalId;
const REMOTE_REF = `remote:nix@example/${REMOTE_ID}`;
const LOCAL_REF = `local/${LOCAL_ID}`;

const world = vi.hoisted(() => ({
  names: new Map<string, string>(),
  drivers: new Map<string, string>(),
  seen: new Map<string, { level: string; since: string }>(),
  runs: new Map<string, string>(),
  peeks: [] as unknown[],
  tiles: [] as unknown[],
  takes: [] as string[],
  backs: [] as string[],
}));

vi.mock("./memberNames", async (actual) => ({
  ...(await actual<typeof import("./memberNames")>()),
  useKnownNames: () => () => world.names,
}));
vi.mock("./useWorks", () => ({
  useSeen: () => () => world.seen,
  useMembership: () => () =>
    new Map(
      [...world.drivers].map(([ref, driver]) => [
        ref,
        { work: "w", title: "t", role: "implementor", driver },
      ]),
    ),
}));
vi.mock("./useConductor", () => ({
  useConductor: () => ({
    takeOver: (ref: string) => world.takes.push(ref),
    handBack: (ref: string) => world.backs.push(ref),
  }),
}));
vi.mock("./useOpenTile", () => ({
  useOpenTile: () => (at: unknown) => world.tiles.push(at),
}));
vi.mock("./peek/usePeek", () => ({
  openPeek: (at: unknown) => world.peeks.push(at),
}));
vi.mock("./workReadings", async (actual) => {
  const real = await actual<typeof import("./workReadings")>();
  const { Option } = await import("effect");
  return {
    ...real,
    roleRuns: (_work: unknown, role: string) => {
      const runs = world.runs.get(role);
      return runs === undefined ? Option.none() : Option.some(runs);
    },
  };
});

import WorkTerminals from "./WorkTerminals";

const WORK = {} as Work;

const thinking: FleetTerminalStanding = {
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
      taskProgress: null,
    },
  } as never,
};
const asleep: FleetTerminalStanding = {
  kind: "here",
  meta: { state: "sleeping" } as never,
};

const line = (
  ref: string,
  role: "planner" | "implementor",
  standing: FleetTerminalStanding | undefined,
): MemberLine => {
  const [host, id] = [
    ref.slice(0, ref.lastIndexOf("/")),
    ref.slice(ref.lastIndexOf("/") + 1),
  ];
  return {
    terminal: ref,
    member: { work: "w", role, joinedAt: "2026-01-01T00:00:00Z" } as never,
    split: { host, id: id as TerminalId },
    standing,
  };
};

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

beforeEach(() => {
  world.names = new Map();
  world.drivers = new Map();
  world.seen = new Map();
  world.runs = new Map();
  world.peeks = [];
  world.tiles = [];
  world.takes = [];
  world.backs = [];
});

afterEach(() => {
  dispose?.();
  root?.remove();
});

const NOW = Date.parse("2026-01-01T00:10:00Z");

function mount(members: MemberLine[]): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => <WorkTerminals work={WORK} members={members} now={NOW} />,
    root,
  );
  return root;
}

const row = (el: HTMLElement, ref: string): HTMLElement => {
  const found = el.querySelector<HTMLElement>(
    `[data-testid="work-member"][data-ref="${ref}"]`,
  );
  if (found === null) throw new Error(`no row for ${ref}`);
  return found;
};
const part = (el: HTMLElement, id: string) =>
  el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("a work's terminal row", () => {
  it("says its role, name, state and for how long", () => {
    world.names.set(LOCAL_REF, "api-server");
    world.seen.set(LOCAL_REF, {
      level: "working",
      since: "2026-01-01T00:07:00Z",
    });
    const one = row(mount([line(LOCAL_REF, "planner", thinking)]), LOCAL_REF);
    expect(part(one, "work-member-role")?.textContent).toBe("Planner");
    expect(part(one, "work-member-name")?.textContent).toBe("api-server");
    const status = part(one, "work-member-status")?.textContent ?? "";
    expect(status).toContain("Thinking for 3m");
    expect(status).toContain("writing the plan");
  });

  it("names its host when kolu has no name, and shows no id anywhere", () => {
    const one = row(
      mount([line(REMOTE_REF, "implementor", { kind: "gone" })]),
      REMOTE_REF,
    );
    expect(part(one, "work-member-name")?.textContent).toBe("on nix@example");
    expect(one.textContent).not.toContain(REMOTE_ID.slice(0, 8));
  });

  it("opens the peek at its host and id from Look", () => {
    const one = row(
      mount([line(REMOTE_REF, "implementor", thinking)]),
      REMOTE_REF,
    );
    part(one, "work-member-look")?.click();
    expect(world.peeks).toEqual([
      { host: "remote:nix@example", id: REMOTE_ID },
    ]);
  });

  it("has no Look while the terminal sleeps or is gone", () => {
    const el = mount([
      line(LOCAL_REF, "planner", asleep),
      line(REMOTE_REF, "implementor", { kind: "gone" }),
    ]);
    expect(part(row(el, LOCAL_REF), "work-member-look")).toBeNull();
    expect(part(row(el, REMOTE_REF), "work-member-look")).toBeNull();
  });

  it("offers Take over, Hand back or neither by who drives it", () => {
    world.drivers.set(LOCAL_REF, "conductor");
    world.drivers.set(REMOTE_REF, "you");
    const third = "local/33333333-3333-4333-8333-333333333333";
    world.drivers.set(third, "nobody");
    const el = mount([
      line(LOCAL_REF, "planner", thinking),
      line(REMOTE_REF, "implementor", thinking),
      line(third, "implementor", thinking),
    ]);
    part(row(el, LOCAL_REF), "work-member-take-over")?.click();
    part(row(el, REMOTE_REF), "work-member-hand-back")?.click();
    expect(world.takes).toEqual([LOCAL_REF]);
    expect(world.backs).toEqual([REMOTE_REF]);
    const none = row(el, third);
    expect(part(none, "work-member-take-over")).toBeNull();
    expect(part(none, "work-member-hand-back")).toBeNull();
  });

  it("makes the name the way to the tile only while the terminal is here", () => {
    world.names.set(LOCAL_REF, "api-server");
    world.names.set(REMOTE_REF, "docs");
    const el = mount([
      line(LOCAL_REF, "planner", thinking),
      line(REMOTE_REF, "implementor", { kind: "gone" }),
    ]);
    const here = part(row(el, LOCAL_REF), "work-member-name");
    expect(here?.tagName).toBe("BUTTON");
    here?.click();
    expect(world.tiles).toEqual([{ host: "local", id: LOCAL_ID }]);
    expect(part(row(el, REMOTE_REF), "work-member-name")?.tagName).toBe("SPAN");
  });

  it("says what it runs from the setup, else the agent seen, else nothing", () => {
    world.runs.set("planner", "omp/fable-5");
    const el = mount([
      line(LOCAL_REF, "planner", thinking),
      line(REMOTE_REF, "implementor", thinking),
    ]);
    expect(part(row(el, LOCAL_REF), "work-member-runs")?.textContent).toBe(
      "omp/fable-5",
    );
    expect(
      part(row(el, REMOTE_REF), "work-member-runs")?.textContent,
    ).toBeTruthy();
    dispose?.();
    root?.remove();
    const bare = mount([line(REMOTE_REF, "implementor", { kind: "gone" })]);
    expect(part(row(bare, REMOTE_REF), "work-member-runs")).toBeNull();
  });

  it("says plainly when a work has no terminals", () => {
    const el = mount([]);
    expect(part(el, "work-terminals")).toBeNull();
    expect(part(el, "work-no-terminals")?.textContent).toBe(
      "No terminals. Nothing is running in this work.",
    );
  });
});
