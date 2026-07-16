// @vitest-environment happy-dom
/**
 * Regression for the Code-tab file-tree "shimmer" — juspay/kolu#1841.
 *
 * Pierre is a CONTROLLED component — the host drives its selection and Pierre
 * calls `onSelectionChange` back for BOTH real clicks AND its own programmatic
 * re-selection. A live `setSelectedFile` stack capture during the loop showed
 * EVERY write in it was `onSelectionChange → onSelect` (an autonomous Pierre echo
 * during agent activity), never a click handler — the selection ping-ponging
 * between two adjacent files at ~60-120Hz. The wrapper forwarded each echo to the
 * host, and the host re-applied it into Pierre, closing the loop.
 *
 * The fix: forward `onSelectionChange` to the host ONLY when a real user gesture
 * caused it. These tests pin that: an autonomous emit (no gesture) is dropped — so
 * the loop can never reach the host — while a genuine click's selection is
 * forwarded. The first test FAILS on the pre-fix wrapper (it forwarded every emit).
 *
 * Crucially, Pierre does NOT emit `onSelectionChange` synchronously inside the
 * click dispatch — it emits on a microtask that lands *after* the click. The
 * gesture token therefore must stay armed across that microtask, and the
 * "deferred" test below pins exactly that: it emits after `await Promise.resolve()`
 * and FAILS against a token disarmed on `queueMicrotask` (juspay/kolu#1846's
 * preview regression, where every genuine click was dropped), while passing once
 * the disarm is moved to the next animation frame.
 */
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

// The mock captures Pierre's `onSelectionChange` so a test can make "Pierre" emit
// a selection — with or without a preceding user gesture.
const { pierre } = vi.hoisted(() => ({
  pierre: { emit: (_paths: readonly string[]) => {} },
}));

vi.mock("@pierre/trees", () => {
  class MockFileTree {
    // biome-ignore lint/suspicious/noExplicitAny: test double for Pierre's options
    constructor(opts: any) {
      const onSel = opts?.onSelectionChange;
      pierre.emit = (paths) => onSel?.(paths);
    }
    render() {}
    getSelectedPaths(): readonly string[] {
      return [];
    }
    getItem() {
      return { select() {}, deselect() {} };
    }
    scrollToPath() {}
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

/** Mount and return the tree's own container — the element the gate listens on
 *  (in the real app, composed user events cross Pierre's shadow root to it). */
function mount(onSelect: (p: string | null) => void): HTMLElement {
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);
  const dispose = render(
    // biome-ignore lint/suspicious/noExplicitAny: render's JSX element type
    (() => (
      <FileTree
        paths={PATHS}
        onSelect={onSelect}
        onError={(e) => {
          throw e;
        }}
      />
    )) as any,
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
    // Pierre re-emits during churn, alternating two files, with NO user input —
    // this is the loop. Every one must be dropped.
    pierre.emit(["examples/Storage.lean"]);
    pierre.emit(["examples/Main.lean"]);
    pierre.emit(["examples/Storage.lean"]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("forwards a click whose selection Pierre emits on a DEFERRED microtask (#1846)", async () => {
    const onSelect = vi.fn();
    const tree = mount(onSelect);
    // A genuine click arms the gate (capture phase). Pierre does not emit in the
    // click dispatch — it emits on a later microtask. Draining microtasks here
    // (the `await`) reproduces that gap: a `queueMicrotask` disarm would already
    // have fired and dropped this real click (the #1846 preview regression); a
    // next-frame disarm keeps the token armed so the deferred emit is forwarded.
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
    pierre.emit(["examples/Main.lean"]); // forwarded (armed)
    pierre.emit(["examples/Storage.lean"]); // dropped (token consumed)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("examples/Main.lean");
  });
});
