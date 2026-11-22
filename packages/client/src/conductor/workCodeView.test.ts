/** A WORK'S CODE VIEW IN THE BROWSER — written first, reported after. A file
 *  click moves the view at once and the whole view is reported behind it; a
 *  report kolu refuses says so in one toast, however many clicks it refuses. */

import { Effect } from "effect";
import { ConductorRefused } from "kolu-common/conductorErrors";
import type { WorkCodeView } from "kolu-common/works";
import type { WorkId } from "kolu-work";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reports: [] as Array<{
    input: { work: string; view: WorkCodeView };
    shownWhenReported: string | null;
  }>,
  refuse: false,
  shown: (): string | null => null,
  toastError: vi.fn(),
}));

vi.mock("../wire", () => ({
  app: {
    collections: {
      workCodeViews: {
        use: () => ({ keys: () => [], byKey: () => undefined }),
      },
    },
    procedures: {
      conductor: {
        setWorkCodeView: (input: { work: string; view: WorkCodeView }) =>
          Effect.suspend(() => {
            h.reports.push({ input, shownWhenReported: h.shown() });
            return h.refuse
              ? Effect.fail(new ConductorRefused({ why: "no such work" }))
              : Effect.void;
          }),
      },
    },
  },
}));
vi.mock("solid-sonner", () => ({ toast: { error: h.toastError } }));

import { workCodeState } from "./workCodeView";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  h.reports = [];
  h.refuse = false;
  h.toastError.mockClear();
});

describe("a work's Code view in the browser", () => {
  it("moves at once, then reports the whole view", async () => {
    const state = workCodeState("w-moves" as WorkId, () => "git");
    h.shown = () => state.selectedFile("browse");

    state.setSelectedFile("browse", "notes.md");

    expect(state.selectedFile("browse")).toBe("notes.md");
    await flush();
    expect(h.reports).toEqual([
      {
        input: {
          work: "w-moves",
          view: {
            codeMode: "browse",
            selectedFileByMode: { browse: "notes.md" },
          },
        },
        // The report went out with the view ALREADY moved.
        shownWhenReported: "notes.md",
      },
    ]);
  });

  it("says a refused report in one toast, however many clicks it refuses", async () => {
    h.refuse = true;
    const state = workCodeState("w-refused" as WorkId, () => "git");

    state.setSelectedFile("browse", "a.md");
    state.setSelectedFile("browse", "b.md");
    await flush();

    // The view still says what the person picked.
    expect(state.selectedFile("browse")).toBe("b.md");
    expect(h.toastError).toHaveBeenCalledTimes(2);
    // ONE toast: both refusals name the same toast, so the second replaces
    // the first rather than stacking beside it.
    const [first, second] = h.toastError.mock.calls.map(([, opts]) => opts);
    expect(first).toHaveProperty("id");
    expect(second).toEqual(first);
    expect(h.toastError.mock.calls[0]?.[0]).toContain("no such work");
  });

  it("reports nothing for a click that changes nothing", async () => {
    const state = workCodeState("w-same" as WorkId, () => "git");
    state.setCodeMode("local");
    await flush();
    const reports = h.reports.length;

    state.setCodeMode("local");
    await flush();

    expect(h.reports).toHaveLength(reports);
  });
});
