// @vitest-environment happy-dom
/** THE CODE VIEW OVER A REAL REPOSITORY'S WORTH OF FILES.
 *
 *  A repo has thousands of files and a branch has hundreds of changed ones,
 *  and the tree is built from them by two memos: `treeInventory` (what the
 *  tree lists) and `treeGitStatus` (how its rows are decorated). Both read
 *  the Code view's own reads, which `createPolledQuery` publishes — so what
 *  those reads publish decides how many sources one listing costs.
 *
 *  Published as a reconciled STORE, each path index and each status leaf was
 *  a source of its own: 2,000 tracked files were 2,001 sources on
 *  `treeInventory` and 400 changed files across two layers were ~2,400 on
 *  `treeGitStatus`, both of which Solid's development build judges
 *  `WIDE_SCOPE_DEPS` past 200. Published as a VALUE, one listing is one
 *  source whatever its length, and the tree is handed exactly the same rows
 *  in exactly the same order — which is what this file holds both halves to:
 *  no diagnostic at any size, and the inventory and the decoration set
 *  computed here, independently of the memos that publish them.
 *
 *  The drive is the product's own: the real `buildCodeQueries` over a
 *  hand-pumped pulse, the real `CodeTab`, and a `FileTree` that records what
 *  it was handed. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { GitChangeStatus } from "kolu-git/schemas";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Shown } from "../ui/shown";
import type { CodeQueries } from "./codeQueries";
import type { CodeSubject } from "./codeSubject";
import { codeOwner } from "./codeTabOpenController";
import type { CodeDoor } from "./codeDoor";
import type { CodeViewState } from "./codeViewState";

/** The repository this file serves, as the mocked host answers for it, plus
 *  what the tree was last handed. Hoisted, because the module mocks below are
 *  hoisted above this file's own imports. */
const h = vi.hoisted(() => ({
  /** `fs.listAll` — every tracked path, in listing order. */
  tracked: [] as string[],
  /** `fs.listIgnored` — the gitignored overlay's entries. */
  ignored: [] as string[],
  /** `git.getStatus` per mode, as changed-file rows. */
  local: [] as Array<{ path: string; status: string }>,
  branch: [] as Array<{ path: string; status: string }>,
  /** `fs.listDirectory` at the root — the level a folder git cannot list. */
  diskRoot: [] as string[],
  /** Every `git.getDiff` input, in call order. */
  diffInputs: [] as Array<{ filePath: string; mode: string }>,
  /** Every pulse stream opened, as its frame pusher. */
  pulses: [] as Array<(event: { frame: true }) => void>,
  /** What `<FileTree>` was last handed on each channel. */
  paths: undefined as unknown,
  gitStatus: undefined as unknown,
}));

vi.mock("@kolu/surface/client", async () => {
  const { makeControllableStream } = await import("./streamMock.testlib");
  return {
    unenrolledStreamCall: () => {
      const { stream, push } = makeControllableStream();
      h.pulses.push(push);
      return stream;
    },
  };
});

vi.mock("../wire", async () => {
  const { Effect } = await import("effect");
  // A fresh frame per read, the way a decode off the wire is fresh: nothing
  // downstream may lean on the fixture's own references.
  const status = (mode: string) =>
    mode === "local"
      ? {
          mode: "local",
          files: h.local.map((f) => ({ ...f })),
          branch: { name: "work", upstream: null, ahead: 0, behind: 0 },
          workingTree: {
            staged: 0,
            modified: h.local.length,
            untracked: 0,
          },
        }
      : {
          mode: "branch",
          files: h.branch.map((f) => ({ ...f })),
          base: { ref: "origin/master", sha: "9f1c2d3" },
        };
  const rpc = () => ({
    fs: {
      listAll: () => Effect.succeed({ paths: [...h.tracked] }),
      listIgnored: () => Effect.succeed({ paths: [...h.ignored] }),
      listDirectory: (input: { dirPath: string }) =>
        Effect.succeed({
          paths: input.dirPath === "" ? [...h.diskRoot] : [],
        }),
      readFile: () => Effect.succeed({ content: "", truncated: false }),
      filePreviewTag: () => Effect.succeed("tag"),
    },
    git: {
      getStatus: (input: { mode: string }) =>
        Effect.succeed(status(input.mode)),
      getDiff: (input: {
        repoPath: string;
        filePath: string;
        mode: string;
        oldPath?: string;
      }) => {
        h.diffInputs.push(input);
        return Effect.succeed({
          oldFileName: input.oldPath ?? input.filePath,
          newFileName: input.filePath,
          hunks: [`@@ -1 +1 @@\n-before\n+after`],
          binary: false,
        });
      },
    },
  });
  return {
    padiRpcOf: rpc,
    padiMap: {
      live: () => true,
      entry: () => ({
        streams: {
          subscribeRepoChange: { unenrolled: "repo-change" },
          subscribeFileChange: { unenrolled: "file-change" },
        },
      }),
    },
  };
});

