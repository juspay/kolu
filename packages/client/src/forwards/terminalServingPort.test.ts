import { describe, expect, it } from "vitest";
import type { GitInfo } from "kolu-git/schemas";
import type { TerminalId } from "kolu-common/surface";
import {
  servingTerminalName,
  terminalServingPort,
  type ServingCandidate,
} from "./terminalServingPort";

const id = (s: string) => s as TerminalId;

const serving = (
  terminalId: string,
  ports: number[],
  parentId: string | null = null,
): ServingCandidate => ({
  id: id(terminalId),
  parentId: parentId === null ? null : id(parentId),
  ports: {
    status: "known",
    list: ports.map((port) => ({
      port,
      name: "node",
      command: "node server.js",
      scope: "loopback",
      family: "v4",
    })),
  },
});

const blind = (terminalId: string): ServingCandidate => ({
  id: id(terminalId),
  parentId: null,
  ports: { status: "unknown" },
});

describe("terminalServingPort", () => {
  it("finds the terminal whose subtree holds the port", () => {
    expect(
      terminalServingPort({
        port: 5173,
        terminals: [serving("a", [3000]), serving("b", [5173])],
      }),
    ).toBe(id("b"));
  });

  it("returns the TILE when the server runs in a split", () => {
    expect(
      terminalServingPort({
        port: 5173,
        terminals: [serving("tile", []), serving("split", [5173], "tile")],
      }),
    ).toBe(id("tile"));
  });

  it("is undefined when nothing serves it", () => {
    expect(
      terminalServingPort({ port: 9229, terminals: [serving("a", [3000])] }),
    ).toBeUndefined();
  });

  it("does not search a terminal that has never been scanned", () => {
    expect(
      terminalServingPort({ port: 5173, terminals: [blind("a")] }),
    ).toBeUndefined();
  });

  it("prefers the FIRST match, deterministically, when two terminals claim it", () => {
    const terminals = [serving("a", [5173]), serving("b", [5173])];
    expect(terminalServingPort({ port: 5173, terminals })).toBe(id("a"));
    expect(terminalServingPort({ port: 5173, terminals })).toBe(id("a"));
  });

  it("is undefined for an empty fleet", () => {
    expect(terminalServingPort({ port: 5173, terminals: [] })).toBeUndefined();
  });
});

describe("the Inspector's trailing group — the surface that most needs the link", () => {
  it("finds the OTHER tile serving an orphaned forward", () => {
    const rows = [serving("inspected", [3000]), serving("elsewhere", [9229])];
    expect(terminalServingPort({ port: 9229, terminals: rows })).toBe(
      id("elsewhere"),
    );
  });

  it("finds it through that tile's SPLIT, and returns the tile", () => {
    const rows = [
      serving("inspected", [3000]),
      serving("elsewhere", []),
      serving("elsewhere-split", [9229], "elsewhere"),
    ];
    expect(terminalServingPort({ port: 9229, terminals: rows })).toBe(
      id("elsewhere"),
    );
  });

  it("has no answer for a ⌘K forward to a port nothing serves", () => {
    const rows = [serving("inspected", [3000])];
    expect(
      terminalServingPort({ port: 61000, terminals: rows }),
    ).toBeUndefined();
  });
});

describe("servingTerminalName", () => {
  it("names a git terminal the way every other surface names it", () => {
    expect(
      servingTerminalName({
        git: {
          kind: "repo",
          info: { repoName: "kolu", branch: "master" } as GitInfo,
        },
        cwd: "/home/srid/code/kolu",
      }),
    ).toBe("kolu/master");
  });

  it("names a terminal whose git has not resolved by its path, too", () => {
    expect(
      servingTerminalName({
        git: { kind: "unresolved" },
        cwd: "/home/srid/scratch",
      }),
    ).toBe("~/scratch");
  });

  it("falls back to the shortened path when there is no git", () => {
    expect(
      servingTerminalName({ git: { kind: "none" }, cwd: "/home/srid/scratch" }),
    ).toBe("~/scratch");
  });
});
