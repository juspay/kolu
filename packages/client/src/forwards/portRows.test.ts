/**
 * What the ports section shows — two groups, "from this terminal" and
 * "elsewhere on this host", each port in exactly one of them, each carrying its
 * door inline.
 *
 * The one-row-per-port rule is older than the groups and stays: a forwarded
 * port once rendered as a chip in one group AND a row in another, and two
 * renderings of one fact invite the reader to hunt for the difference. What the
 * groups add is the host: a server that detached from the terminal that started
 * it is still that terminal's when the terminal printed its URL, and every other
 * listener with a story is listed below.
 */

import type {
  HostListeners,
  KoluForward,
  PortInfo,
  PortBind,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  bindOf,
  heldByNoTerminal,
  listenerLabel,
  portGroups,
  rowGroup,
  type TerminalsView,
} from "./portRows";

const LOCAL = { kind: "local" as const };

const port = (p: number, command = "node vite"): PortInfo => ({
  port: p,
  name: command.split(" ")[0] ?? command,
  command,
  scope: "loopback",
  family: "v4",
});

const bind = (p: number): PortBind => ({
  port: p,
  scope: "loopback",
  family: "v4",
});

const forward = (
  remotePort: number,
  localPort: number,
  origin: "auto" | "manual" = "auto",
): KoluForward => ({
  key: `k:${remotePort}`,
  host: LOCAL,
  remotePort,
  localPort,
  origin,
  createdAt: 0,
});

const hostOf = (
  claimed: PortInfo[],
  unclaimed: PortBind[] = [],
): HostListeners => ({
  status: "known",
  claimed,
  unclaimed: { status: "known", list: unclaimed },
});

const none = new Set<number>();

/** The join with every input at its empty default, overridden per case. */
function groups(
  opts: Partial<
    Omit<Parameters<typeof portGroups>[0], "terminals"> & TerminalsView
  >,
) {
  const {
    tilePorts = [],
    printedHere = none,
    printedOnHost = none,
    heldPorts = none,
    ...rest
  } = opts;
  return portGroups({
    terminals: { tilePorts, printedHere, printedOnHost, heldPorts },
    host: { status: "unknown" },
    forwards: [],
    doorPorts: none,
    ...rest,
  });
}

const shape = (rows: ReturnType<typeof portGroups>["here"]) =>
  rows.map((r) => [r.kind, r.port, r.kind === "orphan" ? null : r.origin]);

describe("heldByNoTerminal — what detached rests on", () => {
  it("is true only on a positive reading that holds no such port", () => {
    expect(heldByNoTerminal(new Set([5173]), 18440)).toBe(true);
    expect(heldByNoTerminal(new Set([18440]), 18440)).toBe(false);
  });

  it("is never true while a terminal is unscanned — unknown is not no", () => {
    expect(heldByNoTerminal("unknown", 18440)).toBe(false);
  });
});

describe("bindOf / listenerLabel — one reading of either listener arm", () => {
  it("reads the bind off a claimed listener and an unclaimed one alike", () => {
    expect(bindOf({ info: port(5173) })).toMatchObject(bind(5173));
    expect(bindOf({ bind: bind(631) })).toEqual(bind(631));
  });

  it("names a claimed owner by its command, an unclaimed one honestly", () => {
    expect(listenerLabel({ info: port(18440, "bun odu web-daemon") })).toBe(
      "bun odu web-daemon",
    );
    expect(listenerLabel({ bind: bind(631) })).toBe("owner not visible");
  });
});

describe("from this terminal", () => {
  it("renders a subtree port ONCE, carrying its forward inline", () => {
    const vite = port(5173);
    const g = groups({
      tilePorts: [vite],
      host: hostOf([vite]),
      forwards: [forward(5173, 61000)],
    });
    expect(shape(g.here)).toEqual([["port", 5173, "subtree"]]);
    expect(g.here[0]).toMatchObject({
      forward: expect.objectContaining({ localPort: 61000 }),
    });
    // …and not again below, though the host reading holds it too.
    expect(g.elsewhere).toEqual([]);
  });

  it("claims a DETACHED server whose URL this tile printed", () => {
    // The headline: `odu web-daemon` reparented to init, so no subtree holds
    // 18440 — but this tile printed its URL and the host positively holds it.
    const daemon = port(18440, "bun odu web-daemon");
    const g = groups({
      host: hostOf([daemon]),
      printedHere: new Set([18440]),
      printedOnHost: new Set([18440]),
    });
    expect(shape(g.here)).toEqual([["port", 18440, "printed"]]);
    expect(g.here[0]).toMatchObject({ info: daemon });
    expect(g.elsewhere).toEqual([]);
  });

  it("claims a printed server whose owner is not visible, as an unclaimed row", () => {
    const g = groups({
      host: hostOf([], [bind(8443)]),
      printedHere: new Set([8443]),
    });
    expect(shape(g.here)).toEqual([["unclaimed", 8443, "printed"]]);
  });

  it("makes NO row from a printed URL the host does not hold", () => {
    // A printed URL is an entry point, never a fact. "Nothing is listening"
    // belongs on the printed-URL card, not as a chip made from text.
    expect(
      groups({ host: hostOf([]), printedHere: new Set([3000]) }).here,
    ).toEqual([]);
  });

  it("leaves a printed server another terminal runs with THAT terminal", () => {
    // An agent echoing another tile's vite URL does not make this tile its home.
    const g = groups({
      host: hostOf([port(5173)]),
      printedHere: new Set([5173]),
      heldPorts: new Set([5173]),
    });
    expect(g.here).toEqual([]);
    expect(shape(g.elsewhere)).toEqual([["port", 5173, "host"]]);
  });

  it("does not claim a printed server while a terminal is unscanned", () => {
    // "No terminal holds it" is what detached MEANS; an unscanned pane might.
    const g = groups({
      host: hostOf([port(18440, "bun odu web-daemon")]),
      printedHere: new Set([18440]),
      heldPorts: "unknown",
    });
    expect(g.here).toEqual([]);
    expect(shape(g.elsewhere)).toEqual([["port", 18440, "host"]]);
  });

  it("makes no row from a print while the host is unknown", () => {
    expect(groups({ printedHere: new Set([3000]) }).here).toEqual([]);
  });

  it("orders subtree and printed rows together, by port", () => {
    const g = groups({
      tilePorts: [port(5173)],
      host: hostOf([port(3000, "bun serve"), port(5173)]),
      printedHere: new Set([3000]),
    });
    expect(shape(g.here)).toEqual([
      ["port", 3000, "printed"],
      ["port", 5173, "subtree"],
    ]);
  });
});

