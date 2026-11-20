import {
  GitFailed,
  WorktreeBaseBranchMissing,
} from "@kolu/padi-client/surface";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { encodeHostKey } from "kolu-common/hostKey";
import { batch, createEffect, createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PulseSubscription = {
  proc: unknown;
  input: string;
  emit: () => void;
};

const pulseCtl = vi.hoisted(() => ({
  repoProc: () => ({}),
  fileProc: () => ({}),
  subs: new Set<PulseSubscription>(),
}));
vi.mock("@kolu/surface/client", async () => {
  const { makeReplayingControllableStream } = await import(
    "./streamMock.testlib"
  );
  return {
    isTransportError: () => false,
    unenrolledStreamCall: (proc: unknown, input: unknown) => {
      const sub: {
        proc: unknown;
        input: string;
        emit: () => void;
      } = { proc, input: JSON.stringify(input), emit: () => {} };
      const { stream, push } = makeReplayingControllableStream({
        onTeardown: () => pulseCtl.subs.delete(sub),
      });
      sub.emit = () => push({ frame: true });
      pulseCtl.subs.add(sub);
      return stream;
    },
  };
});

const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
  repoRoot: (() => "/repo") as () => string | null,
  termId: (() => "t1") as () => string | null,
  mode: (() => "browse") as () => string,
  selected: (() => null) as () => string | null,
  counts: {} as Record<string, number>,
  previewTagInputs: [] as Array<{ repoPath: string; filePath: string }>,
  bare: (() => false) as () => boolean,
  listDirectoryInputs: [] as Array<{ repoPath: string; dirPath: string }>,
  branchFailure: null as Error | null,
  toastError: vi.fn(),
}));

vi.mock("../wire", async () => {
  const { mockPadiMap } = await import("../hostScope/mockHostMap.testlib");
  const activePadiRpc = {
    git: {
      getStatus: (i: { repoPath: string; mode: string }) =>
        Effect.suspend(() => {
          bag.counts[i.mode] = (bag.counts[i.mode] ?? 0) + 1;
          if (i.mode === "branch" && bag.branchFailure)
            return Effect.fail(bag.branchFailure);
          return Effect.succeed({
            files: [],
            label: `${encodeHostKey(bag.activeHost())}:${i.mode}`,
            n: bag.counts[i.mode],
          });
        }),
      getDiff: () => Effect.succeed({ hunks: [] }),
    },
    fs: {
      listAll: () =>
        Effect.sync(() => {
          bag.counts.listAll = (bag.counts.listAll ?? 0) + 1;
          return { paths: ["src/app.ts"] };
        }),
      listIgnored: () =>
        Effect.sync(() => {
          bag.counts.listIgnored = (bag.counts.listIgnored ?? 0) + 1;
          return { paths: ["node_modules/"] };
        }),
      readFile: () => Effect.succeed({ content: "", truncated: false }),
      listDirectory: (input: { repoPath: string; dirPath: string }) =>
        Effect.sync(() => {
          bag.listDirectoryInputs.push(input);
          return { paths: [".git/", ".worktrees/", "notes.md"] };
        }),
      filePreviewTag: (input: { repoPath: string; filePath: string }) =>
        Effect.sync(() => {
          bag.previewTagInputs.push(input);
          return "same-content-tag";
        }),
    },
  };
  const activePadiStreams = {
    subscribeRepoChange: { unenrolled: pulseCtl.repoProc },
    subscribeFileChange: { unenrolled: pulseCtl.fileProc },
  };
  return {
    padiMap: mockPadiMap,
    activeHost: () => bag.activeHost(),
    activePadiRpc,
    activePadiStreams,
  };
});

vi.mock("solid-sonner", () => ({ toast: { error: bag.toastError } }));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    focused: () => ({
      id: bag.termId(),
      meta: bag.repoRoot()
        ? {
            git: {
              kind: "repo",
              info: { repoRoot: bag.repoRoot(), isBare: bag.bare() },
            },
          }
        : null,
    }),
  }),
}));

vi.mock("./useRightPanel", () => ({
  useRightPanel: () => ({
    codeMode: () => bag.mode(),
    selectedFile: (_m: string) => bag.selected(),
  }),
}));

