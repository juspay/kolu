/**
 * Lazily-loaded directory rows — juspay/kolu#2091.
 *
 * The Code tab overlays gitignored entries from `git ls-files --directory`,
 * which COLLAPSES a wholly-ignored directory to a single trailing-slash entry
 * (`out/`) so `node_modules/` costs one row instead of thousands. Pierre
 * renders that entry as a directory row with a working chevron — so the user
 * can expand it — but the collapse means no child path was ever sent, and the
 * wrapper had no way to tell the host an expansion happened. Expanding `out/`
 * therefore opened onto nothing while the directory plainly held files on disk.
 *
 * `lazyDirectories` + `onExpandLazyDirectory` close that: the host names the
 * rows whose children live off-tree, and the wrapper reports each
 * collapsed → expanded transition so the host can fetch one level and fold the
 * result back into `paths`.
 *
 * These tests drive the REAL library rather than a mock, because the subject is
 * precisely Pierre's own behaviour on a childless directory row — that it gets
 * a chevron at all, and that expanding it ticks the store — which is exactly
 * what a mock would have to assume. Expansion is therefore observed the way the
 * app observes it, and asserted on the callback and the painted rows rather
 * than on any internal call.
 */
import { createSignal, Show } from "solid-js";
import { render } from "@solidjs/web";
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

/** A row as Pierre painted it, so expansion and selection are read off the DOM
 *  the user sees rather than off the wrapper's bookkeeping. */
function rowOf(root: ShadowRoot, path: string): HTMLElement {
  const row = root.querySelector(
    `[role="treeitem"][data-item-path="${path}"]`,
  ) as HTMLElement | null;
  if (!row) throw new Error(`no painted row for ${path}`);
  return row;
}

