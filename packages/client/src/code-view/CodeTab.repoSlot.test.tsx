// @vitest-environment happy-dom
/** THE REPO SLOT'S OWN STATE — the filename filter, the standing folder reveal
 *  and the lazily-loaded folder levels.
 *
 *  All three are facts about ONE repo slot, and all three used to be cleared by
 *  an effect keyed on that slot. An effect's apply arm runs AFTER the readers of
 *  the change that triggered it, so the first frame of a repo switch published
 *  the NEW repo's listing with the OLD repo's loaded levels and needle — one
 *  wrong frame per repo change, and a relay tear
 *  (`EFFECT_RELAY_TEAR`, which `@kolu/solid-test-setup` fails this file on from
 *  its third sighting). Each is stamped with its slot instead, so the switch
 *  publishes the new slot's state in its own flush.
 *
 *  The subject is driven over a signal, repo A ⇄ repo B, which is also what
 *  makes the two repos share folder names: `out/` exists in both. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import type { Subscription } from "@kolu/surface/solid";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shown } from "../ui/shown";
import type { CodeQueries, ScopedCodePaths } from "./codeQueries";
import type { CodeSubject } from "./codeSubject";
import { codeOwner } from "./codeTabOpenController";
import type { CodeDoor } from "./codeDoor";
import type { CodeViewState } from "./codeViewState";

const h = vi.hoisted(() => ({
  /** The tree's lazy-expand callback, as the view handed it over. */
  expand: null as null | ((dirPath: string) => Promise<void>),
  /** Every level this test's host answered an expand with. */
  listed: [] as string[],
  /** Every `paths` value the tree was APPLIED, in order — one entry per
   *  publication, which is how a frame that is corrected on the next flush is
   *  visible at all (the DOM only ever shows the last one). */
  applied: [] as string[][],
}));

// Pierre's tree is not this test's subject: what is pinned is WHAT the view
// hands it, so the mock paints the paths it is given, records every value it
// is handed, and keeps the expand callback.
vi.mock("@kolu/solid-pierre", async () => {
  const { createEffect, For } = await import("solid-js");
  return {
    FileTree: (props: {
      paths: string[];
      onExpandLazyDirectory: (dirPath: string) => Promise<void>;
    }) => {
      h.expand = props.onExpandLazyDirectory;
      createEffect(
        () => props.paths,
        (paths) => {
          h.applied.push([...paths]);
        },
      );
      return (
        <ul data-testid="tree">
          <For each={props.paths}>{(path) => <li>{path}</li>}</For>
        </ul>
      );
    },
    CodeView: () => <div data-testid="pierre-diff-view" />,
    diffItems: () => [],
    useCodeViewSelection: () => () => null,
    rowPathsCss: () => "",
    codeViewItemIdAt: () => undefined,
  };
});
vi.mock("./BrowseFileView", () => ({
  default: () => <pre data-testid="source-view" />,
}));
vi.mock("../right-panel/useRightPanel", () => ({
  MIN_CODE_PANE_SHARE: 0.1,
  useRightPanel: () => ({
    codeTabTreeSize: () => 0.35,
    setCodeTabTreeSize: () => {},
  }),
}));
vi.mock("../settings/useColorScheme", () => ({
  useColorScheme: () => ({ themeTypeLiteral: () => "dark" }),
}));
vi.mock("../useDeepLinks", () => ({ requestDeepLinkNavigation: () => {} }));
// The one lazy level this test's folder holds, through the real
// `runActionPromise` bridge the view uses.
vi.mock("../wire", async () => {
  const { Effect } = await import("effect");
  return {
    padiRpcOf: () => ({
      fs: {
        listDirectory: (input: { dirPath: string }) =>
          Effect.sync(() => {
            h.listed.push(input.dirPath);
            return { paths: [`${input.dirPath}built.js`] };
          }),
      },
    }),
  };
});
vi.mock("solid-sonner", () => ({
  toast: { error: () => {}, success: () => {} },
}));

import CodeTab from "./CodeTab";

const REPO_A = "/srv/code/kestrel";
const REPO_B = "/srv/code/merlin";

/** A settled read, reactive in the root it is asked about. */
const level = (root: () => string): Subscription<ScopedCodePaths> =>
  Object.assign(() => ({ repoRoot: root(), paths: ["out/", "readme.md"] }), {
    pending: () => false,
    error: () => undefined,
    complete: () => false,
  });

const idle = <T,>(): Subscription<T> =>
  Object.assign(() => undefined, {
    pending: () => false,
    error: () => undefined,
    complete: () => false,
  });

