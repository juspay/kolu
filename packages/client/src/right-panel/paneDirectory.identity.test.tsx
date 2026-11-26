// @vitest-environment happy-dom
/** The pane header line reads the WHOLE metadata record, which is a store
 *  proxy: an agent tick, a foreground title, a port reading all re-run the
 *  fold, and the fold mints a fresh `{ root, rest, full }` every time. Without
 *  an equality gate the header's `<Show>` republishes an equal-but-new value —
 *  UNSTABLE_MEMO_OUTPUT on the condition, and the line's subtree re-evaluated
 *  for a directory that never moved. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./useRightPanel", () => ({
  useRightPanel: () => ({
    activeTab: () => ({ kind: "inspector" }),
    showInspector: () => {},
    showCode: () => {},
    syncRepo: () => {},
  }),
}));
vi.mock("./hostCodeTab", () => ({
  rightPanelCodeSubject: () => ({
    terminalId: null,
    git: { kind: "unresolved" },
  }),
  rightPanelCodeQueries: {},
}));
vi.mock("./openInCodeTab", () => ({ rightPanelCodeDoor: () => () => {} }));
vi.mock("../code-view/CodeTab", () => ({ default: () => null }));
vi.mock("./MetadataInspector", () => ({ default: () => null }));
vi.mock("../ui/shown", () => ({
  Shown: (props: { children: unknown }) => props.children,
}));

import RightPanel from "./RightPanel";

const ID = "pane-1" as TerminalId;

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it("an unrelated metadata tick does not republish the pane header", () => {
  // The leaf that ticks is the foreground title — nothing the directory line
  // reads.
  const [title, setTitle] = createSignal("vim");
  const meta = (): TerminalMetadata => ({
    state: "active",
    cwd: "/home/u/repo/src",
    git: {
      kind: "repo",
      info: {
        repoRoot: "/home/u/repo",
        repoName: "repo",
        worktreePath: "/home/u/repo",
        branch: "main",
        isWorktree: false,
        mainRepoRoot: "/home/u/repo",
        remoteUrl: null,
        isBare: false,
      },
    },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: { name: title(), title: null, shell: false },
    ports: { status: "unknown" },
    lastActivityAt: null,
    promptedAt: null,
  });

  const host = document.createElement("div");
  dispose = render(
    () => (
      <RightPanel
        terminalId={ID}
        meta={meta()}
        tileId={ID}
        onToggle={() => {}}
        visible={true}
      />
    ),
    host,
  );
  const line = () =>
    host.querySelector<HTMLElement>('[data-testid="right-panel"] bdi');
  const first = line();
  expect(first?.textContent).toContain("repo");

  for (let tick = 1; tick <= 5; tick++) {
    setTitle(`vim-${tick}`);
    flush();
  }

  // Same element, same words: the header never re-rendered.
  expect(line()).toBe(first);
  expect(line()?.textContent).toContain("repo");
});
