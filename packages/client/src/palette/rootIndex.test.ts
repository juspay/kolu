import { describe, expect, it } from "vitest";
import {
  type CurrentSelection,
  defaultSelectionIndex,
  filterAndRankPaletteItems,
  type IndexableItem,
  kindRank,
  RECENT_TERMINAL_LIMIT,
  searchCorpus,
} from "./rootIndex";

function item(
  name: string,
  kind: "terminal" | "host" | "command",
  extras: Partial<IndexableItem> & {
    recencyAt?: number;
    visitedAt?: number;
    searchText?: string;
    sectionOrder?: number;
    hostKey?: string;
    terminalId?: string;
  } = {},
): IndexableItem {
  const {
    recencyAt,
    visitedAt,
    searchText,
    sectionOrder,
    description,
    hostKey,
    terminalId,
    ...rest
  } = extras;
  return {
    name,
    description,
    sectionOrder,
    row: {
      kind,
      recencyAt,
      visitedAt,
      searchText,
      hostKey,
      terminalId,
    },
    ...rest,
  };
}

describe("kindRank", () => {
  it("orders terminals above hosts above commands", () => {
    expect(kindRank("terminal")).toBeLessThan(kindRank("host"));
    expect(kindRank("host")).toBeLessThan(kindRank("command"));
  });
});

describe("searchCorpus", () => {
  it("prefers multi-field searchText over name/description", () => {
    expect(
      searchCorpus(
        item("watch-edge", "terminal", {
          description: "intent",
          searchText: "kolu watch-edge debounce",
        }),
      ),
    ).toBe("kolu watch-edge debounce");
  });

  it("falls back to name + description for bare commands", () => {
    expect(
      searchCorpus({ name: "New terminal", description: "pick a repo" }),
    ).toBe("New terminal pick a repo");
  });
});

