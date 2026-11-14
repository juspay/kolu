// @vitest-environment happy-dom
/**
 * THE WATCHED PANEL RENDERS — the list a person opens from the status line.
 *
 * It is one GROUP per piece of work (the grouping arrives from kolu-server on
 * the cell, so nothing here recomputes it) and one row per watched ref under
 * it, each row drawing the terminal's identity plus `ConductorLook`'s live
 * standing. So this mounts over the same seams `ConductorLook.test.tsx` stubs
 * (the fleet index, the padi wire, tips) and asserts the groups, the rows and
 * their Look exist and act. Nothing here takes a terminal off the list: the
 * panel is a reading.
 */

import { Effect } from "effect";
import type { ConductorState } from "kolu-common/conductor";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FleetTerminalRow,
  FleetTerminalStanding,
} from "../palette/fleetTerminals";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;
const REF = `local/${TERMINAL}`;
const OTHER_TERMINAL = "22222222-2222-4222-8222-222222222222" as TerminalId;
const OTHER_REF = `local/${OTHER_TERMINAL}`;
const SPLIT_TERMINAL = "33333333-3333-4333-8333-333333333333" as TerminalId;
const SPLIT_REF = `local/${SPLIT_TERMINAL}`;

/** THE APP'S 1 s CLOCK, driven by hand. The real one is a single
 *  app-lifetime interval which also stands down for a hidden DOCUMENT — a
 *  fact about the browser tab, not about this pane — so the tick itself is
 *  the seam here, and what the cases pin is which frames the row reads it in.
 *  Declared before the stamps below, which are made relative to it: two
 *  clocks a millisecond apart is how `working 4m` becomes `3m 59s`. */
const clockSeam = vi.hoisted(() => ({
  at: undefined as (() => number) | undefined,
  advance: undefined as ((byMs: number) => void) | undefined,
}));

/** When the piece of work's first terminal joined the watch list — an hour
 *  before the clock every test below mounts against, so the heading's age is
 *  a number a person would read rather than `0s`. */
const JOINED_AT = new Date(
  (clockSeam.at?.() ?? Date.now()) - 3_600_000,
).toISOString();

/** One piece of work, the shape the cell publishes. */
const piece = (
  root: string,
  name: string,
  refs: readonly string[],
  since = JOINED_AT,
): ConductorState["work"][number] => ({ root, name, refs, since });

/** ONE WATCHED TERMINAL'S READING, as kolu's watch publishes it: the level it
 *  was last read at, and when it entered that level. The panel's row clock is
 *  this and nothing else — there is no per-state stamp on a host to read. */
const read = (
  ref: string,
  level: ConductorState["seen"][number]["level"],
  agoMs: number,
): ConductorState["seen"][number] => ({
  ref,
  level,
  since: new Date((clockSeam.at?.() ?? Date.now()) - agoMs).toISOString(),
});

/** Four minutes of working, which is what every case that does not care about
 *  the clock is mounted with. */
const WORKING_4M = [read(REF, "working", 4 * 60_000)];

/** WHAT EVERY TERMINAL'S STANDING IS, and the ones that differ. The panel
 *  reads one standing per watched ref — the row's agent, the words the naming
 *  ladder climbs, and the `parentId` the tree is drawn from all come off it —
 *  so a case about a split and its parent has to be able to say something
 *  different about each terminal. */
const [standing, setStanding] = createSignal<FleetTerminalStanding>({
  kind: "gone",
});
const [eachStanding, setEachStanding] = createSignal<
  Record<string, FleetTerminalStanding>
>({});

/** `await import` inside the factory rather than a static import: a `vi.mock`
 *  factory is hoisted above this file's imports, so there is nothing else it
 *  can read a module from. */
vi.mock("../time/clock", async (importOriginal) => {
  const { createSignal } = await import("solid-js");
  const [now, setNow] = createSignal(Date.now());
  clockSeam.at = now;
  clockSeam.advance = (byMs: number) => setNow((previous) => previous + byMs);
  return {
    // The REST of the module is real — other readouts in this tree keep their
    // own clocks, and only the 1 s wall clock this panel reads is driven here.
    ...(await importOriginal<typeof import("../time/clock")>()),
    getClockNow: () => now,
  };
});