vi.mock("@kolu/solid-pierre", async () => {
  const { createRenderEffect } = await import("solid-js");
  return {
    FileTree: (props: { paths: unknown; gitStatus: unknown }) => {
      createRenderEffect(
        () => props.paths,
        (value) => {
          h.paths = value;
        },
      );
      createRenderEffect(
        () => props.gitStatus,
        (value) => {
          h.gitStatus = value;
        },
      );
      return <ul data-testid="tree" />;
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
vi.mock("solid-sonner", () => ({
  toast: { error: () => {}, success: () => {} },
}));

import CodeTab from "./CodeTab";
import { buildCodeQueries } from "./codeQueries";
import { setShowIgnoredFiles } from "./showIgnoredFiles";

const ROOT = "/srv/code/kestrel/.worktrees/export";

/** A repository's worth of tracked files — twenty directories deep enough to
 *  look like a tree, a hundred files each. */
const trackedPaths = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, n) =>
      `src/mod-${String(Math.floor(n / 100)).padStart(2, "0")}/file-${String(n).padStart(4, "0")}.ts`,
  );

const changed = (
  paths: readonly string[],
  status: GitChangeStatus,
): Array<{ path: string; status: string }> =>
  paths.map((path) => ({ path, status }));

/** The word Pierre paints each wire status as — spelled here rather than read
 *  off the product's own mapping, so the decoration set below is computed
 *  independently of what publishes it. */
const WORD: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  "?": "untracked",
};

/** The decoration set, built the way a reader would: the branch layer in its
 *  own order, each row taking the local layer's word where one exists, then
 *  the local-only rows in their order. */
const decorations = (
  primary: ReadonlyArray<{ path: string; status: string }>,
  fallback: ReadonlyArray<{ path: string; status: string }>,
): Array<{ path: string; status: string }> => {
  const local = new Map(primary.map((f) => [f.path, f.status]));
  const seen = new Set<string>();
  const out: Array<{ path: string; status: string }> = [];
  for (const f of fallback) {
    seen.add(f.path);
    const status = local.get(f.path) ?? f.status;
    out.push({ path: f.path, status: WORD[status] as string });
  }
  for (const f of primary) {
    if (seen.has(f.path)) continue;
    out.push({ path: f.path, status: WORD[f.status] as string });
  }
  return out;
};

const [codeMode, setCodeMode] = createSignal<CodeTabView>("browse");
/** The pick of the DIFF modes — browse keeps none, so the file-content read
 *  stays idle and only the diff query's own input is exercised. */
const [pick, setPick] = createSignal<string | null>(null);
const place: CodeViewState = {
  codeMode,
  setCodeMode,
  selectedFile: (mode) => (mode === "browse" ? null : pick()),
  setSelectedFile: () => {},
  recordNavigation: () => {},
  navigateBack: () => null,
  navigateForward: () => null,
  canNavigateBack: () => false,
  canNavigateForward: () => false,
};

/** The view's subject: a repository git lists, or a folder only the disk can
 *  (a bare repository's, whose root level is read with `fs.listDirectory`). */
const subjectListedBy = (lister: "git" | "disk"): CodeSubject => ({
  owner: codeOwner("test-view", "export"),
  host: { kind: "local" },
  git: { kind: "repo", root: ROOT, lister },
  terminalId: "term-1" as TerminalId,
  comments: null,
});

let subject: CodeSubject = subjectListedBy("git");

const door: CodeDoor = { pending: () => null, open: () => {} };

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  h.tracked = [];
  h.ignored = [];
  h.local = [];
  h.branch = [];
  h.diskRoot = [];
  h.diffInputs.length = 0;
  h.pulses.length = 0;
  h.paths = undefined;
  h.gitStatus = undefined;
  setCodeMode("browse");
  setPick(null);
  subject = subjectListedBy("git");
  setShowIgnoredFiles(false);
  localStorage.clear();
});

/** Mount the real view over the real query set, reading the fixture above. */
const mount = (): void => {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => {
    const built = buildCodeQueries({
      subject: () => subject,
      state: place,
      active: () => true,
      showsPick: () => false,
    });
    const queries: CodeQueries = { ...built, lease: () => {} };
    return (
      <Shown value={() => true}>
        <CodeTab
          subject={subject}
          state={place}
          queries={queries}
          door={door}
          arrangement="stacked"
        />
      </Shown>
    );
  }, host);
};

/** One watcher pulse into every open stream, settled and flushed — the frame
 *  that makes each query read, and the frame a later one re-reads on. */
