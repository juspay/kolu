// @vitest-environment happy-dom
/** WHAT THE TREE IS HANDED, ACROSS A PULSE THAT CHANGED NOTHING.
 *
 *  A git watcher pulses, a listing re-emits and the subject is rebuilt whether
 *  or not anything moved. Each of those re-derives a container from unchanged
 *  leaves, and the view pays for a new reference even where Pierre does not:
 *  a `gitStatus` set re-runs the wrapper's `setGitStatus` effect and is
 *  hashed again before Pierre recognizes it as the state it already holds
 *  (`@pierre/trees` `dist/model/gitStatus.js:20-23`), an
 *  `expandPaths`/`lazyDirectories` list re-drives the expansion reconcile. So
 *  the view's job here is to hand the SAME reference back when the facts are
 *  the same — which is what the mocked tree records, and what Solid's
 *  `UNSTABLE_MEMO_OUTPUT` diagnostic (four equal publishes) fails the test
 *  over when it does not. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { Subscription } from "@kolu/surface/solid";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, expect, it, vi } from "vitest";
import { Shown } from "../ui/shown";
import type { BrowseFileContent, CodeQueries } from "./codeQueries";
import type { CodeSubject } from "./codeSubject";
import { codeOwner } from "./codeTabOpenController";
import type { CodeViewState } from "./codeViewState";
import type { CodeDoor } from "./codeDoor";

const h = vi.hoisted(() => ({
  /** Every reference the tree was handed on each of the three channels, in
   *  order — one entry per notification, so a re-run handing back the same
   *  array is visible as a repeat rather than hidden by de-duplication. */
  gitStatus: [] as unknown[],
  expandPaths: [] as unknown[],
  lazyDirectories: [] as unknown[],
}));

