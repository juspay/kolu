import type {
  HostListeners,
  KoluForward,
  PortInfo,
  PortBind,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  bindOf,
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
  inTerminal: readonly number[] = [],
): HostListeners => ({
  status: "known",
  claimed: claimed.map((c) => ({
    ...c,
    heldByTerminal: inTerminal.includes(c.port),
  })),
  unclaimed: { status: "known", list: unclaimed },
});

const none = new Set<number>();

function groups(
  opts: Partial<
    Omit<Parameters<typeof portGroups>[0], "terminals"> & TerminalsView
  >,
) {
  const {
    tilePorts = [],
    printedHere = none,
    printedOnHost = none,
    ...rest
  } = opts;
  return portGroups({
    terminals: { tilePorts, printedHere, printedOnHost },
    host: { status: "unknown" },
    forwards: [],
    doorPorts: none,
    ...rest,
  });
}

const shape = (rows: ReturnType<typeof portGroups>["here"]) =>
  rows.map((r) => [r.kind, r.port, r.kind === "orphan" ? null : r.origin]);

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
    expect(g.elsewhere).toEqual([]);
  });

  it("claims a DETACHED server whose URL this tile printed", () => {
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
    expect(
      groups({ host: hostOf([]), printedHere: new Set([3000]) }).here,
    ).toEqual([]);
  });

  it("leaves a printed server another terminal runs with THAT terminal", () => {
    const g = groups({
      host: hostOf([port(5173)], [], [5173]),
      printedHere: new Set([5173]),
    });
    expect(g.here).toEqual([]);
    expect(shape(g.elsewhere)).toEqual([["port", 5173, "host"]]);
  });

  it("claims a printed server even while some OTHER terminal is unscanned", () => {
    const g = groups({
      host: hostOf([port(18440, "bun odu web-daemon")]),
      printedHere: new Set([18440]),
    });
    expect(shape(g.here)).toEqual([["port", 18440, "printed"]]);
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
    const g = groups({
      host: hostOf(
        [{ ...port(5173), scope: "interface" }],
        [{ port: 5173, scope: "loopback", family: "v6" }],
      ),
    });
    expect(shape(g.elsewhere)).toEqual([["unclaimed", 5173, "host"]]);
  });

  it("leaves out kolu's own relay listeners", () => {
    const g = groups({
      host: hostOf([port(5173), port(61000, "node kolu-server")]),
      forwards: [forward(5173, 61000)],
      doorPorts: new Set([61000]),
    });
    expect(shape(g.elsewhere)).toEqual([["port", 5173, "host"]]);
  });

  it("keeps a door with nothing behind it — as a trailing orphan", () => {
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
