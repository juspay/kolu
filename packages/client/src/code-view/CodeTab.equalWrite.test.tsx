// @vitest-environment happy-dom
/** A FILE-SEARCH WRITE THAT ASKS THE CODE VIEW FOR WHAT IT ALREADY HOLDS.
 *
 *  The filename filter is held as ONE composite value — the needle together
 *  with the repo slot it was typed for — so a slot switch reads the default
 *  without a write one flush behind it. A composite value is minted, and a
 *  freshly minted object is never equal to the one it replaces: retyping the
 *  same query, or clearing a filter that is already clear, would wake every
 *  reader of the projected tree even though nothing about the search changed.
 *  A plain needle signal ignored such a write for free.
 *
 *  So the equality lives at the source: the setter hands back the value it
 *  holds when the slot and the needle both match. These tests count the
 *  projected tree's re-runs through the engine's own attribution records and
 *  require zero of them, with the shown search state — the field's text and
 *  the paths the tree was handed — unchanged and no diagnostic raised.
 */

import type { CodeTabView } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush, OBSERVE } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Shown } from "../ui/shown";
import type { CodeQueries } from "./codeQueries";
import type { CodeSubject } from "./codeSubject";
import { codeOwner } from "./codeTabOpenController";
import type { CodeDoor } from "./codeDoor";
import type { CodeViewState } from "./codeViewState";

/** What the mocked host answers for this repository, and what the tree was
 *  last handed. Hoisted, because the module mocks below are hoisted above
 *  this file's own imports. */
const h = vi.hoisted(() => ({
  /** `fs.listAll` — every tracked path, in listing order. */
  tracked: [] as string[],
  /** Every pulse stream opened, as its frame pusher. */
  pulses: [] as Array<(event: { frame: true }) => void>,
  /** What `<FileTree>` was last handed on its paths channel. */
  paths: undefined as unknown,
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
  const rpc = () => ({
    fs: {
      listAll: () => Effect.succeed({ paths: [...h.tracked] }),
      listIgnored: () => Effect.succeed({ paths: [] }),
      listDirectory: () => Effect.succeed({ paths: [] }),
      readFile: () => Effect.succeed({ content: "", truncated: false }),
      filePreviewTag: () => Effect.succeed("tag"),
    },
    git: {
      getStatus: () =>
        Effect.succeed({
          mode: "local",
          files: [],
          branch: { name: "work", upstream: null, ahead: 0, behind: 0 },
          workingTree: { staged: 0, modified: 0, untracked: 0 },
        }),
      getDiff: () =>
        Effect.succeed({
          oldFileName: "",
          newFileName: "",
          hunks: [],
          binary: false,
        }),
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
    FileTree: (props: { paths: unknown }) => {
      createRenderEffect(
        () => props.paths,
        (value) => {
          h.paths = value;
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

const ROOT = "/srv/code/kestrel/.worktrees/export";

/** HOW MANY TIMES A NAMED NODE HAS RUN — the engine's own `rerun` record,
 *  subscribed at module load so no run is missed. */
const runs = new Map<string, number>();
if (OBSERVE === undefined)
  throw new Error("this file needs Solid's development build");
OBSERVE.records.subscribe("rerun", (event) => {
  runs.set(event.nodeName, (runs.get(event.nodeName) ?? 0) + 1);
});
const ranFor = (name: string): number => runs.get(name) ?? 0;

/** Every finding Solid raised, as its grade, code and sentence — so an `info`
 *  shows in the failure beside a `warn`. */
const findings = (): string[] =>
  takeSolidDiagnostics().map(
    (event) =>
      `[${event.severity ?? "(no severity)"}] ${event.code} ${event.message}`,
  );

const [codeMode, setCodeMode] = createSignal<CodeTabView>("browse");
const place: CodeViewState = {
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

const subject: CodeSubject = {
  owner: codeOwner("test-view", "export"),
  host: { kind: "local" },
  git: { kind: "repo", root: ROOT, lister: "git" },
  terminalId: "term-1" as TerminalId,
  comments: null,
};

const door: CodeDoor = { pending: () => null, open: () => {} };

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  h.tracked = [];
  h.pulses.length = 0;
  h.paths = undefined;
  setCodeMode("browse");
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
 *  that makes each query read. */
const pump = async (): Promise<void> => {
  for (const push of [...h.pulses]) push({ frame: true });
  for (let tick = 0; tick < 8; tick++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  flush();
};

const field = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>(
    '[data-testid="diff-filter-search"]',
  );
  if (!el) throw new Error("the code view drew no file-search input");
  return el;
};

/** A needle, as the toolbar's input reports it. */
const type = (needle: string): void => {
  const el = field();
  el.value = needle;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
};

const TRACKED = [
  "src/mod-00/alpha.ts",
  "src/mod-00/beta.ts",
  "src/mod-01/alpha-helper.ts",
  "docs/readme.md",
];

it("wakes no reader when the search is handed the needle it already holds", async () => {
  h.tracked = [...TRACKED];
  mount();
  await pump();

  type("alpha");
  await pump();
  const shownPaths = h.paths;
  expect(field().value, "the needle is typed").toBe("alpha");
  expect(shownPaths, "the tree is filtered to the matches").toEqual([
    "src/mod-00/alpha.ts",
    "src/mod-01/alpha-helper.ts",
  ]);
  findings();

  const before = ranFor("codeTabTreeSearch");
  // The same text, reported again — an IME commit, an autofill, or a
  // re-type of the character just deleted all land here.
  type("alpha");

  expect(
    ranFor("codeTabTreeSearch") - before,
    "the projected tree's memo",
  ).toBe(0);
  expect(field().value, "the same needle is still shown").toBe("alpha");
  expect(h.paths, "the same filtered tree is still shown").toBe(shownPaths);
  expect(findings(), "the equal search write").toEqual([]);
});

it("wakes no reader when a clear is handed a filter that is already clear", async () => {
  h.tracked = [...TRACKED];
  mount();
  await pump();

  const shownPaths = h.paths;
  expect(field().value, "nothing is typed yet").toBe("");
  expect(shownPaths, "the whole tree is shown").toEqual(TRACKED);
  findings();

  const before = ranFor("codeTabTreeSearch");
  // Clearing a filter that holds nothing — what a folder reveal does before
  // it expands, so the target row is never hidden by a stale needle.
  type("");

  expect(
    ranFor("codeTabTreeSearch") - before,
    "the projected tree's memo",
  ).toBe(0);
  expect(field().value, "the field is still empty").toBe("");
  expect(h.paths, "the whole tree is still shown").toBe(shownPaths);
  expect(findings(), "the equal clear write").toEqual([]);
});
