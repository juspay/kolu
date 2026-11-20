import { describe, expect, it } from "vitest";
import {
  foldPorts,
  foldBinds,
  PORT_COMMAND_MAX_CHARS,
  type PortFamily,
  type PortInfo,
  PortInfoSchema,
  portCommand,
  type PortScope,
  preferredFamily,
  samePortList,
  widerScope,
} from "./ports.ts";

const p = (
  port: number,
  scope: PortScope = "any",
  name = "node",
  family: PortFamily = "v4",
): PortInfo => ({
  port,
  name,
  command: name,
  scope,
  family,
});

describe("widerScope", () => {
  it("ranks any > loopback > interface, in either argument order", () => {
    const scopes: PortScope[] = ["any", "interface", "loopback"];
    for (const a of scopes) {
      for (const b of scopes) {
        expect(widerScope(a, b)).toBe(widerScope(b, a));
      }
    }
    expect(widerScope("interface", "any")).toBe("any");
    expect(widerScope("loopback", "any")).toBe("any");
    expect(widerScope("loopback", "loopback")).toBe("loopback");
  });

  it("prefers a LOOPBACK bind over an interface one — it is the one kolu can open", () => {
    expect(widerScope("loopback", "interface")).toBe("loopback");
  });
});

describe("foldPorts — scope and family are folded TOGETHER", () => {
  it("takes the family from the bind whose scope WON, not from the other one", () => {
    expect(
      foldPorts([
        p(5173, "interface", "node", "v4"),
        p(5173, "loopback", "node", "v6"),
      ]),
    ).toEqual([p(5173, "loopback", "node", "v6")]);
    expect(
      foldPorts([
        p(5173, "loopback", "node", "v6"),
        p(5173, "interface", "node", "v4"),
      ]),
    ).toEqual([p(5173, "loopback", "node", "v6")]);
  });

  it("still prefers v4 when BOTH binds are the winning scope", () => {
    expect(
      foldPorts([
        p(5173, "loopback", "node", "v6"),
        p(5173, "loopback", "node", "v4"),
      ]),
    ).toEqual([p(5173, "loopback", "node", "v4")]);
  });
});

describe("preferredFamily", () => {
  it("prefers v4 when a port is bound on both, in either order", () => {
    expect(preferredFamily("v4", "v6")).toBe("v4");
    expect(preferredFamily("v6", "v4")).toBe("v4");
    expect(preferredFamily("v4", "v4")).toBe("v4");
  });

  it("keeps v6 when that is the only family bound", () => {
    expect(preferredFamily("v6", "v6")).toBe("v6");
  });
});

describe("foldPorts", () => {
  it("collapses a fork-inherited socket seen on several pids", () => {
    expect(foldPorts([p(3000), p(3000), p(3000)])).toEqual([p(3000)]);
  });

  it("folds a port to its WIDEST bind", () => {
    expect(foldPorts([p(5173, "loopback"), p(5173, "any")])).toEqual([
      p(5173, "any"),
    ]);
    expect(foldPorts([p(5173, "any"), p(5173, "loopback")])).toEqual([
      p(5173, "any"),
    ]);
    expect(foldPorts([p(4000, "loopback"), p(4000, "interface")])).toEqual([
      p(4000, "loopback"),
    ]);
    expect(foldPorts([p(4000, "interface"), p(4000, "any")])).toEqual([
      p(4000, "any"),
    ]);
  });

  it("keeps a port whose every bind is loopback as needing a forward", () => {
    expect(
      foldPorts([
        p(5432, "loopback", "postgres"),
        p(5432, "loopback", "postgres"),
      ]),
    ).toEqual([p(5432, "loopback", "postgres")]);
  });

  it("sorts by port, so an unchanged host produces an identical sample", () => {
    expect(
      foldPorts([p(9229), p(3000), p(61922, "any", "workerd")]).map(
        (x) => x.port,
      ),
    ).toEqual([3000, 9229, 61922]);
  });

  it("does not mutate its input", () => {
    const rows = [p(80, "loopback"), p(80, "any")];
    foldPorts(rows);
    expect(rows[0]).toEqual(p(80, "loopback"));
  });

  it("folds a TILE's panes as readily as one subtree's sockets", () => {
    const main = [p(3000, "loopback")];
    const split = [p(5173, "any"), p(3000, "any")];
    expect(foldPorts([...main, ...split])).toEqual([
      p(3000, "any"),
      p(5173, "any"),
    ]);
  });

  it("is empty for no sockets", () => {
    expect(foldPorts([])).toEqual([]);
  });

  it("folds the same SET to the same row whatever order it was observed in", () => {
    const rows = [p(8080, "loopback", "python"), p(8080, "loopback", "node")];
    expect(samePortList(foldPorts(rows), foldPorts([...rows].reverse()))).toBe(
      true,
    );
    expect(foldPorts(rows)).toEqual([p(8080, "loopback", "node")]);
  });
});

