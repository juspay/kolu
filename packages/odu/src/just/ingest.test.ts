import { describe, expect, it } from "vitest";
import {
  laneTasks,
  mermaidGraph,
  parseSelector,
  pipelineFromDump,
} from "./ingest";

/** A synthetic `just --dump --dump-format json` tree shaped like kolu's:
 *  an empty-bodied `[metadata("ci")]` root in module `ci`, an `install`
 *  funnel, and coordinator-side recipes that must never schedule. */
function dump(): unknown {
  const recipe = (
    name: string,
    deps: string[],
    opts: { attributes?: unknown[]; body?: unknown[] } = {},
  ): unknown => ({
    name,
    namepath: `ci::${name}`,
    attributes: opts.attributes ?? [],
    body: opts.body ?? [["echo hi"]],
    dependencies: deps.map((d) => ({ arguments: [], recipe: d })),
  });
  return {
    recipes: {
      fmt: {
        name: "fmt",
        namepath: "fmt",
        attributes: [],
        body: [["biome format"]],
        dependencies: [],
      },
    },
    modules: {
      ci: {
        recipes: {
          default: recipe("default", ["nix", "e2e", "unit", "smoke"], {
            attributes: ["linux", "macos", { metadata: ["ci"] }, "parallel"],
            body: [],
          }),
          install: recipe("install", []),
          nix: recipe("nix", []),
          smoke: recipe("smoke", []),
          e2e: recipe("e2e", ["install"]),
          unit: recipe("unit", ["install"]),
          "pool-ensure": recipe("pool-ensure", []),
        },
        modules: {},
      },
    },
  };
}

describe("pipelineFromDump", () => {
  it("discovers the [metadata('ci')] root and expands only its reachable subgraph", () => {
    const spec = pipelineFromDump(dump());
    expect(spec.name).toBe("ci::default");
    expect(spec.tasks.map((t) => t.id).sort()).toEqual([
      "ci::e2e",
      "ci::install",
      "ci::nix",
      "ci::smoke",
      "ci::unit",
    ]);
    // pool-ensure lives in the module but is not reachable from the root
    expect(spec.tasks.find((t) => t.id === "ci::pool-ensure")).toBeUndefined();
  });

  it("excludes the empty-bodied root as a node and runs leaves via --no-deps", () => {
    const spec = pipelineFromDump(dump());
    expect(spec.tasks.find((t) => t.id === "ci::default")).toBeUndefined();
    const e2e = spec.tasks.find((t) => t.id === "ci::e2e");
    expect(e2e?.command).toBe("just --no-deps ci::e2e");
    expect(e2e?.needs).toEqual(["ci::install"]);
  });

  it("orders dependencies before dependents", () => {
    const spec = pipelineFromDump(dump());
    const ids = spec.tasks.map((t) => t.id);
    expect(ids.indexOf("ci::install")).toBeLessThan(ids.indexOf("ci::e2e"));
    expect(ids.indexOf("ci::install")).toBeLessThan(ids.indexOf("ci::unit"));
  });

  it("includes a --root override's own body-bearing recipe as a node", () => {
    const spec = pipelineFromDump(dump(), { root: "ci::e2e" });
    expect(spec.tasks.map((t) => t.id).sort()).toEqual([
      "ci::e2e",
      "ci::install",
    ]);
  });

  it("rejects an unknown --root and a missing ci tag", () => {
    expect(() => pipelineFromDump(dump(), { root: "nope" })).toThrow(
      /no recipe named/,
    );
    expect(() => pipelineFromDump({ recipes: {}, modules: {} })).toThrow(
      /expected exactly one/,
    );
  });
});

describe("selectors", () => {
  const spec = pipelineFromDump(dump());

  it("parses recipe and recipe@platform forms", () => {
    expect(parseSelector("e2e")).toEqual({ recipe: "e2e" });
    expect(parseSelector("ci::e2e@x86_64-linux")).toEqual({
      recipe: "ci::e2e",
      platform: "x86_64-linux",
    });
  });

  it("matches bare leaf names against namepaths", () => {
    const tasks = laneTasks(spec, "x86_64-linux", [{ recipe: "e2e" }], false);
    expect(tasks.map((t) => t.id).sort()).toEqual(["ci::e2e", "ci::install"]);
  });

  it("--no-deps skips the dependency closure", () => {
    const tasks = laneTasks(spec, "x86_64-linux", [{ recipe: "e2e" }], true);
    expect(tasks.map((t) => t.id)).toEqual(["ci::e2e"]);
    expect(tasks[0]?.needs).toEqual([]); // pruned: install is not in the lane
  });

  it("platform-pinned selectors slice other lanes to nothing", () => {
    const pinned = [{ recipe: "ci::e2e", platform: "aarch64-darwin" }];
    expect(laneTasks(spec, "aarch64-darwin", pinned, false)).not.toHaveLength(
      0,
    );
    expect(laneTasks(spec, "x86_64-linux", pinned, false)).toHaveLength(0);
  });

  it("no selectors means the whole pipeline", () => {
    expect(laneTasks(spec, "x86_64-linux", [], false)).toHaveLength(5);
  });

  it("rejects unknown recipes", () => {
    expect(() =>
      laneTasks(spec, "x86_64-linux", [{ recipe: "nopenope" }], false),
    ).toThrow(/matches no pipeline recipe/);
  });
});

describe("mermaidGraph", () => {
  it("emits one node per task and one edge per dependency", () => {
    const graph = mermaidGraph(pipelineFromDump(dump()));
    expect(graph).toContain("flowchart TD");
    expect(graph).toContain('ci__e2e["ci::e2e"]');
    expect(graph).toContain("ci__install --> ci__e2e");
  });
});