vi.mock("@kolu/solid-pierre", async () => {
  // The mock factory is hoisted above this file's own imports, so the one
  // primitive it needs is bound here rather than at the top.
  const { createRenderEffect } = await import("solid-js");
  return {
    FileTree: (props: {
      gitStatus: unknown;
      expandPaths: unknown;
      lazyDirectories: unknown;
    }) => {
      // One effect per channel: each records what IT was handed, so a churning
      // neighbour cannot be mistaken for churn on this one. The compute reads
      // the prop and the effect records it, which is Solid 2's split.
      createRenderEffect(
        () => props.gitStatus,
        (value) => {
          h.gitStatus.push(value);
        },
      );
      createRenderEffect(
        () => props.expandPaths,
        (value) => {
          h.expandPaths.push(value);
        },
      );
      createRenderEffect(
        () => props.lazyDirectories,
        (value) => {
          h.lazyDirectories.push(value);
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
  default: (props: { content: string }) => (
    <pre data-testid="source-view">{props.content}</pre>
  ),
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
vi.mock("../wire", () => ({ padiRpcOf: () => ({}) }));
vi.mock("solid-sonner", () => ({
  toast: { error: () => {}, success: () => {} },
}));

import CodeTab from "./CodeTab";

const ROOT = "/srv/code/kestrel/.worktrees/export";

/** A settled read holding a fixed `value`. */
const settled = <T,>(value: T | undefined): Subscription<T> =>
  Object.assign(() => value, {
    pending: () => false,
    error: () => undefined,
    complete: () => false,
  });

/** A settled read whose value a test re-emits. `Status | Listing` rather than
 *  a free type parameter: `createSignal`'s value overload excludes a function,
 *  which an unconstrained parameter cannot satisfy. */
const feed = <T extends Status | Listing>(initial: T) => {
  const [value, setValue] = createSignal<Status | Listing>(initial);
  return [
    Object.assign(() => value() as T, {
      pending: () => false,
      error: () => undefined,
      complete: () => false,
    }) as Subscription<T>,
    // The updater form: the setter's value overload excludes a function too.
    (next: T) => setValue(() => next),
  ] as const;
};

type Listing = { repoRoot: string; paths: string[] };
type Status = { mode: string; files: { path: string; status: string }[] };

const statusOf = (): Status => ({
  mode: "local",
  files: [{ path: "src/ledger.rs", status: "M" }],
});

const TEXT: BrowseFileContent = {
  kind: "text",
  content: "plain words",
  truncated: false,
};

const state = (): CodeViewState => {
  const [codeMode, setCodeMode] = createSignal<CodeTabView>("browse");
  return {
    codeMode,
    setCodeMode,
    selectedFile: (m) => (m === "browse" ? "notes.txt" : null),
    setSelectedFile: () => {},
    recordNavigation: () => {},
    navigateBack: () => null,
    navigateForward: () => null,
    canNavigateBack: () => false,
    canNavigateForward: () => false,
  };
};

const subjectWith = (): CodeSubject => ({
  owner: codeOwner("test-view", "export"),
  host: { kind: "local" },
  git: { kind: "repo", root: ROOT, lister: "git" },
  terminalId: "term-1" as TerminalId,
  comments: null,
});

const door: CodeDoor = { pending: () => null, open: () => {} };

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.innerHTML = "";
  h.gitStatus.length = 0;
  h.expandPaths.length = 0;
  h.lazyDirectories.length = 0;
  localStorage.clear();
});

/** Every recorded reference is the same object. */
const oneReference = (recorded: unknown[]) => {
  expect(recorded.length).toBeGreaterThan(0);
  expect(new Set(recorded).size).toBe(1);
};

it("hands the tree one gitStatus, expandPaths and lazyDirectories reference across pulses that changed nothing", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const [localStatus, pulseStatus] = feed<Status>(statusOf());
  const [allPaths, relist] = feed<Listing>({
    repoRoot: ROOT,
    paths: ["notes.txt", "src/ledger.rs"],
  });
  const [subject, resubject] = createSignal(subjectWith());
  const queries: CodeQueries = {
    localStatus: localStatus as never,
    branchStatus: settled<never>(undefined),
    activeStatus: localStatus as never,
    allPaths: allPaths as never,
    diskRootLevel: settled<never>(undefined),
    ignoredPaths: settled<never>(undefined),
    diff: settled<never>(undefined),
    fileContent: settled(TEXT),
    lease: () => {},
  };
  const place = state();
  dispose = render(
    () => (
      <Shown value={() => true}>
        <CodeTab
          subject={subject()}
          state={place}
          queries={queries}
          door={door}
          arrangement="stacked"
        />
      </Shown>
    ),
    host,
  );
  flush();

  // Five rounds: the threshold the diagnostic fails on is four consecutive
  // equal publishes, so four re-emissions after the first paint clear it only
  // if nothing republishes at all.
  for (let round = 0; round < 5; round++) {
    // A watcher pulse carrying an identical status: an equal-but-fresh merge.
    pulseStatus(statusOf());
    // A listing re-read whose path set really did change — the genuine change
    // that used to carry a fresh empty `expandedAncestors` and `lazyDirs`
    // through to Pierre with it.
    relist({
      repoRoot: ROOT,
      paths: ["notes.txt", `src/ledger-${round}.rs`],
    });
    // The subject rebuilt around the same host and terminal.
    resubject(subjectWith());
    flush();
  }

  oneReference(h.gitStatus);
  oneReference(h.expandPaths);
  oneReference(h.lazyDirectories);
});

it("hands the tree the same frame when a pulse re-emits the SAME paths", () => {
  // THE PULSE THAT CHANGED NOTHING — the drive the case above deliberately
  // does not make, since it moves the path set each round and so resets the
  // unstable-output streak. Here the listing, the status and the subject are
  // re-emitted unchanged, which is what a watcher does between edits: the
  // frozen frame the tree is handed must then be the same frame, not a fresh
  // container whose eight leaves are all the previous one's.
  const host = document.createElement("div");
  document.body.append(host);
  const [localStatus, pulseStatus] = feed<Status>(statusOf());
  const [allPaths, relist] = feed<Listing>({
    repoRoot: ROOT,
    paths: ["notes.txt", "src/ledger.rs"],
  });
  const [subject, resubject] = createSignal(subjectWith());
  const queries: CodeQueries = {
    localStatus: localStatus as never,
    branchStatus: settled<never>(undefined),
    activeStatus: localStatus as never,
    allPaths: allPaths as never,
    diskRootLevel: settled<never>(undefined),
    ignoredPaths: settled<never>(undefined),
    diff: settled<never>(undefined),
    fileContent: settled(TEXT),
    lease: () => {},
  };
  const place = state();
  dispose = render(
    () => (
      <Shown value={() => true}>
        <CodeTab
          subject={subject()}
          state={place}
          queries={queries}
          door={door}
          arrangement="stacked"
        />
      </Shown>
    ),
    host,
  );
  flush();

  // Five equal republishes: the streak the diagnostic answers on is four
  // consecutive equivalent publishes, so a drive that stopped at the
  // threshold could be silenced by dropping one pulse.
  for (let round = 0; round < 5; round++) {
    pulseStatus(statusOf());
    relist({ repoRoot: ROOT, paths: ["notes.txt", "src/ledger.rs"] });
    resubject(subjectWith());
    flush();
  }

  oneReference(h.gitStatus);
  oneReference(h.expandPaths);
  oneReference(h.lazyDirectories);
  expect(takeSolidDiagnostics()).toEqual([]);
});
