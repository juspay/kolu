// @vitest-environment happy-dom
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";
import {
  disposeAll,
  disposers,
  flush,
  mountInto,
  paintedRows,
} from "./FileTree.testlib.ts";

afterEach(disposeAll);

function mountTree(
  initial: string[],
  lazyDirectories: string[],
  initialExpansion: "open" | "closed" = "closed",
) {
  const [paths, setPaths] = createSignal(initial);
  const onExpandLazyDirectory = vi.fn<(path: string) => void>();
  const root = mountInto((host) =>
    render(
      () => (
        <FileTree
          paths={paths()}
          lazyDirectories={lazyDirectories}
          onExpandLazyDirectory={onExpandLazyDirectory}
          initialExpansion={initialExpansion}
          search={false}
          onError={(err) => {
            throw err;
          }}
        />
      ),
      host,
    ),
  );
  return { setPaths, root, onExpandLazyDirectory };
}

function rowOf(root: ShadowRoot, path: string): HTMLElement {
  const row = root.querySelector(
    `[role="treeitem"][data-item-path="${path}"]`,
  ) as HTMLElement | null;
  if (!row) throw new Error(`no painted row for ${path}`);
  return row;
}

function clickRow(root: ShadowRoot, path: string): void {
  rowOf(root, path).dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true }),
  );
}

describe("lazily-loaded directory rows (#2091)", () => {
  it("reports the expansion of a collapsed gitignored directory", async () => {
    const { root, onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
    );
    expect(paintedRows(root)).toContain("out/");
    expect(onExpandLazyDirectory).not.toHaveBeenCalled();

    clickRow(root, "out/");
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
  });

  it("paints the fetched level into the still-expanded directory", async () => {
    const { setPaths, root, onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
    );

    clickRow(root, "out/");
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");

    setPaths(["kept.md", "out/index.html", "out/style.css", "out/assets/"]);
    await flush();

    const rows = paintedRows(root);
    expect(rows).toContain("out/index.html");
    expect(rows).toContain("out/style.css");
    expect(rows).toContain("out/assets/");
    expect(root.isConnected).toBe(true);
  });

  it("stays silent for directories the host did not mark lazy", async () => {
    const { root, onExpandLazyDirectory } = mountTree(
      ["src/app.ts", "src/lib/util.ts", "out/"],
      ["out/"],
    );

    clickRow(root, "src/");
    await flush();

    expect(onExpandLazyDirectory).not.toHaveBeenCalled();
  });

  it("re-reports a re-expansion, so a reopened directory refetches", async () => {
    const { root, onExpandLazyDirectory } = mountTree(["out/"], ["out/"]);

    clickRow(root, "out/");
    await flush();
    clickRow(root, "out/");
    await flush();
    clickRow(root, "out/");
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(2);
  });

  it("collapses the row and stops retrying when a load rejects", async () => {
    const onExpandLazyDirectory = vi.fn(() =>
      Promise.reject(new Error("boom")),
    );
    const root = mountInto((host) =>
      render(
        () => (
          <FileTree
            paths={["kept.md", "out/"]}
            lazyDirectories={["out/"]}
            onExpandLazyDirectory={onExpandLazyDirectory}
            search={false}
            onError={(err) => {
              throw err;
            }}
          />
        ),
        host,
      ),
    );

    clickRow(root, "out/");
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(1);

    const row = root.querySelector(
      '[role="treeitem"][data-item-path="out/"]',
    ) as HTMLElement;
    expect(row.getAttribute("aria-expanded")).toBe("false");

    clickRow(root, "kept.md");
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(1);
  });

  it("reports a row that mounts already open", async () => {
    const { onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
      "open",
    );
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
  });

  it("keeps the expansion intent when a projection hides the row", async () => {
    const { setPaths, root, onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
    );
    clickRow(root, "out/");
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
    setPaths(["kept.md", "out/index.html", "out/style.css"]);
    await flush();
    expect(paintedRows(root)).toContain("out/index.html");

    setPaths(["kept.md"]);
    await flush();
    setPaths(["kept.md", "out/index.html", "out/style.css"]);
    await flush();

    expect(paintedRows(root)).toContain("out/index.html");
    expect(paintedRows(root)).toContain("out/style.css");
  });

  it("reports afresh once the host stops calling a directory lazy", async () => {
    const [lazy, setLazy] = createSignal<string[]>(["out/"]);
    const onExpandLazyDirectory = vi.fn<(path: string) => void>();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(
      () => (
        <FileTree
          paths={["kept.md", "out/"]}
          lazyDirectories={lazy()}
          onExpandLazyDirectory={onExpandLazyDirectory}
          initialExpansion="open"
          search={false}
          onError={(err) => {
            throw err;
          }}
        />
      ),
      host,
    );
    disposers.push(dispose, () => host.remove());
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(1);

    setLazy([]);
    await flush();
    setLazy(["out/"]);
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(2);
  });

  it("reports a directory that only BECOMES lazy after it is open", async () => {
    const [lazy, setLazy] = createSignal<string[]>([]);
    const onExpandLazyDirectory = vi.fn<(path: string) => void>();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(
      () => (
        <FileTree
          paths={["kept.md", "out/"]}
          lazyDirectories={lazy()}
          onExpandLazyDirectory={onExpandLazyDirectory}
          initialExpansion="open"
          search={false}
          onError={(err) => {
            throw err;
          }}
        />
      ),
      host,
    );
    disposers.push(dispose, () => host.remove());
    await flush();
    expect(onExpandLazyDirectory).not.toHaveBeenCalled();

    setLazy(["out/"]);
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
  });
});