vi.mock("../palette/fleetTerminals", async (importOriginal) => ({
  // The grouping/keying half stays REAL — the panel's names come from the same
  // computation the `@` menu uses, and a stub there would prove nothing.
  ...(await importOriginal<typeof import("../palette/fleetTerminals")>()),
  fleetTerminalStanding: (_host: string, id: TerminalId) =>
    eachStanding()[id] ?? standing(),
  useFleetTerminalIndex: () => (): FleetTerminalRow[] => [],
}));
vi.mock("../wire", () => ({
  padiRpcOf: (_host: HostKey) => ({
    screen: { text: () => Effect.succeed("line one") },
  }),
}));
vi.mock("../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: () => {} }),
}));

/** WHERE PRESSING A NAME LANDED — the two steps `useOpenTile` takes, caught
 *  at the same two seams `ConductorToolCard.test.tsx` catches them at. The
 *  point of the assertion is that the row takes the card's journey, so it is
 *  read at the card's own boundary rather than through a stub of the shared
 *  helper, which would prove only that a stub was called. */
const landed = vi.hoisted(() => ({
  hosts: [] as HostKey[],
  focused: [] as TerminalId[],
}));
vi.mock("../host/selectHostTab", () => ({
  selectHostTab: (host: HostKey) => landed.hosts.push(host),
}));
vi.mock("../canvas/dock/useDockFocus", () => ({
  useDockFocus: () => (id: TerminalId) => landed.focused.push(id),
}));

import ConductorWatchedPanel from "./ConductorWatchedPanel";
import { Shown } from "../ui/shown";

/** An active terminal whose agent is working, as the fleet reports it. The
 *  record carries what the panel NAMES a terminal from as well as what it
 *  says about it — a terminal with a working directory and no intent is the
 *  ordinary case, and it is the one a raw uuid used to be drawn for. */
const working = (
  over: Record<string, unknown> = {},
): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    cwd: "/home/srid/code/kolu",
    git: { kind: "none" },
    lastActivityAt: Date.now() - 4_000,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
      taskProgress: null,
    },
    ...over,
  } as never,
});

/** The agent in a terminal that has NOT titled itself — the split the human
 *  saw drawn as a uuid. `taskProgress` rides as an override. */
const untitled = (over: Record<string, unknown> = {}) => ({
  kind: "claude-code",
  state: "thinking",
  summary: null,
  taskProgress: null,
  ...over,
});

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

function mount(
  work: ConductorState["work"],
  over: {
    placement?: "inline" | "side";
    /** The watch's readings. Defaults to the one terminal every case draws,
     *  four minutes into working. */
    seen?: ConductorState["seen"];
    /** Is the pane the view being read? The rows' clocks are gated on it. */
    shown?: () => boolean;
  } = {},
): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <Shown.Provider value={over.shown ?? (() => true)}>
        <ConductorWatchedPanel
          work={work}
          seen={over.seen ?? WORKING_4M}
          placement={over.placement ?? "inline"}
        />
      </Shown.Provider>
    ),
    root,
  );
  return root;
}

const at = (testid: string): HTMLElement | undefined =>
  root?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? undefined;