const place = (): CodeViewState => {
  const [codeMode, setCodeMode] = createSignal<CodeTabView>("browse");
  return {
    codeMode,
    setCodeMode,
    selectedFile: () => null,
    setSelectedFile: () => {},
    recordNavigation: () => {},
    navigateBack: () => null,
    navigateForward: () => null,
    canNavigateBack: () => false,
    canNavigateForward: () => false,
  };
};

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  h.expand = null;
  h.listed = [];
  h.applied = [];
  localStorage.clear();
});

/** The view over a root that moves. A folder git cannot list, so every folder
 *  is a lazy directory and one click reads one level — the shortest path to a
 *  loaded level in a test. */
function showMovingRoot(): {
  host: HTMLElement;
  setRoot: (root: string) => void;
  rows: () => string[];
  filter: () => HTMLInputElement;
} {
  const [root, setRoot] = createSignal(REPO_A);
  const subject: CodeSubject = {
    owner: codeOwner("test-view", "export"),
    host: { kind: "local" },
    get git() {
      return { kind: "repo", root: root(), lister: "disk" } as const;
    },
    terminalId: null,
    comments: null,
  };
  const queries: CodeQueries = {
    localStatus: idle(),
    branchStatus: idle(),
    activeStatus: idle(),
    allPaths: idle(),
    diskRootLevel: level(root),
    ignoredPaths: idle(),
    diff: idle(),
    fileContent: idle(),
    lease: () => {},
  };
  const door: CodeDoor = { pending: () => null, open: () => {} };
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Shown value={() => true}>
        <CodeTab
          subject={subject}
          state={place()}
          queries={queries}
          door={door}
          arrangement="stacked"
        />
      </Shown>
    ),
    host,
  );
  flush();
  return {
    host,
    setRoot,
    rows: () =>
      Array.from(
        host.querySelectorAll("[data-code-tree-mode=browse] li"),
        (li) => li.textContent ?? "",
      ),
    filter: () => {
      const input = host.querySelector<HTMLInputElement>(
        "[data-testid=diff-filter-search]",
      );
      if (input === null) throw new Error("the toolbar has no filter input");
      return input;
    },
  };
}

/** Type into the filename filter the way the user does. */
function typeFilter(input: HTMLInputElement, needle: string): void {
  input.value = needle;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

describe("the Code tab's repo-slot state", () => {
  it("publishes the new slot's levels and needle in the switch's own flush", async () => {
    const view = showMovingRoot();
    expect(view.rows()).toEqual(["out/", "readme.md"]);

    // Open the lazy folder in repo A: one level read, substituted for the
    // collapsed key.
    const expand = h.expand;
    if (expand === null) throw new Error("the tree was handed no expand hook");
    await expand("out/");
    flush();
    expect(h.listed).toEqual(["out/"]);
    expect(view.rows()).toEqual(["out/built.js", "readme.md"]);

    // And filter the tree down to it.
    typeFilter(view.filter(), "built");
    expect(view.rows()).toEqual(["out/built.js"]);

    // FIVE switches, so the relay escalates past its third sighting. `out/`
    // exists in both repos, so a level kept across the switch is painted under
    // the other repo's folder of the same name — which is what the comment the
    // old clearing effect carried ("would paint one repo's build output inside
    // another's") describes, and what its own apply arm could only correct one
    // flush after the tree had been handed it.
    const frames: Array<{
      root: string;
      applied: string[][];
      needle: string;
    }> = [];
    for (const root of [REPO_B, REPO_A, REPO_B, REPO_A, REPO_B]) {
      const before = h.applied.length;
      view.setRoot(root);
      flush();
      frames.push({
        root,
        applied: h.applied.slice(before),
        needle: view.filter().value,
      });
    }

    // ONE publication per switch, carrying the arriving slot's own state.
    // Repo B never had a level read or a needle typed, so its tree is its own
    // root level, unfiltered, from the switch's own flush. Repo A is the slot
    // that owns both, so coming back to it restores them — a stamp says what
    // state belongs to, which is not the same as when it was written.
    expect(frames).toEqual([
      { root: REPO_B, applied: [["out/", "readme.md"]], needle: "" },
      { root: REPO_A, applied: [["out/built.js"]], needle: "built" },
      { root: REPO_B, applied: [["out/", "readme.md"]], needle: "" },
      { root: REPO_A, applied: [["out/built.js"]], needle: "built" },
      { root: REPO_B, applied: [["out/", "readme.md"]], needle: "" },
    ]);
    // One read, in repo A: a switch neither re-reads nor re-lists.
    expect(h.listed).toEqual(["out/"]);
  });
});