describe("rowGroup — the group a row is filed in", () => {
  it("agrees with the array portGroups put every row in", () => {
    const g = groups({
      tilePorts: [port(5173)],
      host: hostOf(
        [port(5173), port(3000, "bun serve"), port(8734)],
        [bind(8443)],
      ),
      printedHere: new Set([3000, 8443]),
      forwards: [forward(9229, 61000, "manual")],
    });
    expect(g.here.length).toBeGreaterThan(0);
    expect(g.elsewhere.length).toBeGreaterThan(0);
    for (const row of g.here) expect(rowGroup(row)).toBe("here");
    for (const row of g.elsewhere) expect(rowGroup(row)).toBe("elsewhere");
  });
});

describe("elsewhere on this host", () => {
  it("lists every listener a readable program holds that is not this tile's", () => {
    const g = groups({
      tilePorts: [port(5173)],
      host: hostOf([port(5173), port(8734, "node serve -l 8734"), port(22)]),
    });
    expect(shape(g.elsewhere)).toEqual([
      ["port", 22, "host"],
      ["port", 8734, "host"],
    ]);
  });

  it("hides another user's socket unless a terminal printed it or a door points at it", () => {
    // A system daemon on 631 has no story here; one a terminal printed does, and
    // so does one kolu already opened a door onto.
    const g = groups({
      host: hostOf([], [bind(631), bind(8443), bind(5432)]),
      printedOnHost: new Set([8443]),
      forwards: [forward(5432, 61001, "manual")],
    });
    expect(shape(g.elsewhere)).toEqual([
      ["unclaimed", 5432, "host"],
      ["unclaimed", 8443, "host"],
    ]);
    expect(g.elsewhere[0]).toMatchObject({
      forward: expect.objectContaining({ origin: "manual" }),
    });
  });

  it("shows a port by the bind a door can use when both halves hold it", () => {
    // Our interface-only 5173 and another user's loopback 5173: the row carries
    // the loopback bind (reachable through a door) and does not borrow our
    // program's command — matching the printed-URL card's answer.
    const g = groups({
      host: hostOf(
        [{ ...port(5173), scope: "interface" }],
        [{ port: 5173, scope: "loopback", family: "v6" }],
      ),
    });
    expect(shape(g.elsewhere)).toEqual([["unclaimed", 5173, "host"]]);
  });

  it("leaves out kolu's own relay listeners", () => {
    // A door is shown as the row it serves. Its local listener as a second row
    // is the double rendering the one-row rule removed.
    const g = groups({
      host: hostOf([port(5173), port(61000, "node kolu-server")]),
      forwards: [forward(5173, 61000)],
      doorPorts: new Set([61000]),
    });
    expect(shape(g.elsewhere)).toEqual([["port", 5173, "host"]]);
  });

  it("keeps a door with nothing behind it — as a trailing orphan", () => {
    // A ⌘K manual forward, or one whose listener died before the reap. Dropping
    // it would leave an open door with nothing anywhere to cancel it from.
    const g = groups({
      host: hostOf([port(3000)]),
      forwards: [forward(9229, 61000, "manual")],
    });
    expect(shape(g.elsewhere)).toEqual([
      ["port", 3000, "host"],
      ["orphan", 9229, null],
    ]);
  });

  it("keeps doors as orphans while the host is unknown", () => {
    const g = groups({
      tilePorts: [port(8080)],
      forwards: [forward(80, 61000, "manual"), forward(8080, 8080)],
    });
    expect(shape(g.here)).toEqual([["port", 8080, "subtree"]]);
    expect(shape(g.elsewhere)).toEqual([["orphan", 80, null]]);
  });

  it("sorts orphans by port, so the trailing rows are stable", () => {
    const g = groups({
      forwards: [forward(9229, 1), forward(80, 2), forward(3000, 3)],
    });
    expect(g.elsewhere.map((r) => r.port)).toEqual([80, 3000, 9229]);
  });

  it("is empty when there is nothing to say", () => {
    expect(groups({ host: hostOf([]) })).toEqual({ here: [], elsewhere: [] });
  });
});
