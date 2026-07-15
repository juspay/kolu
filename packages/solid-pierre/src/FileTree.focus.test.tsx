// @vitest-environment happy-dom
/**
 * Regression for the Code-tab file-tree "shimmer" — juspay/kolu#1841.
 *
 * The wrapper's selection effect re-applies `props.selectedPath` into Pierre and
 * reveals the row with `scrollToPath`. Calling it with NO options makes Pierre
 * DRAG keyboard focus onto the row — `FileTreeController.scrollToPath` runs
 * `if (options?.focus !== false) this.#setFocusedIndex(...)`. On the live app that
 * focus move makes Pierre re-emit `onSelectionChange` reporting the NEIGHBOUR row,
 * which the host writes back into the per-terminal selection store, which re-runs
 * this effect — a self-sustaining focus/selection loop between two adjacent files
 * at ~60-120 Hz. A Chrome profile of the live loop shows `HTMLElement.focus()` as
 * the single hottest leaf, rooted in Pierre's render.
 *
 * The fix: reveal the row WITHOUT stealing focus — `scrollToPath(path,
 * { focus: false })`. This test pins that invariant; it FAILS on the pre-fix code
 * (bare `scrollToPath(path)`).
 */
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for `@pierre/trees`' `FileTree`: it models only what the wrapper
// touches. `scrollToPath` is a shared spy so the test can inspect the options the
// wrapper passes. Selecting/deselecting re-emits `onSelectionChange` synchronously,
// exactly as Pierre's `#applySelection` does.
const { scrollToPath } = vi.hoisted(() => ({ scrollToPath: vi.fn() }));

vi.mock("@pierre/trees", () => {
  class MockFileTree {
    #selected = new Set<string>();
    #onSel?: (paths: readonly string[]) => void;
    // biome-ignore lint/suspicious/noExplicitAny: test double for Pierre's options
    constructor(opts: any) {
      this.#onSel = opts?.onSelectionChange;
      for (const p of opts?.initialSelectedPaths ?? []) this.#selected.add(p);
    }
    render() {}
    getSelectedPaths(): readonly string[] {
      return [...this.#selected];
    }
    getItem(path: string) {
      // A file handle (no `expand`, so `expandDirs`' `"expand" in item` skips it).
      return {
        select: () => {
          this.#selected.add(path);
          this.#emit();
        },
        deselect: () => {
          this.#selected.delete(path);
          this.#emit();
        },
      };
    }
    scrollToPath = scrollToPath;
    batch() {}
    setGitStatus() {}
    cleanUp() {}
    #emit() {
      this.#onSel?.(this.getSelectedPaths());
    }
  }
  return { FileTree: MockFileTree };
});

// Import AFTER the mock so the wrapper closes over the mocked class.
import { FileTree } from "./FileTree";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  scrollToPath.mockReset();
});

function mount(node: () => unknown): void {
  const container = document.createElement("div");
  document.body.appendChild(container);
  // biome-ignore lint/suspicious/noExplicitAny: render's JSX element type
  const dispose = render(node as any, container);
  disposers.push(dispose, () => container.remove());
}

const PATHS = ["examples/ChatBot.lean", "examples/Markdown.lean", "README.md"];

describe("FileTree selection reveal (shimmer #1841)", () => {
  it("reveals an externally-applied selection WITHOUT dragging keyboard focus", () => {
    const onError = vi.fn();
    const [sel, setSel] = createSignal<string | null>("examples/ChatBot.lean");
    mount(() => (
      <FileTree
        paths={PATHS}
        selectedPath={sel()}
        onSelect={() => {}}
        onError={onError}
      />
    ));
    // Ignore the mount-time reveal; the loop is the REACTIVE re-application.
    scrollToPath.mockClear();

    setSel("examples/Markdown.lean");

    // The row must be revealed WITHOUT stealing focus — the pre-fix code passes
    // no options, which drags focus and drives the neighbour-echo loop.
    expect(scrollToPath).toHaveBeenCalledWith("examples/Markdown.lean", {
      focus: false,
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
