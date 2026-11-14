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
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  FleetTerminalRow,
  FleetTerminalStanding,
} from "../palette/fleetTerminals";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;
const REF = `local/${TERMINAL}`;
const OTHER_TERMINAL = "22222222-2222-4222-8222-222222222222" as TerminalId;
const OTHER_REF = `local/${OTHER_TERMINAL}`;
const SPLIT_REF = "local/33333333-3333-4333-8333-333333333333";

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

const [standing, setStanding] = createSignal<FleetTerminalStanding>({
  kind: "gone",
});

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
  fleetTerminalStanding: () => standing(),
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

/** An active terminal whose agent is working, as the fleet reports it. */
const working = (): FleetTerminalStanding => ({
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    lastActivityAt: Date.now() - 4_000,
    agent: {
      kind: "claude-code",
      state: "thinking",
      summary: "writing the plan",
    },
  } as never,
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
    mount([piece(REF, TERMINAL, [REF])]);
    expect(at("conductor-watched-group-name")).toBeUndefined();
    expect(at("conductor-watched-group-since")?.textContent).toContain("1h");
  });

  it("takes you to the terminal when its name is pressed — the card's journey", () => {
    mount([piece(REF, "fix-parser", [REF])]);
    const name = at("conductor-watched-name");
    expect(name?.dataset.opensTile).toBe("true");
    // The accessible name says what pressing it DOES and still carries the
    // words on screen. The fleet index is stubbed empty here, so those words
    // are the terminal's own id — the same fallback every other row test
    // reads.
    expect(name?.getAttribute("aria-label")).toBe(`Go to ${TERMINAL}`);
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
    // press: there is no tile to land on.
    expect(name?.textContent).toBe(TERMINAL);
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

  it("heads a piece whose root the fleet cannot name with that terminal's id", () => {
    // Two terminals, so the heading is drawn at all — and the root is not one
    // the fleet index can name, which is the fallback under test.
    mount([piece(REF, "", [REF, SPLIT_REF])]);
    expect(at("conductor-watched-group-name")?.textContent).toBe(TERMINAL);
  });

  it("draws no heading over a lone terminal that the heading would only repeat", () => {
    // A group of one, named what its only row is named: the heading would say
    // the same word twice, so there is no heading.
    mount([piece(REF, TERMINAL, [REF])]);
    expect(at("conductor-watched-group")).toBeDefined();
    expect(at("conductor-watched-row")?.dataset.ref).toBe(REF);
    expect(at("conductor-watched-group-name")).toBeUndefined();
  });

  it("heads a lone terminal whose piece of work is called something else", () => {
    // Still one terminal, but the work has a name of its own — that name is
    // not in the row, so it is worth a heading.
    mount([piece(REF, "fix-parser", [REF])]);
    expect(at("conductor-watched-group-name")?.textContent).toBe("fix-parser");
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
});
