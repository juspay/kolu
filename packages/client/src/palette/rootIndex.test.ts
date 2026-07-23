import { describe, expect, it } from "vitest";
import {
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
    searchText?: string;
    sectionOrder?: number;
    hostKey?: string;
    terminalId?: string;
  } = {},
): IndexableItem {
  const {
    recencyAt,
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
    // Top RECENT_TERMINAL_LIMIT terminals by recency
    expect(names.slice(0, RECENT_TERMINAL_LIMIT)).toEqual([
      "fresh-ws",
      "mid-ws",
      "old-ws",
    ]);
    // fourth workspace dropped
    expect(names).not.toContain("extra-ws");
    // hosts next
    expect(
      names.slice(RECENT_TERMINAL_LIMIT, RECENT_TERMINAL_LIMIT + 2),
    ).toEqual(["gpu-box", "local"]);
    // commands last, by sectionOrder
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
      excludeFromRecent: {
        hostKey: "local",
        terminalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      },
    });
    const names = out
      .filter((i) => i.row?.kind === "terminal")
      .map((i) => i.name);
    // Active (freshest) omitted; previous visits remain and fill Recent.
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
      excludeFromRecent: {
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
    // only fresh-ws has "edge" in corpus
    expect(out.map((i) => i.name)).toEqual(["fresh-ws"]);
  });

  it("queried root ranks workspace hits above host hits above commands", () => {
    // "k" matches nothing useful — use tokens that hit all three kinds
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
    expect(out.map((i) => i.name)).toEqual([
      "ws-b", // more recent workspace first
      "ws-a",
      "builder",
      // command has no "builder"
    ]);
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
    // no re-sort by sectionOrder when not at root
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