function supersedingLoader() {
  type Pending = {
    dir: string;
    resolve: () => void;
    reject: (err: Error) => void;
    done: boolean;
  };
  const calls: Pending[] = [];
  const load = (dir: string): Promise<void> => {
    for (const c of calls) {
      if (c.dir !== dir || c.done) continue;
      c.done = true;
      c.reject(new Error(`superseded read of ${dir}`));
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    calls.push({ dir, resolve, reject, done: false });
    return promise;
  };
  const settle = (dir: string): void => {
    const c = [...calls].reverse().find((p) => p.dir === dir && !p.done);
    if (!c) throw new Error(`no read of ${dir} in flight`);
    c.done = true;
    c.resolve();
  };
  return { calls, load, settle };
}

describe("a lazy directory under a host that rebuilds one props object", () => {
  type Frame = {
    paths: string[];
    lazy: string[];
    epoch: string;
    selected: string | null;
  };

  function mountFrameHost(
    initial: Frame,
    load: (dir: string) => Promise<void>,
  ) {
    const [frame, setFrame] = createSignal<Frame>(initial);
    const picked: Array<string | null> = [];
    const root = mountInto((host) =>
      render(
        () => (
          <Show when={frame()}>
            {(current) => (
              <FileTree
                paths={current().paths}
                selectedPath={current().selected}
                lazyDirectories={current().lazy}
                lazyEpoch={current().epoch}
                onExpandLazyDirectory={load}
                onSelect={(p) => {
                  picked.push(p);
                  setFrame((f) => ({ ...f, selected: p }));
                }}
                search={false}
                onError={(err) => {
                  throw err;
                }}
              />
            )}
          </Show>
        ),
        host,
      ),
    );
    return { root, setFrame, picked, frame };
  }

  it("loads it once, and keeps it open when a file inside is picked", async () => {
    const { calls, load, settle } = supersedingLoader();
    const { root, setFrame, picked, frame } = mountFrameHost(
      {
        paths: ["kept.md", ".waterfall/"],
        lazy: [".waterfall/"],
        epoch: "/repo|browse",
        selected: null,
      },
      load,
    );

    clickRow(root, ".waterfall/");
    await flush();
    expect(calls).toHaveLength(1);

    settle(".waterfall/");
    setFrame((f) => ({
      ...f,
      paths: ["kept.md", ".waterfall/brief.md", ".waterfall/notes.md"],
      lazy: [".waterfall/"],
    }));
    await flush();
    expect(paintedRows(root)).toContain(".waterfall/brief.md");

    clickRow(root, ".waterfall/brief.md");
    await flush();

    expect(picked).toEqual([".waterfall/brief.md"]);
    expect(frame().selected).toBe(".waterfall/brief.md");
    expect(
      rowOf(root, ".waterfall/brief.md").getAttribute("aria-selected"),
    ).toBe("true");
    expect(calls.map((c) => c.dir)).toEqual([".waterfall/"]);
    expect(rowOf(root, ".waterfall/").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(paintedRows(root)).toContain(".waterfall/brief.md");
    expect(paintedRows(root)).toContain(".waterfall/notes.md");
  });
});

describe("a superseded load owns no outcome", () => {
  it("keeps the row open when a replaced read rejects", async () => {
    const { calls, load } = supersedingLoader();
    const root = mountInto((host) =>
      render(
        () => (
          <FileTree
            paths={["kept.md", "out/"]}
            lazyDirectories={["out/"]}
            onExpandLazyDirectory={load}
            search={false}
            onError={(err) => {
              throw err;
            }}
          />
        ),
        host,
      ),
    );

    clickRow(root, "out/");
    await flush();
    clickRow(root, "out/");
    await flush();
    clickRow(root, "out/");
    await flush();

    expect(calls).toHaveLength(2);
    expect(rowOf(root, "out/").getAttribute("aria-expanded")).toBe("true");
  });
});