import {
  addHost,
  removeHost,
  resetHosts,
} from "../hostScope/mockHostMap.testlib";
import {
  leaseCodeQueries,
  codeActiveStatus,
  codeAllPaths,
  codeDiskRootLevel,
  codeFileContent,
  codeLocalStatus,
} from "./hostCodeTab";
import { setShowIgnoredFiles } from "./showIgnoredFiles";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pulse = () => {
  for (const sub of [...pulseCtl.subs]) sub.emit();
};
const filePulse = (input: { repoPath: string; filePath: string }) => {
  const serialized = JSON.stringify(input);
  for (const sub of [...pulseCtl.subs]) {
    if (sub.proc === pulseCtl.fileProc && sub.input === serialized) sub.emit();
  }
};
const liveFileInputs = () =>
  [...pulseCtl.subs]
    .filter((sub) => sub.proc === pulseCtl.fileProc)
    .map((sub) => JSON.parse(sub.input) as unknown);

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;

const [driveTermId, setDriveTermId] = createSignal<string | null>("t1");
const [driveRepo, setDriveRepo] = createSignal<string | null>("/repo");
bag.termId = driveTermId;
bag.repoRoot = driveRepo;

function switchTo(host: HostKey): void {
  batch(() => {
    addHost(host);
    setDriveHost(host);
  });
}

const read = () =>
  codeLocalStatus() as { label: string; n: number } | undefined;
const label = () => read()?.label;

const [codeShown, setCodeShown] = createSignal(true);
let releaseLease: () => void;
afterEach(async () => {
  releaseLease();
  resetHosts();
  await flush();
});
beforeEach(async () => {
  resetHosts();
  await flush();
  setDriveHost(HOST_A);
  setDriveTermId("t1");
  setDriveRepo("/repo");
  bag.counts = {};
  bag.previewTagInputs = [];
  bag.bare = () => false;
  bag.listDirectoryInputs = [];
  bag.branchFailure = null;
  bag.toastError.mockClear();
  bag.mode = () => "browse";
  bag.selected = () => null;
  setCodeShown(true);
  createRoot((dispose) => {
    releaseLease = dispose;
    leaseCodeQueries(codeShown);
  });
  void codeLocalStatus.pending();
});

