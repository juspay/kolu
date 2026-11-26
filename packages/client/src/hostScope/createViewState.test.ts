/** The dock's unread marks are this browser's memory of what it announced and
 *  you have not opened — and a reload must not forget them. Each "page" below
 *  is a fresh module graph over the same `localStorage`, which is what a
 *  reload is. */

import { Effect } from "effect";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionRecord } from "../attention/savedAttention";
import type { HostViewState } from "./createViewState";

// Focusing reports the active terminal to the host; nothing here is about that.
vi.mock("../wire", () => ({
  padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
}));

// STATIC, unlike `loadPage`'s dynamic ones: a `resetModules` graph brings its
// OWN solid-js, whose diagnostics nothing is subscribed to. The derivation
// cases below are judged by `@kolu/solid-test-setup`, so they must run on the
// engine this worker installed.
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { useVisitRecency } from "../terminal/visitRecency";
import { createViewState } from "./createViewState";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;

/** Load the page: a fresh module graph, this host's view state in it, and the
 *  host's attention record the engine raises marks on. The dynamic imports
 *  after `resetModules` ARE the reload — static imports would share one
 *  in-memory record across every "page" (and Solid itself is part of the graph
 *  being reloaded, so its owner — and the `flush` that drains THAT graph's
 *  staged writes — must come from the same one). */
async function loadPage(): Promise<{
  view: HostViewState;
  marks: AttentionRecord;
  flush: () => void;
}> {
  vi.resetModules();
  const { createRoot, flush } = await import("solid-js");
  const { createViewState } = await import("./createViewState");
  const { attentionRecordOf } = await import("../attention/savedAttention");
  return {
    view: createRoot(() =>
      // No boot pick: these cases are about the unread marks, not selection.
      createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        () => null,
      ),
    ),
    marks: attentionRecordOf(encodeHostKey(LOCAL_HOST)),
    flush,
  };
}

// Load once at collection, before any test's clock starts: a worker's first
// import costs one round trip to vitest's main process per module, and while
// the suite is starting those add up to seconds. Each page then re-evaluates.
await loadPage();

describe("a host's unread marks across a reload", () => {
  beforeEach(() => localStorage.clear());

  it("a mark you had not opened is there again on the next page", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    // A write is staged: the mark is what the dock reads on the next flush.
    page.flush();
    expect(page.view.isUnread(A)).toBe(true);
    expect((await loadPage()).view.isUnread(A)).toBe(true);
  });

  it("opening the terminal takes the mark off for good", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    page.view.writeFocus({ id: A, tileHint: A });
    page.flush();
    expect(page.view.isUnread(A)).toBe(false);
    expect((await loadPage()).view.isUnread(A)).toBe(false);
  });

  it("closing every tile clears the marks for good", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    page.view.reset();
    page.flush();
    expect((await loadPage()).view.isUnread(A)).toBe(false);
  });
});

/** THE VIEW-STATE DERIVATIONS are value-stable by construction: the focus fact
 *  is two ids, this host's MRU is a slice of one cross-host trail. Both are
 *  rebuilt from upstream state that moves for unrelated reasons, so without an
 *  equality gate they republish an equal value — Solid's
 *  `UNSTABLE_MEMO_OUTPUT`, which `@kolu/solid-test-setup` fails the test on. */
describe("a host's view-state derivations", () => {
  beforeEach(() => localStorage.clear());

  it("holds the focus fact still while the same boot pick is re-derived", () => {
    // `{ equals: false }` is the census: the pick is re-derived on every move,
    // and lands on the same tile.
    const [pick, setPick] = createSignal<TerminalId | null>(A, {
      equals: false,
    });
    let seen: TerminalId | null = null;
    const held = createRoot((dispose) => {
      const view = createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        pick,
      );
      createEffect(view.focusedTerminalId, (id) => {
        seen = id;
      });
      return { dispose, view };
    });
    flush();
    for (let i = 0; i < 4; i++) {
      setPick(A);
      flush();
    }
    expect(seen).toBe(A);
    expect(held.view.activeId()).toBe(A);
    held.dispose();
  });

  it("holds this host's MRU still while another host's trail moves", () => {
    const other = { kind: "remote", target: "box-1" } as const;
    let seen: TerminalId[] = [];
    const held = createRoot((dispose) => {
      const view = createViewState(
        LOCAL_HOST,
        () => ({ kind: "top-level" }),
        () => null,
      );
      createEffect(view.mruOrder, (ids) => {
        seen = ids;
      });
      return { dispose, visits: useVisitRecency() };
    });
    flush();
    // Four visits on ANOTHER host rewrite the one trail; this host's slice
    // comes back the same (empty) list every time.
    for (let i = 1; i <= 4; i++) {
      held.visits.noteVisit(other, A, i);
      flush();
    }
    expect(seen).toEqual([]);
    held.dispose();
  });
});
