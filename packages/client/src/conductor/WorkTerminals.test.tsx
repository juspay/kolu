// @vitest-environment happy-dom
/**
 * A work's terminal rows: role, name, what it runs, the Dock's indicator, how
 * it stands and for how long, Look, and Take over or Hand back — read without
 * opening the card.
 */

import type { TerminalId } from "kolu-common/surface";
import type { Work } from "kolu-work";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import type { MemberLine } from "./workFacts";

const REMOTE_ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const LOCAL_ID = "22222222-2222-4222-8222-222222222222" as TerminalId;
const REMOTE_REF = `remote:nix@example/${REMOTE_ID}`;
const LOCAL_REF = `local/${LOCAL_ID}`;

const world = vi.hoisted(() => ({
  names: new Map<string, string>(),
  drivers: new Map<string, string>(),
  seen: new Map<string, { level: string; since: string }>(),
  setups: new Map<string, unknown>(),
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
vi.mock("kolu-work", async (actual) => ({
  ...(await actual<typeof import("kolu-work")>()),
  roleSetupOf: (_work: unknown, role: string) =>
    world.setups.get(role) ?? { kind: "not-chosen" },
}));
// The pip's attention comes off each host's padi frame; nothing here is
// asking or live, so every pip paints at rest.
vi.mock("../attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));

import { attentionRecordOf } from "../attention/savedAttention";
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
/** An agent whose session has named its model. */
const reporting = (model: string): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: null,
      taskProgress: null,
      model,
    },
  } as never,
});
/** A plain shell with a command in front of it. */
const running: FleetTerminalStanding = {
  kind: "here",
  meta: {
    state: "active",
    agent: null,
    foreground: {
      name: "restic",
      title: "restic backup ~/data --verbose",
      shell: false,
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
  world.setups = new Map();
  localStorage.clear();
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
    world.setups.set("planner", {
      kind: "harness-and-model",
      harness: "omp",
      model: "fable-5",
    });
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

  it("names the model the session reports over the one the setup chose", () => {
    world.setups.set("planner", {
      kind: "harness-and-model",
      harness: "omp",
      model: "fable-5",
    });
    const el = mount([line(LOCAL_REF, "planner", reporting("fable-5.2-max"))]);
    expect(part(row(el, LOCAL_REF), "work-member-runs")?.textContent).toBe(
      "omp/fable-5.2-max",
    );
  });

  it("says the command a shell runs by its title, as the Dock does", () => {
    const el = mount([line(LOCAL_REF, "planner", running)]);
    const status = part(row(el, LOCAL_REF), "work-member-status")?.textContent;
    expect(status).toContain("No agent");
    expect(status).toContain("restic backup ~/data --verbose");
  });

  it("draws the Dock's indicator, empty for a terminal it cannot read", () => {
    const el = mount([
      line(LOCAL_REF, "planner", thinking),
      line(REMOTE_REF, "implementor", { kind: "gone" }),
    ]);
    const live = part(row(el, LOCAL_REF), "state-pip");
    expect(live?.dataset.glyph).toBe("claude-code");
    expect(live?.dataset.pip).not.toBe("empty");
    expect(part(row(el, REMOTE_REF), "state-pip")?.dataset.pip).toBe("empty");
  });

  it("marks a ping not yet opened from the terminal's own host", () => {
    // The same id on two hosts: only the host whose record holds the mark
    // shows it.
    attentionRecordOf("remote:nix@example").markUnread(REMOTE_ID);
    const el = mount([
      line(REMOTE_REF, "implementor", thinking),
      line(`local/${REMOTE_ID}`, "planner", thinking),
    ]);
    expect(part(row(el, REMOTE_REF), "state-pip")?.dataset.alert).toBeDefined();
    expect(
      part(row(el, `local/${REMOTE_ID}`), "state-pip")?.dataset.alert,
    ).toBeUndefined();
  });

  it("says plainly when a work has no terminals", () => {
    const el = mount([]);
    expect(part(el, "work-terminals")).toBeNull();
    expect(part(el, "work-no-terminals")?.textContent).toBe(
      "No terminals. Nothing is running in this work.",
    );
  });
});