describe("filterAndRankPaletteItems", () => {
  const catalog: IndexableItem[] = [
    item("old-ws", "terminal", { recencyAt: 100, searchText: "kolu old-ws" }),
    item("fresh-ws", "terminal", {
      recencyAt: 500,
      searchText: "kolu fresh-ws edge",
    }),
    item("mid-ws", "terminal", {
      recencyAt: 300,
      searchText: "drishti master",
    }),
    item("extra-ws", "terminal", {
      recencyAt: 50,
      searchText: "odu venue",
    }),
    item("gpu-box", "host", { searchText: "dev@gpu-box degraded" }),
    item("local", "host", { searchText: "local connected active" }),
    item("New terminal", "command", { sectionOrder: 0 }),
    item("Toggle dock", "command", {
      sectionOrder: 2,
      description: "show or hide",
    }),
    item("Set theme", "command", { sectionOrder: 1 }),
  ];

  it("empty root: recent cap, hosts, then section-ordered commands", () => {
    const out = filterAndRankPaletteItems(catalog, {
      query: "",
      atRoot: true,
    });
    const names = out.map((i) => i.name);
    expect(names.slice(0, RECENT_TERMINAL_LIMIT)).toEqual([
      "fresh-ws",
      "mid-ws",
      "old-ws",
    ]);
    expect(names).not.toContain("extra-ws");
    expect(
      names.slice(RECENT_TERMINAL_LIMIT, RECENT_TERMINAL_LIMIT + 2),
    ).toEqual(["gpu-box", "local"]);
    expect(names.slice(RECENT_TERMINAL_LIMIT + 2)).toEqual([
      "New terminal",
      "Set theme",
      "Toggle dock",
    ]);
  });

  it("empty-root Recent excludes the canvas-active terminal", () => {
    const withIds: IndexableItem[] = [
      item("fresh-ws", "terminal", {
        recencyAt: 500,
        hostKey: "local",
        terminalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
      item("mid-ws", "terminal", {
        recencyAt: 300,
        hostKey: "local",
        terminalId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
      item("old-ws", "terminal", {
        recencyAt: 100,
        hostKey: "local",
        terminalId: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
      item("local", "host", { searchText: "local" }),
    ];
    const out = filterAndRankPaletteItems(withIds, {
      query: "",
      atRoot: true,
      current: {
        hostKey: "local",
        terminalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      },
    });
    const names = out
      .filter((i) => i.row?.kind === "terminal")
      .map((i) => i.name);
    expect(names).toEqual(["mid-ws", "old-ws"]);
    expect(names[0]).toBe("mid-ws");
  });

  it("queried root still includes the active terminal", () => {
    const withIds: IndexableItem[] = [
      item("fresh-ws", "terminal", {
        recencyAt: 500,
        searchText: "fresh edge",
        hostKey: "local",
        terminalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
      item("mid-ws", "terminal", {
        recencyAt: 300,
        searchText: "mid other",
        hostKey: "local",
        terminalId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
    ];
    const out = filterAndRankPaletteItems(withIds, {
      query: "edge",
      atRoot: true,
      current: {
        hostKey: "local",
        terminalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      },
    });
    expect(out.map((i) => i.name)).toEqual(["fresh-ws"]);
  });

  it("queried root: AND-token match + kind rank + workspace recency", () => {
    const out = filterAndRankPaletteItems(catalog, {
      query: "edge",
      atRoot: true,
    });
    expect(out.map((i) => i.name)).toEqual(["fresh-ws"]);
  });

  it("queried root ranks workspace hits above host hits above commands", () => {
    const mixed: IndexableItem[] = [
      item("Toggle dock", "command", {
        sectionOrder: 0,
        searchText: "toggle dock panel",
      }),
      item("builder", "host", { searchText: "srid@builder connected" }),
      item("ws-a", "terminal", {
        recencyAt: 10,
        searchText: "kolu builder branch",
      }),
      item("ws-b", "terminal", {
        recencyAt: 99,
        searchText: "odu builder venue",
      }),
    ];
    const out = filterAndRankPaletteItems(mixed, {
      query: "builder",
      atRoot: true,
    });
    expect(out.map((i) => i.name)).toEqual(["ws-b", "ws-a", "builder"]);
  });

  it("AND-token requires every token", () => {
    const out = filterAndRankPaletteItems(catalog, {
      query: "kolu missing",
      atRoot: true,
    });
    expect(out).toEqual([]);
  });

  it("drill-in preserves registration order (no kind re-rank)", () => {
    const cmds: IndexableItem[] = [
      item("b-cmd", "command", { sectionOrder: 1 }),
      item("a-cmd", "command", { sectionOrder: 0 }),
    ];
    const out = filterAndRankPaletteItems(cmds, {
      query: "",
      atRoot: false,
    });
    expect(out.map((i) => i.name)).toEqual(["b-cmd", "a-cmd"]);
  });

  it("drill-in still filters by tokens", () => {
    const cmds: IndexableItem[] = [
      { name: "Set theme", description: "colors" },
      { name: "New terminal", description: "spawn" },
    ];
    const out = filterAndRankPaletteItems(cmds, {
      query: "theme",
      atRoot: false,
    });
    expect(out.map((i) => i.name)).toEqual(["Set theme"]);
  });
});

describe("defaultSelectionIndex", () => {
  const TID_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const TID_B = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const onLocalTerminal = (terminalId: string): CurrentSelection => ({
    hostKey: "local",
    terminalId,
  });
  const onHost = (hostKey: string): CurrentSelection => ({
    hostKey,
    terminalId: null,
  });

  it("lands on the first row of a plain, rankless command list", () => {
    const cmds: IndexableItem[] = [
      { name: "New terminal" },
      { name: "Set theme" },
    ];
    expect(defaultSelectionIndex(cmds, onHost("local"), "")).toBe(0);
  });

  it("returns 0 for an empty list", () => {
    expect(defaultSelectionIndex([], onHost("local"), "")).toBe(0);
  });

  it("lands on the top match whenever a query is typed", () => {
    const rows: IndexableItem[] = [
      item("gpu-box", "host", { visitedAt: 10, hostKey: "remote:gpu-box" }),
      item("builder", "host", { visitedAt: 900, hostKey: "remote:builder" }),
    ];
    expect(defaultSelectionIndex(rows, onHost("local"), "b")).toBe(0);
    expect(defaultSelectionIndex(rows, onHost("local"), "  ")).toBe(1);
  });

  it("keeps ⌘K's root list on its first (most recent) terminal row", () => {
    const rows: IndexableItem[] = [
      item("prev-visit", "terminal", {
        visitedAt: 500,
        hostKey: "local",
        terminalId: TID_A,
      }),
      item("older", "terminal", {
        visitedAt: 300,
        hostKey: "local",
        terminalId: TID_B,
      }),
      item("local", "host", { visitedAt: 2, hostKey: "local" }),
      item("Toggle dock", "command"),
    ];
    expect(
      defaultSelectionIndex(
        rows,
        onLocalTerminal("cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
        "",
      ),
    ).toBe(0);
  });

  it("a chatty terminal you have never visited does not steal the highlight", () => {
    const rows: IndexableItem[] = [
      item("active", "terminal", {
        recencyAt: 500,
        visitedAt: 500,
        hostKey: "local",
        terminalId: TID_A,
      }),
      item("chatty-stranger", "terminal", {
        recencyAt: 9_000_000,
        visitedAt: 0,
        hostKey: "local",
        terminalId: TID_B,
      }),
      item("came-from", "terminal", {
        recencyAt: 400,
        visitedAt: 400,
        hostKey: "local",
        terminalId: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
    ];
    const idx = defaultSelectionIndex(rows, onLocalTerminal(TID_A), "");
    expect(rows[idx]?.name).toBe("came-from");
  });

  it("the Recent cap cannot evict the row ⌘K → Enter is meant to reach", () => {
    const rows: IndexableItem[] = [
      item("active", "terminal", {
        recencyAt: 500,
        visitedAt: 500,
        hostKey: "local",
        terminalId: TID_A,
      }),
      item("came-from", "terminal", {
        recencyAt: 400,
        visitedAt: 400,
        hostKey: "local",
        terminalId: TID_B,
      }),
      ...[1, 2, 3].map((n) =>
        item(`chatty-${n}`, "terminal", {
          recencyAt: 9_000_000 + n,
          visitedAt: 0,
          hostKey: "local",
          terminalId: `dddddddd-bbbb-4ccc-8ddd-00000000000${n}`,
        }),
      ),
    ];
    const ranked = filterAndRankPaletteItems(rows, {
      query: "",
      atRoot: true,
      current: onLocalTerminal(TID_A),
    });
    const names = ranked.map((i) => i.name);
    expect(names).toHaveLength(RECENT_TERMINAL_LIMIT);
    expect(names).toContain("came-from");
    expect(names).not.toContain("active");
    const idx = defaultSelectionIndex(ranked, onLocalTerminal(TID_A), "");
    expect(ranked[idx]?.name).toBe("came-from");
  });

  it("reserves nothing when no candidate has a visit behind it", () => {
    const rows: IndexableItem[] = [1, 2, 3, 4].map((n) =>
      item(`fresh-${n}`, "terminal", {
        recencyAt: n * 100,
        visitedAt: 0,
        hostKey: "local",
        terminalId: `eeeeeeee-bbbb-4ccc-8ddd-00000000000${n}`,
      }),
    );
    const ranked = filterAndRankPaletteItems(rows, {
      query: "",
      atRoot: true,
      current: { hostKey: "local", terminalId: null },
    });
    expect(ranked.map((i) => i.name)).toEqual([
      "fresh-4",
      "fresh-3",
      "fresh-2",
    ]);
  });

  it("the reserved seat is never spent on the row the highlight must skip", () => {
    const rows: IndexableItem[] = [
      item("active", "terminal", {
        recencyAt: 0,
        visitedAt: 900,
        hostKey: "local",
        terminalId: TID_A,
      }),
      item("came-from", "terminal", {
        recencyAt: 0,
        visitedAt: 400,
        hostKey: "local",
        terminalId: TID_B,
      }),
      ...[1, 2, 3].map((n) =>
        item(`chatty-${n}`, "terminal", {
          recencyAt: 9_000_000 + n,
          visitedAt: 0,
          hostKey: "local",
          terminalId: `ffffffff-bbbb-4ccc-8ddd-00000000000${n}`,
        }),
      ),
    ];
    const ranked = filterAndRankPaletteItems(rows, {
      query: "",
      atRoot: true,
      current: onLocalTerminal(TID_A),
    });
    expect(ranked).toHaveLength(RECENT_TERMINAL_LIMIT);
    expect(ranked.map((i) => i.name)).toContain("came-from");
    const idx = defaultSelectionIndex(ranked, onLocalTerminal(TID_A), "");
    expect(ranked[idx]?.name).toBe("came-from");
  });

  it("skips the active terminal in a list that still contains it", () => {
    const rows: IndexableItem[] = [
      item("active", "terminal", {
        visitedAt: 900,
        hostKey: "local",
        terminalId: TID_A,
      }),
      item("stale", "terminal", {
        visitedAt: 100,
        hostKey: "local",
        terminalId: TID_B,
      }),
      item("prev-visit", "terminal", {
        visitedAt: 700,
        hostKey: "local",
        terminalId: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
    ];
    expect(defaultSelectionIndex(rows, onLocalTerminal(TID_A), "")).toBe(2);
  });

  it("lands on the previously-visited host, not the first or the active one", () => {
    const hosts: IndexableItem[] = [
      item("local", "host", { visitedAt: 1, hostKey: "local" }),
      item("gpu-box", "host", { visitedAt: 3, hostKey: "remote:gpu-box" }),
      item("builder", "host", { visitedAt: 2, hostKey: "remote:builder" }),
    ];
    expect(defaultSelectionIndex(hosts, onHost("remote:gpu-box"), "")).toBe(2);
  });

  it("falls back to the first host when the trail has never seen the others", () => {
    const hosts: IndexableItem[] = [
      item("local", "host", { visitedAt: 1, hostKey: "local" }),
      item("gpu-box", "host", { visitedAt: 0, hostKey: "remote:gpu-box" }),
      item("builder", "host", { visitedAt: 0, hostKey: "remote:builder" }),
    ];
    expect(defaultSelectionIndex(hosts, onHost("local"), "")).toBe(1);
  });

  it("keeps the highlight on the sole row when every other row is the current one", () => {
    const hosts: IndexableItem[] = [
      item("local", "host", { visitedAt: 5, hostKey: "local" }),
    ];
    expect(defaultSelectionIndex(hosts, onHost("local"), "")).toBe(0);
  });

  it("falls through to the previous HOST at root when Recent is empty", () => {
    const rows: IndexableItem[] = [
      item("local", "host", { visitedAt: 3, hostKey: "local" }),
      item("gpu-box", "host", { visitedAt: 1, hostKey: "remote:gpu-box" }),
      item("builder", "host", { visitedAt: 2, hostKey: "remote:builder" }),
      item("Toggle dock", "command"),
    ];
    expect(defaultSelectionIndex(rows, onHost("local"), "")).toBe(2);
  });

  it("keeps a terminal-led list's highlight on a terminal row", () => {
    const rows: IndexableItem[] = [
      item("prev-visit", "terminal", {
        visitedAt: 5,
        hostKey: "local",
        terminalId: TID_A,
      }),
      item("gpu-box", "host", {
        visitedAt: 999_999,
        hostKey: "remote:gpu-box",
      }),
    ];
    const idx = defaultSelectionIndex(rows, onLocalTerminal(TID_B), "");
    expect(idx).toBe(0);
    expect(rows[idx]?.row?.kind).toBe("terminal");
  });

  it("takes its leading kind from the ranker, not from raw rank magnitude", () => {
    const rows: IndexableItem[] = [
      item("local", "host", { visitedAt: 3, hostKey: "local" }),
      item("gpu-box", "host", { visitedAt: 2, hostKey: "remote:gpu-box" }),
      item("prev-visit", "terminal", {
        visitedAt: 1,
        hostKey: "local",
        terminalId: TID_B,
      }),
      item("active", "terminal", {
        visitedAt: 900,
        hostKey: "local",
        terminalId: TID_A,
      }),
    ];
    const ranked = filterAndRankPaletteItems(rows, {
      query: "",
      atRoot: true,
      current: onLocalTerminal(TID_A),
    });
    const idx = defaultSelectionIndex(ranked, onLocalTerminal(TID_A), "");
    expect(ranked[idx]?.row?.kind).toBe("terminal");
    expect(ranked[idx]?.name).toBe("prev-visit");
  });
});