/** Click a row the way a user does — Pierre's own row button, inside its shadow
 *  root. `composed` so the event crosses the boundary like a real one. */
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
    // The bug, as the tree sees it: a directory row owning no children at all,
    // and nothing telling the host the user wants them.
    expect(paintedRows(root)).toContain("out/");
    expect(onExpandLazyDirectory).not.toHaveBeenCalled();

    clickRow(root, "out/");
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
  });

  it("paints the fetched level into the still-expanded directory", async () => {
    // The point of the callback: the host answers it by folding one level into
    // `paths`, replacing the collapsed row. Asserted at the DOM, because "model
    // right, screen empty" is the original defect.
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
    // A child directory arrives collapsed in its turn, so a deep ignored tree
    // stays one cheap level per click rather than one enormous listing.
    expect(rows).toContain("out/assets/");
    // Same shadow root as before the load ⇒ the children were painted into the
    // live tree, not a remount that would trivially show them.
    expect(root.isConnected).toBe(true);
  });

  it("stays silent for directories the host did not mark lazy", async () => {
    // Ordinary tracked directories already carry their children in `paths`;
    // firing for them would put a pointless fetch on every folder click.
    const { root, onExpandLazyDirectory } = mountTree(
      ["src/app.ts", "src/lib/util.ts", "out/"],
      ["out/"],
    );

    clickRow(root, "src/");
    await flush();

    expect(onExpandLazyDirectory).not.toHaveBeenCalled();
  });

  it("re-reports a re-expansion, so a reopened directory refetches", async () => {
    // Nothing watches an ignored directory — the working-tree watcher excludes
    // exactly these paths — so an open row's contents can go stale under it.
    // Collapse-and-reopen is the refresh gesture, and it only works if the
    // second expansion is reported too.
    const { root, onExpandLazyDirectory } = mountTree(["out/"], ["out/"]);

    clickRow(root, "out/"); // expand
    await flush();
    clickRow(root, "out/"); // collapse
    await flush();
    clickRow(root, "out/"); // expand again
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(2);
  });

  it("collapses the row and stops retrying when a load rejects", async () => {
    // A rejected load must not leave `item.isExpanded()` true while the
    // wrapper's own bookkeeping forgets the key: without also collapsing the
    // row, ANY later store tick — an unrelated click, an unconnected path
    // mutation — reads "expanded, not recorded" and mistakes it for a fresh
    // user expansion, retrying the same failing load forever instead of only
    // on a deliberate reopen.
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

    // A click on an unrelated row is exactly the kind of store tick that used
    // to re-trigger the failed load.
    clickRow(root, "kept.md");
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(1);
  });

  it("reports a row that mounts already open", async () => {
    // A restored expansion (`initialExpansion: "open"`, or a reveal replayed
    // through `initialExpandedPaths` across one of the remounts the live
    // fsListAll stream causes) leaves an open, childless folder in front of the
    // user with no click coming. It is the same fact as an expansion, so it is
    // reported the same way.
    const { onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
      "open",
    );
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
  });

  it("keeps the expansion intent when a projection hides the row", async () => {
    // The host filters `paths` (the search projection) but NOT
    // `lazyDirectories`, so a filter keystroke can remove the row while its key
    // is still declared. A row that does not exist holds no expansion state to
    // read — that is not the user closing the folder, so forgetting it there
    // erased the expansion for the rest of the mount: clear the filter and the
    // folder came back collapsed, with its children still in `paths`.
    const { setPaths, root, onExpandLazyDirectory } = mountTree(
      ["kept.md", "out/"],
      ["out/"],
    );
    clickRow(root, "out/");
    await flush();
    expect(onExpandLazyDirectory).toHaveBeenCalledWith("out/");
    // The host answers by folding one level in, replacing the collapsed key.
    setPaths(["kept.md", "out/index.html", "out/style.css"]);
    await flush();
    expect(paintedRows(root)).toContain("out/index.html");

    setPaths(["kept.md"]); // a filter keystroke hides the subtree
    await flush();
    setPaths(["kept.md", "out/index.html", "out/style.css"]); // filter cleared
    await flush();

    // Still open: the children are painted rather than hidden behind a row the
    // user never closed. (Pierre paints only visible rows, so a collapsed
    // `out/` would show neither child.)
    expect(paintedRows(root)).toContain("out/index.html");
    expect(paintedRows(root)).toContain("out/style.css");
  });

  it("reports afresh once the host stops calling a directory lazy", async () => {
    // Toggle the gitignored overlay off and back on: `lazyDirs` empties, the
    // children leave `paths`, and the level the host holds is now arbitrarily
    // old. A key the host no longer declares is no longer ours to dedupe
    // against — retiring it is what makes the next appearance refetch, rather
    // than showing a stale level with the collapse-and-reopen refresh gesture
    // unavailable.
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

    setLazy([]); // the overlay toggle goes off
    await flush();
    setLazy(["out/"]); // and back on
    await flush();

    expect(onExpandLazyDirectory).toHaveBeenCalledTimes(2);
  });

  it("reports a directory that only BECOMES lazy after it is open", async () => {
    // The overlay listing that names the lazy directories lands a tick after
    // the tree itself, and a load reveals nested directories that are lazy in
    // their own turn. Pierre's store does not tick for a host prop change, so
    // without a re-probe on `lazyDirectories` those keys would never be read.
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

/** The host side of `CodeTab.loadLazyDirectory`, which is the shape the
 *  wrapper's contract actually meets in the app: a NEWER read for a directory
 *  aborts the one still in flight, and the aborted promise REJECTS. Every call
 *  is recorded so a test can settle it by hand. */
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
  /** Answer the newest read for `dir` the way the host does. */
  const settle = (dir: string): void => {
    const c = [...calls].reverse().find((p) => p.dir === dir && !p.done);
    if (!c) throw new Error(`no read of ${dir} in flight`);
    c.done = true;
    c.resolve();
  };
  return { calls, load, settle };
}

describe("a lazy directory under a host that rebuilds one props object", () => {
  /** `CodeTab` hands every prop through ONE object: a per-mode `frame` memo
   *  rebuilt on any tick — a selection, a git-status pulse, a loaded level —
   *  and read through `<Show>`. Every prop read therefore notifies on every
   *  tick, carrying the very same values. The wrapper must react to a prop's
   *  VALUE; a bare notification is not a change. */
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
                  // The host's answer to a pick: a NEW frame object, same
                  // everything else.
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
    // The user's report: eye on, expand `.waterfall/`, click a file inside —
    // the file loads and the folder snaps shut. Each rebuilt frame re-notified
    // `lazyEpoch`, which wiped the record of which lazy directories are open;
    // the next store tick then read "expanded, not recorded" and reported the
    // already-open folder as a fresh expansion, so the level was re-fetched on
    // every tick — and the re-fetch that the file click triggered superseded
    // (aborted, hence rejected) the one before it, which closed the row.
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

    // The host answers by folding the level into `paths` — a fresh frame, same
    // epoch, a rebuilt (but equal) lazy list, exactly as the Code tab does.
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

    // The pick itself landed — without this the rest could pass on the frame
    // rebuild the load alone causes, with the click dropped (the provenance
    // gate, a Pierre change) and nobody the wiser.
    expect(picked).toEqual([".waterfall/brief.md"]);
    expect(frame().selected).toBe(".waterfall/brief.md");
    expect(
      rowOf(root, ".waterfall/brief.md").getAttribute("aria-selected"),
    ).toBe("true");
    // One expansion, one read. Not three.
    expect(calls.map((c) => c.dir)).toEqual([".waterfall/"]);
    // And the folder the user opened is still open, with its contents on
    // screen — Pierre paints only visible rows, so a shut folder shows neither.
    expect(rowOf(root, ".waterfall/").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(paintedRows(root)).toContain(".waterfall/brief.md");
    expect(paintedRows(root)).toContain(".waterfall/notes.md");
  });
});

describe("a superseded load owns no outcome", () => {
  it("keeps the row open when a replaced read rejects", async () => {
    // Expand → collapse → expand is two reads of one directory, and the host
    // aborts the first when the second starts, so the first REJECTS after the
    // second has already been reported. A rejection still closes a folder it
    // owns (an unreadable directory must not sit open and empty) — but this one
    // owns nothing: a newer read has taken the directory, and collapsing on its
    // behalf shuts a folder whose contents are still on their way.
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

    clickRow(root, "out/"); // expand — read 1
    await flush();
    clickRow(root, "out/"); // collapse
    await flush();
    clickRow(root, "out/"); // expand again — read 2 supersedes read 1
    await flush();

    expect(calls).toHaveLength(2);
    expect(rowOf(root, "out/").getAttribute("aria-expanded")).toBe("true");
  });
});