const pump = async (): Promise<void> => {
  for (const push of [...h.pulses]) push({ frame: true });
  for (let tick = 0; tick < 8; tick++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  flush();
};

/** Every finding Solid raised, as its grade, code and sentence — so an `info`
 *  shows in the failure beside a `warn`. */
const findings = (): string[] =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

it("lists 2,000 tracked files and decorates two status layers, with the overlay off", async () => {
  h.tracked = trackedPaths(2000);
  h.local = [
    ...changed(h.tracked.slice(0, 200), "M"),
    ...changed(
      Array.from({ length: 10 }, (_, n) => `notes/scratch-${n}.md`),
      "?",
    ),
  ];
  h.branch = changed(h.tracked.slice(0, 400), "A");

  mount();
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual(h.tracked);
  expect(h.gitStatus).toEqual(decorations(h.local, h.branch));

  // One file added, the way a watcher pulse delivers it: the listing re-reads
  // and the row appears, with nothing else disturbed.
  h.tracked = [...h.tracked, "src/mod-19/file-2000.ts"];
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual(h.tracked);
  expect(h.gitStatus).toEqual(decorations(h.local, h.branch));

  // FIVE PULSES THAT CHANGED NOTHING — what a watcher does between edits, and
  // the streak `UNSTABLE_MEMO_OUTPUT` answers on at four. Each one re-reads
  // the whole listing and the whole status, and each re-read is the content
  // already published, so the tree is handed the very frames it holds.
  const heldPaths = h.paths;
  const heldStatus = h.gitStatus;
  for (let round = 0; round < 5; round++) await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toBe(heldPaths);
  expect(h.gitStatus).toBe(heldStatus);
});

it("lists 2,000 tracked files beside the gitignored overlay, with the overlay on", async () => {
  setShowIgnoredFiles(true);
  h.tracked = trackedPaths(2000);
  h.ignored = Array.from({ length: 300 }, (_, n) => `out/artifact-${n}.log`);
  h.local = changed(h.tracked.slice(0, 120), "M");
  h.branch = changed(h.tracked.slice(0, 250), "A");

  mount();
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual([...h.tracked, ...h.ignored]);
  expect(h.gitStatus).toEqual(decorations(h.local, h.branch));

  // One ignored artifact removed: the overlay shrinks by that row alone.
  h.ignored = h.ignored.slice(0, 299);
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual([...h.tracked, ...h.ignored]);
});

it("lists 400 changed files in each diff mode, decorated from that mode's layer", async () => {
  h.tracked = trackedPaths(2000);
  h.local = changed(h.tracked.slice(0, 400), "M");
  h.branch = changed(h.tracked.slice(100, 500), "A");
  setCodeMode("local");

  mount();
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual(h.local.map((f) => f.path));
  expect(h.gitStatus).toEqual(decorations(h.local, []));

  // The user switches to the branch diff: the other layer's changed files,
  // decorated from that layer alone.
  setCodeMode("branch");
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual(h.branch.map((f) => f.path));
  expect(h.gitStatus).toEqual(decorations(h.branch, []));

  // One file's status moves while the branch diff stands.
  h.branch = [
    { path: h.branch[0]?.path as string, status: "D" },
    ...h.branch.slice(1),
  ];
  await pump();

  expect(findings()).toEqual([]);
  expect(h.gitStatus).toEqual(decorations(h.branch, []));
});

it("lists a 400-entry root level for a folder git cannot list", async () => {
  // A bare repository's folder: no `git ls-files`, so the tree's one level
  // comes off the disk, and every folder in it is a lazy directory.
  subject = subjectListedBy("disk");
  h.diskRoot = [
    ...Array.from(
      { length: 300 },
      (_, n) => `blob-${String(n).padStart(3, "0")}`,
    ),
    ...Array.from(
      { length: 100 },
      (_, n) => `sub-${String(n).padStart(3, "0")}/`,
    ),
  ];

  mount();
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual(h.diskRoot);
  // No git layer to decorate a folder git cannot list.
  expect(h.gitStatus).toEqual([]);

  // One blob written into the folder.
  h.diskRoot = [...h.diskRoot, "blob-300"];
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual(h.diskRoot);
});

it("finds the picked file in a 400-row status to key the diff read", async () => {
  // The diff query's own input scans the active layer for the picked file's
  // row (it carries the rename's `oldPath`), so that scan is tracked by the
  // query's input memo — the whole list when the pick is the LAST row.
  h.tracked = trackedPaths(2000);
  h.local = changed(h.tracked.slice(0, 400), "M");
  h.local[399] = { path: h.tracked[399] as string, status: "R" };
  const picked = h.tracked[399] as string;
  setCodeMode("local");
  setPick(picked);

  mount();
  // Two pulses: the first lands the status the diff's input is keyed off, and
  // the second is the first frame of the pulse that input subscribed.
  await pump();
  await pump();

  expect(findings()).toEqual([]);
  expect(h.paths).toEqual(h.local.map((f) => f.path));
  expect(h.diffInputs.at(-1)).toEqual({
    repoPath: ROOT,
    filePath: picked,
    mode: "local",
    oldPath: undefined,
  });

  // The picked row gains its rename origin: the diff is re-keyed on it, and
  // nothing else about the read changes.
  h.local = [
    ...h.local.slice(0, 399),
    { path: picked, status: "R", oldPath: "src/mod-03/old-name.ts" } as never,
  ];
  // Again two: the re-keyed input subscribes a fresh pulse, and its first
  // frame is what re-reads the diff.
  await pump();
  await pump();

  expect(findings()).toEqual([]);
  expect(h.diffInputs.at(-1)).toEqual({
    repoPath: ROOT,
    filePath: picked,
    mode: "local",
    oldPath: "src/mod-03/old-name.ts",
  });
});
