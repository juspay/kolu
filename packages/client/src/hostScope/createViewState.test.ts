import { Effect } from "effect";
import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionRecord } from "../attention/savedAttention";
import type { HostViewState } from "./createViewState";

vi.mock("../wire", () => ({
  padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
}));

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;

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