describe("hostCodeTab — per-host query ownership (padi W9)", () => {
  it("retains each host's Code-tab query across switch-away, resumes with no blank, and refreshes on return", async () => {
    switchTo(HOST_A);
    await flush();
    pulse();
    await flush();
    expect(label()).toBe("local:local");
    const aLoads = read()?.n ?? 0;

    switchTo(HOST_B);
    await flush();
    expect(codeLocalStatus.pending()).toBe(true);
    pulse();
    await flush();
    expect(label()).toBe("remote:B:local");

    switchTo(HOST_A);
    await flush();
    expect(codeLocalStatus.pending()).toBe(false);
    expect(label()).toBe("local:local");
    pulse();
    await flush();
    expect(read()?.n ?? 0).toBeGreaterThan(aLoads);
  });

  it("disposes a host's Code-tab query when it leaves the pool (a re-add rebuilds fresh)", async () => {
    switchTo(HOST_A);
    await flush();
    pulse();
    await flush();
    expect(label()).toBe("local:local");

    switchTo(HOST_B);
    await flush();
    pulse();
    await flush();
    removeHost(HOST_A);
    await flush();

    switchTo(HOST_A);
    await flush();
    expect(codeLocalStatus.pending()).toBe(true);
  });

  it("retains the value across a CONSUMER unmount/remount — the app-lifetime owner (defect 1 + 2)", async () => {
    switchTo(HOST_A);
    await flush();

    let seen1: string | undefined;
    const dispose1 = createRoot((d) => {
      createEffect(() => {
        seen1 = read()?.label;
      });
      return d;
    });
    await flush();
    pulse();
    await flush();
    expect(label()).toBe("local:local");
    expect(seen1).toBe("local:local");

    dispose1();
    await flush();

    let seen2: string | undefined;
    const dispose2 = createRoot((d) => {
      createEffect(() => {
        seen2 = read()?.label;
      });
      return d;
    });
    await flush();
    expect(codeLocalStatus.pending()).toBe(false);
    expect(label()).toBe("local:local");
    expect(seen2).toBe("local:local");
    dispose2();
  });

  it("a BACKGROUND host's Code-tab value survives while the active host's tab is unmounted (mode-transit wipe)", async () => {
    switchTo(HOST_A);
    await flush();
    pulse();
    await flush();
    switchTo(HOST_B);
    await flush();
    pulse();
    await flush();
    expect(label()).toBe("remote:B:local");

    await flush();

    switchTo(HOST_A);
    await flush();
    expect(codeLocalStatus.pending()).toBe(false);
    expect(label()).toBe("local:local");
  });

  it("a watcher pulse re-queries an unchanged preview tag and yields the same tag", async () => {
    bag.selected = () => "report.html";
    switchTo(HOST_A);
    void codeFileContent.pending();
    await flush();

    const input = { repoPath: "/repo", filePath: "report.html" };
    expect(liveFileInputs()).toEqual([input]);
    filePulse(input);
    await flush();
    const before = codeFileContent();
    filePulse(input);
    await flush();
    const after = codeFileContent();

    expect(bag.previewTagInputs).toEqual([input, input]);
    expect(before).toEqual(after);
    expect(after).toMatchObject({
      kind: "binary",
      previewTag: "same-content-tag",
    });
  });

  it("re-keys the file watcher when an in-preview navigation changes the selected path", async () => {
    const [selected, setSelected] = createSignal("dist/index.html");
    bag.selected = selected;
    switchTo(HOST_A);
    void codeFileContent.pending();
    await flush();

    const indexInput = { repoPath: "/repo", filePath: "dist/index.html" };
    const secondInput = { repoPath: "/repo", filePath: "dist/second.html" };
    expect(liveFileInputs()).toEqual([indexInput]);
    filePulse(indexInput);
    await flush();
    expect(bag.previewTagInputs).toEqual([indexInput]);

    setSelected("dist/second.html");
    await flush();
    expect(liveFileInputs()).toEqual([secondInput]);

    filePulse(indexInput);
    filePulse(secondInput);
    await flush();
    expect(bag.previewTagInputs).toEqual([indexInput, secondInput]);
  });

  it("flipping the show-ignored toggle leaves the main file list untouched — no blank, no re-query", async () => {
    switchTo(HOST_A);
    void codeAllPaths.pending();
    await flush();
    pulse();
    await flush();

    const settled = codeAllPaths();
    expect(settled?.paths).toEqual(["src/app.ts"]);
    const queriesBefore = bag.counts.listAll;
    expect(queriesBefore).toBeGreaterThan(0);

    setShowIgnoredFiles(true);
    await flush();

    expect(codeAllPaths()?.paths).toEqual(["src/app.ts"]);
    expect(codeAllPaths.pending()).toBe(false);
    expect(bag.counts.listAll).toBe(queriesBefore);

    setShowIgnoredFiles(false);
    await flush();
    expect(codeAllPaths()?.paths).toEqual(["src/app.ts"]);
    expect(codeAllPaths.pending()).toBe(false);
    expect(bag.counts.listAll).toBe(queriesBefore);
  });

  it("a pane switch inside one repo re-dispatches NOTHING and never blanks", async () => {
    switchTo(HOST_A);
    void codeAllPaths.pending();
    await flush();
    pulse();
    await flush();
    expect(codeAllPaths()?.paths).toEqual(["src/app.ts"]);
    const reads = bag.counts.listAll;
    expect(reads).toBeGreaterThan(0);

    setDriveTermId("t2");
    await flush();

    expect(bag.counts.listAll).toBe(reads);
    expect(codeAllPaths.pending()).toBe(false);
    expect(codeAllPaths()?.paths).toEqual(["src/app.ts"]);
  });

  it("a REPO change still blanks the listing and re-queries it", async () => {
    switchTo(HOST_A);
    void codeAllPaths.pending();
    await flush();
    pulse();
    await flush();
    const reads = bag.counts.listAll ?? 0;
    expect(reads).toBeGreaterThan(0);

    setDriveRepo("/other-repo");
    await flush();
    expect(codeAllPaths.pending()).toBe(true);

    pulse();
    await flush();
    expect(bag.counts.listAll).toBeGreaterThan(reads);
    expect(codeAllPaths()?.repoRoot).toBe("/other-repo");
  });
});

