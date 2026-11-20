// @vitest-environment happy-dom
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitStatusEntry } from "@pierre/trees";

const { pierre } = vi.hoisted(() => ({
  pierre: {
    emit: (_paths: readonly string[]) => {},
    initialGitStatus: undefined as GitStatusEntry[] | undefined,
  },
}));

vi.mock("@pierre/trees", () => {
  class MockFileTree {
    // biome-ignore lint/suspicious/noExplicitAny: test double for Pierre's options
    constructor(opts: any) {
      const onSel = opts?.onSelectionChange;
      pierre.emit = (paths) => onSel?.(paths);
      pierre.initialGitStatus = opts?.gitStatus;
    }
    render() {}
    getSelectedPaths(): readonly string[] {
      return [];
    }
    getItem() {
      return { select() {}, deselect() {} };
    }
    scrollToPath() {}
    subscribe() {
      return () => {};
    }
    batch() {}
    setGitStatus() {}
    cleanUp() {}
  }
  return { FileTree: MockFileTree };
});

import { FileTree } from "./FileTree";

const PATHS = ["examples/Main.lean", "examples/Storage.lean"];
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

function mount(
  onSelect: (p: string | null) => void,
  gitStatus?: GitStatusEntry[],
): HTMLElement {
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);
  const dispose = render(
    () => (
      <FileTree
        paths={PATHS}
        gitStatus={gitStatus}
        onSelect={onSelect}
        onError={(e) => {
          throw e;
        }}
      />
    ),
    wrapper,
  );
  disposers.push(dispose, () => wrapper.remove());
  return wrapper.querySelector(
    '[data-testid="pierre-file-tree"]',
  ) as HTMLElement;
}

describe("FileTree selection provenance (shimmer #1841)", () => {
  it("DROPS an autonomous onSelectionChange — the echo loop can't reach the host", () => {
    const onSelect = vi.fn();
    mount(onSelect);
    pierre.emit(["examples/Storage.lean"]);
    pierre.emit(["examples/Main.lean"]);
    pierre.emit(["examples/Storage.lean"]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("forwards a click whose selection Pierre emits on a DEFERRED microtask (#1846)", async () => {
    const onSelect = vi.fn();
    const tree = mount(onSelect);
    tree.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    await Promise.resolve();
    pierre.emit(["examples/Main.lean"]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("examples/Main.lean");
  });

  it("re-arms per gesture — the token is single-use, not sticky", () => {
    const onSelect = vi.fn();
    const tree = mount(onSelect);
    tree.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    pierre.emit(["examples/Main.lean"]);
    pierre.emit(["examples/Storage.lean"]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("examples/Main.lean");
  });

  it("arms in CAPTURE phase — a row whose own handler emits mid-dispatch is still forwarded", () => {
    const onSelect = vi.fn();
    const tree = mount(onSelect);
    const row = document.createElement("button");
    tree.appendChild(row);
    row.addEventListener("click", () => pierre.emit(["examples/Main.lean"]));
    row.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("examples/Main.lean");
  });

  it("disarms on the next frame — a non-selecting gesture leaves no stale token for a later echo", () => {
    const onSelect = vi.fn();
    const tree = mount(onSelect);
    const frames: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }) as typeof requestAnimationFrame;
    try {
      tree.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true }),
      );
      for (const cb of frames.splice(0)) cb(0);
      pierre.emit(["examples/Storage.lean"]);
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      globalThis.requestAnimationFrame = realRaf;
    }
  });
});

describe("FileTree initial git status", () => {
  it("passes initial git status into Pierre's constructor", () => {
    const gitStatus: GitStatusEntry[] = [
      { path: "examples/Main.lean", status: "modified" },
    ];

    mount(() => {}, gitStatus);

    expect(pierre.initialGitStatus).toEqual(gitStatus);
  });
});