describe("samePortList", () => {
  it("accepts an unchanged list, so an idle scan emits nothing", () => {
    expect(samePortList([p(8080), p(9229)], [p(8080), p(9229)])).toBe(true);
    expect(samePortList([], [])).toBe(true);
  });

  it("notices a port appearing or dying", () => {
    expect(samePortList([p(8080)], [p(8080), p(9229)])).toBe(false);
    expect(samePortList([p(8080)], [])).toBe(false);
  });

  it("notices a BIND change on the same port", () => {
    expect(samePortList([p(5173, "loopback")], [p(5173, "any")])).toBe(false);
  });

  it("notices a NAME change on the same port", () => {
    expect(samePortList([p(3000)], [p(3000, "any", "workerd")])).toBe(false);
  });

  it("compares EVERY schema field, not a hand-listed subset", () => {
    const differing: Array<[PortInfo, PortInfo]> = [
      [p(1000), { ...p(1000), port: 1001 }],
      [p(1000), { ...p(1000), name: "other" }],
      [p(1000), { ...p(1000), command: "node other.js" }],
      [p(1000), { ...p(1000), scope: "loopback" }],
      [p(1000), { ...p(1000), family: "v6" }],
    ];
    expect(differing).toHaveLength(Object.keys(PortInfoSchema.fields).length);
    for (const [a, b] of differing) {
      expect(samePortList([a], [b])).toBe(false);
    }
  });
});

describe("foldPorts — the owner pair", () => {
  it("takes name AND command from the same row, never one from each", () => {
    const vite: PortInfo = { ...p(5173), name: "node", command: "node vite" };
    const other: PortInfo = { ...p(5173), name: "bun", command: "zzz serve" };
    for (const rows of [
      [vite, other],
      [other, vite],
    ]) {
      const [folded] = foldPorts(rows);
      expect(folded?.name).toBe("bun");
      expect(folded?.command).toBe("zzz serve");
    }
  });

  it("breaks a name tie by command, so the result is a function of the set", () => {
    const a: PortInfo = { ...p(8080), command: "node a.js" };
    const b: PortInfo = { ...p(8080), command: "node b.js" };
    expect(foldPorts([b, a])).toEqual(foldPorts([a, b]));
    expect(foldPorts([b, a])[0]?.command).toBe("node a.js");
  });
});

describe("foldBinds", () => {
  it("collapses binds per port with the same scope and family rule", () => {
    expect(
      foldBinds([
        { port: 631, scope: "loopback", family: "v6" },
        { port: 22, scope: "any", family: "v6" },
        { port: 631, scope: "loopback", family: "v4" },
        { port: 22, scope: "any", family: "v4" },
      ]),
    ).toEqual([
      { port: 22, scope: "any", family: "v4" },
      { port: 631, scope: "loopback", family: "v4" },
    ]);
  });
});

describe("portCommand", () => {
  it("joins argv with spaces", () => {
    expect(portCommand(["odu", "web-daemon"], "bun")).toBe("odu web-daemon");
  });

  it("names an argv-less process by its name", () => {
    expect(portCommand([], "kworker")).toBe("kworker");
  });

  it("cuts a long command at the bound, marking the cut", () => {
    const script = ["node", "-e", "x".repeat(PORT_COMMAND_MAX_CHARS * 2)];
    const command = portCommand(script, "node");
    expect(command).toHaveLength(PORT_COMMAND_MAX_CHARS);
    expect(command.endsWith("…")).toBe(true);
    expect(command.startsWith("node -e xxx")).toBe(true);
  });
});