it("pauses hidden Code queries and retains the browse snapshot through mode switches", async () => {
  const [mode, setMode] = createSignal<"browse" | "local">("browse");
  bag.mode = mode;
  bag.selected = () => "src/app.ts";
  setShowIgnoredFiles(true);
  switchTo(HOST_A);
  await flush();
  pulse();
  await flush();
  const held = codeAllPaths();
  expect(held?.paths).toEqual(["src/app.ts"]);
  const reads = bag.counts.listAll;
  const ignoredReads = bag.counts.listIgnored;
  const content = codeFileContent();
  expect(content).toBeDefined();
  setMode("local");
  await flush();
  pulse();
  await flush();
  expect(codeAllPaths()).toBe(held);
  expect(bag.counts.listAll).toBe(reads);
  expect(bag.counts.listIgnored).toBe(ignoredReads);
  expect(codeFileContent()).toBe(content);
  setMode("browse");
  await flush();
  expect(codeAllPaths()).toBe(held);
  expect(codeAllPaths.pending()).toBe(false);
  setCodeShown(false);
  await flush();
  pulse();
  await flush();
  expect(codeAllPaths()).toBe(held);
  expect(bag.counts.listAll).toBe(reads);
  expect(bag.counts.listIgnored).toBe(ignoredReads);
  expect(codeFileContent()).toBe(content);
  setCodeShown(true);
});

it("one hidden or disposed consumer cannot pause another shown Code view", async () => {
  switchTo(HOST_A);
  let releaseOther!: () => void;
  createRoot((dispose) => {
    releaseOther = dispose;
    leaseCodeQueries(() => true);
  });
  setCodeShown(false);
  await flush();
  pulse();
  await flush();
  const reads = bag.counts.listAll;
  expect(reads).toBeGreaterThan(0);
  pulse();
  await flush();
  expect(bag.counts.listAll).toBeGreaterThan(reads!);
  releaseOther();
  await flush();
  const paused = bag.counts.listAll;
  pulse();
  await flush();
  expect(bag.counts.listAll).toBe(paused);
});

describe("a folder git cannot list (a bare repository's)", () => {
  it("reads the root level from disk and never asks git for a list or a status", async () => {
    bag.bare = () => true;
    setShowIgnoredFiles(true);
    switchTo(HOST_A);
    void codeDiskRootLevel.pending();
    void codeAllPaths.pending();
    await flush();
    pulse();
    await flush();

    expect(codeDiskRootLevel()).toEqual({
      repoRoot: "/repo",
      paths: [".git/", ".worktrees/", "notes.md"],
    });
    expect(bag.listDirectoryInputs).toEqual([
      { repoPath: "/repo", dirPath: "" },
    ]);
    expect(bag.counts.listAll).toBeUndefined();
    expect(bag.counts.listIgnored).toBeUndefined();
    expect(bag.counts.local).toBeUndefined();
    expect(bag.counts.branch).toBeUndefined();
    expect(bag.toastError).not.toHaveBeenCalled();

    const reads = bag.listDirectoryInputs.length;
    setDriveTermId("t2");
    await flush();
    expect(bag.listDirectoryInputs.length).toBe(reads);
    expect(codeDiskRootLevel.pending()).toBe(false);
    setShowIgnoredFiles(false);
  });

  it("a checkout never reads its root from disk", async () => {
    switchTo(HOST_A);
    void codeDiskRootLevel.pending();
    void codeAllPaths.pending();
    await flush();
    pulse();
    await flush();
    expect(codeAllPaths()?.paths).toEqual(["src/app.ts"]);
    expect(bag.listDirectoryInputs).toEqual([]);
  });
});

describe("a Branch comparison whose base branch was never fetched", () => {
  const sentence =
    "No base branch found — origin/master doesn't exist. Run: git fetch origin && git remote set-head origin --auto";

  it("raises no toast, and the Branch view reports the sentence instead of loading forever", async () => {
    bag.branchFailure = new WorktreeBaseBranchMissing({ detail: sentence });
    bag.mode = () => "branch";
    switchTo(HOST_A);
    void codeActiveStatus.pending();
    await flush();
    pulse();
    await flush();

    expect(codeActiveStatus.error()?.message).toBe(sentence);
    expect(codeActiveStatus.pending()).toBe(false);
    expect(bag.toastError).not.toHaveBeenCalled();
  });

  it("any other branch failure still toasts", async () => {
    bag.branchFailure = new GitFailed({ detail: "fatal: bad object" });
    switchTo(HOST_A);
    void codeActiveStatus.pending();
    await flush();
    pulse();
    await flush();
    expect(bag.toastError).toHaveBeenCalledWith(
      "Git status stream: fatal: bad object",
    );
  });
});