const all = (testid: string): HTMLElement[] =>
  Array.from(
    root?.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`) ?? [],
  );

beforeEach(() => {
  setStanding(working());
  setEachStanding({});
});

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  landed.hosts = [];
  landed.focused = [];
});

describe("the watched panel", () => {
  it("draws a row per watched terminal, with its agent and its clock", () => {
    mount([piece(REF, "fix-parser", [REF])]);
    const row = at("conductor-watched-row");
    expect(row).toBeDefined();
    expect(row?.dataset.ref).toBe(REF);
    expect(at("conductor-watched-agent")?.textContent).toBe("Claude Code");
    // The clock is on the LINE THAT REPORTS THE STATE, not floating on the
    // identity line above it: one line says who, the next says how it stands
    // and for how long.
    // Four minutes of WORKING — the state kolu's watch read and the moment it
    // read the change, which is the one clock there is. The seconds are not
    // pinned: the pane's tick is a second hand of its own.
    const clock = at("conductor-watched-since");
    expect(clock?.textContent).toMatch(/^working 4m/);
    expect(at("conductor-look")?.contains(clock ?? null)).toBe(true);
    // The peek is the transcript's own, found under the panel's name.
    expect(at("conductor-watched-look")).toBeDefined();
  });

  it("ages a piece of work from the heading, counting from when it joined", () => {
    mount([piece(REF, "fix-parser", [REF, SPLIT_REF])]);
    // An hour on this browser's clock — the number a person reads, not a
    // restated ISO stamp.
    expect(at("conductor-watched-group-since")?.textContent).toContain("1h");
  });

  it("still ages a piece of work whose heading says nothing", () => {
    // The group-of-one rule drops the NAME (the heading would say the row's
    // own word back at it); the age is not a repeat of anything, so it stays.
    mount([piece(REF, "writing the plan", [REF])]);
    expect(at("conductor-watched-group-name")).toBeUndefined();
    expect(at("conductor-watched-group-since")?.textContent).toContain("1h");
  });

  it("takes you to the terminal when its name is pressed — the card's journey", () => {
    mount([piece(REF, "fix-parser", [REF])]);
    const name = at("conductor-watched-name");
    expect(name?.dataset.opensTile).toBe("true");
    // The accessible name says what pressing it DOES and still carries the
    // words on screen. The fleet index is stubbed empty here, so those words
    // are the next rung of the ladder — what the agent in it calls what it is
    // doing — and never the terminal's raw id.
    expect(name?.getAttribute("aria-label")).toBe("Go to writing the plan");
    expect(name?.getAttribute("aria-label")).not.toContain(TERMINAL);
    name?.click();
    // The host tab first, then the tile — the two steps, in order.
    expect(landed.hosts).toEqual([{ kind: "local" }]);
    expect(landed.focused).toEqual([TERMINAL]);
  });

  it("offers no way there for a terminal that is gone", () => {
    setStanding({ kind: "gone" });
    mount([piece(REF, "fix-parser", [REF])]);
    const name = at("conductor-watched-name");
    // Still named — the Conductor is still watching it — with nothing to
    // press: there is no tile to land on. There is no record left to read a
    // name off either, so this is the ladder's last rung: the SHORT id, which
    // a person can read, rather than 36 characters of uuid.
    expect(name?.textContent).toBe(TERMINAL.slice(0, 8));
    expect(name?.textContent).not.toBe(TERMINAL);
    expect(name?.dataset.opensTile).toBeUndefined();
    name?.click();
    expect(landed.hosts).toEqual([]);
    expect(landed.focused).toEqual([]);
  });

  it("shows no duration for a terminal the watch has not read", () => {
    setStanding({ kind: "unreachable" });
    // A host that is away produces no readings at all, so this ref is absent
    // from `seen`. Nothing has been read off that machine, so there is no
    // honest duration to show — and an invented one is the thing this panel
    // must not do.
    mount([piece(REF, "fix-parser", [REF])], { seen: [] });
    expect(at("conductor-watched-name")?.dataset.opensTile).toBeUndefined();
    expect(at("conductor-watched-since")).toBeUndefined();
  });

  it("counts every state the same way, the sleeping one included", () => {
    setStanding({
      kind: "here",
      meta: {
        state: "sleeping",
        foreground: null,
        cwd: "/home/srid/code/kolu",
        git: { kind: "none" },
        lastActivityAt: Date.now() - 7_200_000,
        agent: null,
      } as never,
    });
    mount([piece(REF, "fix-parser", [REF])], {
      seen: [read(REF, "asleep", 125_000)],
    });
    // Two minutes ASLEEP, not the two hours since this terminal last moved:
    // the clock counts the state the watch read, and the word beside it is
    // the watch's own.
    expect(at("conductor-watched-since")?.textContent).toMatch(/^asleep 2m/);
  });

  it("stops counting while nobody is looking at the pane", () => {
    const [shown, setShown] = createSignal(true);
    mount([piece(REF, "fix-parser", [REF])], {
      seen: [read(REF, "working", 60_000)],
      shown,
    });
    expect(at("conductor-watched-since")?.textContent).toMatch(/^working 1m/);
    // A hidden pane is a RETAINED pane: the row is still mounted, so the only
    // thing between it and a re-render a second is this gate on the clock.
    setShown(false);
    clockSeam.advance?.(60_000);
    expect(at("conductor-watched-since")?.textContent).toMatch(/^working 1m/);
    // ... and the view coming back catches the clock up.
    setShown(true);
    expect(at("conductor-watched-since")?.textContent).toMatch(/^working 2m/);
  });

  it("puts a piece of work's terminals under its root's name, and two pieces side by side", () => {
    // The root's own words — the heading climbs the same ladder the rows do,
    // so what heads a group is what that terminal is CALLED and not a second
    // reading of the cell.
    setEachStanding({ [TERMINAL]: working({ intent: "fix-parser" }) });
    mount([
      piece(REF, "fix-parser", [REF, SPLIT_REF]),
      piece(OTHER_REF, "docs-pass", [OTHER_REF]),
    ]);
    const groups = all("conductor-watched-group");
    expect(groups.map((group) => group.dataset.root)).toEqual([REF, OTHER_REF]);
    // The head is the piece's name, and the planner's split sits under it —
    // two terminals, ONE piece of work.
    expect(
      groups[0]?.querySelector('[data-testid="conductor-watched-group-name"]')
        ?.textContent,
    ).toBe("fix-parser");
    expect(
      Array.from(
        groups[0]?.querySelectorAll('[data-testid="conductor-watched-row"]') ??
          [],
      ).map((row) => (row as HTMLElement).dataset.ref),
    ).toEqual([REF, SPLIT_REF]);
    expect(
      groups[1]?.querySelectorAll('[data-testid="conductor-watched-row"]')
        .length,
    ).toBe(1);
  });

  it("heads a piece nothing can be read off with the root's short id", () => {
    // Two terminals, so the heading is drawn at all — and no record to read a
    // name off, with no name from the server either. The last rung is eight
    // characters a person can compare, never the whole uuid.
    setStanding({ kind: "gone" });
    mount([piece(REF, "", [REF, SPLIT_REF])]);
    const head = at("conductor-watched-group-name");
    expect(head?.textContent).toBe(TERMINAL.slice(0, 8));
    expect(head?.textContent).not.toBe(TERMINAL);
  });

  it("heads a piece on an away host with the name the server last read", () => {
    // The grouping and its name survive a host leaving the fleet — that is
    // the one rung the server owns, and it sits above the short id.
    setStanding({ kind: "unreachable" });
    mount([piece(REF, "paths-kept-by", [REF, SPLIT_REF])], { seen: [] });
    expect(at("conductor-watched-group-name")?.textContent).toBe(
      "paths-kept-by",
    );
  });

  it("draws no heading over a lone terminal that the heading would only repeat", () => {
    // A group of one, named what its only row is named: the heading would say
    // the same word twice, so there is no heading.
    mount([piece(REF, "writing the plan", [REF])]);
    expect(at("conductor-watched-group")).toBeDefined();
    expect(at("conductor-watched-row")?.dataset.ref).toBe(REF);
    expect(at("conductor-watched-group-name")).toBeUndefined();
  });

  it("heads a lone terminal whose piece of work is called something else", () => {
    // Still one watched terminal, but the piece of work's top-level terminal
    // is another one — not watched itself — and it is called something this
    // row does not say.
    setEachStanding({ [OTHER_TERMINAL]: working({ intent: "docs-pass" }) });
    mount([piece(OTHER_REF, "", [REF])]);
    expect(at("conductor-watched-group-name")?.textContent).toBe("docs-pass");
  });

  it("still lists a terminal that is gone, and offers no Look at it", () => {
    setStanding({ kind: "gone" });
    mount([piece(REF, "fix-parser", [REF])]);
    expect(at("conductor-watched-row")).toBeDefined();
    expect(at("conductor-watched-look")).toBeUndefined();
    expect(at("conductor-look")?.dataset.standing).toBe("gone");
  });

  it("lists a ref it cannot resolve rather than dropping it", () => {
    mount([piece("nonsense", "", ["nonsense"])]);
    expect(at("conductor-watched-row")?.dataset.ref).toBe("nonsense");
    expect(at("conductor-watched-unresolved")).toBeDefined();
  });

  it("says it in ONE quiet line when there is no work at all — never a zero", () => {
    mount([], { placement: "side" });
    expect(at("conductor-watched-group")).toBeUndefined();
    expect(at("conductor-watched-row")).toBeUndefined();
    // The side column is on screen whether or not anything is being watched,
    // so the empty case is a sentence rather than a hole — and it says
    // nothing about counts, because `0 pieces of work` is the readout this
    // whole rule exists to delete.
    const empty = at("conductor-watched-empty");
    expect(empty?.textContent).toBe("Nothing in progress.");
    expect(root?.textContent).not.toContain("0");
  });

  it("draws the same rows in both placements", () => {
    // ONE COMPONENT, two places it is drawn: the band the status line opens
    // on a narrow window, and the always-on side column on a wide one. A
    // second implementation of this list is the thing the `placement` prop
    // exists to make unnecessary, so the rows must not differ by it.
    mount([piece(REF, "fix-parser", [REF])], { placement: "side" });
    expect(at("conductor-watched-panel")?.dataset.placement).toBe("side");
    expect(at("conductor-watched-row")?.dataset.ref).toBe(REF);
    expect(at("conductor-watched-look")).toBeDefined();
  });

  it("shows an agent's task progress beside its state, and nothing for an agent without one", () => {
    setEachStanding({
      [TERMINAL]: working({
        agent: untitled({
          summary: "writing the plan",
          taskProgress: { completed: 7, total: 12 },
        }),
      }),
      // The same agent, same state, keeping no task list of its own.
      [SPLIT_TERMINAL]: working(),
    });
    mount([piece(REF, "fix-parser", [REF, SPLIT_REF])]);
    const rows = all("conductor-watched-row");
    const progressIn = (row: HTMLElement | undefined) =>
      row?.querySelector('[data-testid="conductor-look-progress"]')
        ?.textContent;
    expect(progressIn(rows[0])).toBe("7/12");
    // Not a zero, not a dash: an agent that reports no task list says
    // nothing about one.
    expect(progressIn(rows[1])).toBeUndefined();
    expect(rows[1]?.textContent).not.toContain("/");
  });

  it("draws a split under the terminal it is a split of, named by what it is", () => {
    setEachStanding({
      [TERMINAL]: working({ intent: "paths-kept-by" }),
      // The implementor: a split with no intent and no title of its own —
      // the row the human saw drawn as a raw uuid, at the same level as its
      // planner.
      [SPLIT_TERMINAL]: working({
        parentId: TERMINAL,
        agent: untitled(),
      }),
    });
    mount([piece(REF, "paths-kept-by", [REF, SPLIT_REF])]);
    const rows = all("conductor-watched-row");
    // Parent first, split under it — one list, in tree order.
    expect(rows.map((row) => row.dataset.ref)).toEqual([REF, SPLIT_REF]);
    expect(rows[0]?.dataset.depth).toBe("0");
    expect(rows[0]?.dataset.parentRef).toBeUndefined();
    expect(rows[1]?.dataset.depth).toBe("1");
    expect(rows[1]?.dataset.parentRef).toBe(REF);
    const name = rows[1]?.querySelector<HTMLElement>(
      '[data-testid="conductor-watched-name"]',
    );
    expect(name?.textContent).toBe("Claude Code · split of paths-kept-by");
    expect(name?.textContent).not.toContain(SPLIT_TERMINAL);
  });

  it("flattens a group whose parent edge this browser cannot read", () => {
    // A host that is away keeps its grouping — the server's reading — but
    // there is no record here to read a `parentId` off, so the rows sit at
    // the top of the group rather than being nested on a guess.
    setStanding({ kind: "unreachable" });
    mount([piece(REF, "paths-kept-by", [REF, SPLIT_REF])], { seen: [] });
    expect(
      all("conductor-watched-row").map((row) => row.dataset.depth),
    ).toEqual(["0", "0"]);
  });
});
