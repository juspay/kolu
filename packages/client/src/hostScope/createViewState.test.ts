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

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;

/** Load the page: a fresh module graph, this host's view state in it, and the
 *  host's attention record the engine raises marks on. The dynamic imports
 *  after `resetModules` ARE the reload — static imports would share one
 *  in-memory record across every "page" (and Solid itself is part of the graph
 *  being reloaded, so its owner must come from the same one). */
async function loadPage(): Promise<{
  view: HostViewState;
  marks: AttentionRecord;
}> {
  vi.resetModules();
  const { createRoot } = await import("solid-js");
  const { createViewState } = await import("./createViewState");
  const { attentionRecordOf } = await import("../attention/savedAttention");
  return {
    view: createRoot(() =>
      createViewState(LOCAL_HOST, () => ({ kind: "top-level" })),
    ),
    marks: attentionRecordOf(encodeHostKey(LOCAL_HOST)),
  };
}

describe("a host's unread marks across a reload", () => {
  beforeEach(() => localStorage.clear());

  it("a mark you had not opened is there again on the next page", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    expect(page.view.isUnread(A)).toBe(true);
    expect((await loadPage()).view.isUnread(A)).toBe(true);
  });

  it("opening the terminal takes the mark off for good", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    page.view.writeFocus({ id: A, tileHint: A });
    expect(page.view.isUnread(A)).toBe(false);
    expect((await loadPage()).view.isUnread(A)).toBe(false);
  });

  it("closing every tile clears the marks for good", async () => {
    const page = await loadPage();
    page.marks.markUnread(A);
    page.view.reset();
    expect((await loadPage()).view.isUnread(A)).toBe(false);
  });
});
