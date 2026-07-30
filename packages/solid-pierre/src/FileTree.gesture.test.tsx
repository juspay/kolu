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
 * Pierre's emit timing is environment-dependent: driven directly (a synchronous
 * `dispatchEvent`, as these mock-based tests do) it fires INSIDE the click
 * dispatch, but in the real app (Preact into a shadow root, a real browser
 * click) it lands DEFERRED, after this handler's microtask — the case that
 * matters, since a `queueMicrotask` disarm shipped in #1846 and dropped every
 * real click in production. The token must stay armed across BOTH. These tests
 * are deliberately at the wrapper-CONTRACT level (a scripted mock emit, not the
 * real library's timing): the "deferred" test drives the emit after
 * `await Promise.resolve()` and FAILS against a `queueMicrotask` disarm while
 * passing on the animation-frame disarm; a real-Pierre integration test would
 * measure the SYNCHRONOUS happy-dom timing and so could not guard the deferred
 * production case anyway.
 */
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitStatusEntry } from "@pierre/trees";

// The mock captures Pierre's `onSelectionChange` so a test can make "Pierre" emit
// a selection — with or without a preceding user gesture.
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

  it("arms in CAPTURE phase — a row whose own handler emits mid-dispatch is still forwarded", () => {
    const onSelect = vi.fn();
    const tree = mount(onSelect);
    // A real Pierre row lives *inside* the container and emits its selection from
    // its own click handler, synchronously in the same dispatch. The gate's
    // listener must arm in the CAPTURE phase (runs before the target's handler) —
    // a bubble-phase listener would fire *after* the row emits, with the token
    // still unset, and drop the click. Dispatching on a descendant is what
    // distinguishes the two: capture reaches the container before the target.
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
    // Control the animation frame so the safety disarm is deterministic.
    const frames: FrameRequestCallback[] = [];
    const realRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }) as typeof requestAnimationFrame;
    try {
      // A gesture that selects nothing (dead space / scrollbar) arms the token
      // but never emits to consume it.
      tree.dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true }),
      );
      // Advance the frame — the disarm must clear the token.
      for (const cb of frames.splice(0)) cb(0);
      // A later autonomous echo must now be dropped; without the frame disarm the
      // stale token would forward it as one file the user never picked.
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
