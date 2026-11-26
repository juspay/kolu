/** A WORK'S CODE VIEW IN THE BROWSER — written first, reported after. A file
 *  click moves the view at once and the whole view is reported behind it; a
 *  report kolu refuses says so in one toast, however many clicks it refuses;
 *  and a work that goes takes this browser's view and history with it. */

import { Effect } from "effect";
import { ConductorRefused } from "kolu-common/conductorErrors";
import type { WorkCodeView } from "kolu-common/works";
import type { WorkId } from "kolu-work";
import { createRoot, flush } from "solid-js";
import type { CodeViewState } from "../code-view/codeViewState";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reports: [] as Array<{
    input: { work: string; view: WorkCodeView };
    shownWhenReported: string | null;
  }>,
  refuse: false,
  shown: (): string | null => null,
  toastError: vi.fn(),
  /** The works mirror's keys, driven by a test. */
  setWorks: (_ids: string[]): void => {},
}));

vi.mock("../wire", async () => {
  // The factory runs before this file's own imports are bound.
  const { createSignal } = await import("solid-js");
  const [works, setWorks] = createSignal<string[]>([]);
  h.setWorks = setWorks;
  return {
    app: {
      collections: {
        workCodeViews: {
          use: () => ({ keys: () => [], byKey: () => undefined }),
        },
        works: {
          use: () => ({
            keys: works,
            byKey: (id: string) => () => ({ title: id }),
          }),
        },
      },
      procedures: {
        conductor: {
          setWorkCodeView: (input: { work: string; view: WorkCodeView }) =>
            // A REPORT IS A WIRE HOP: it reaches kolu-server a tick after the
            // click, by which time the frame the click landed in has been
            // drawn — so what this records is what the browser SHOWS as it
            // reports, which is the whole of "moved first, reported after".
            Effect.andThen(Effect.yieldNow, () =>
              Effect.suspend(() => {
                h.reports.push({ input, shownWhenReported: h.shown() });
                return h.refuse
                  ? Effect.fail(new ConductorRefused({ why: "no such work" }))
                  : Effect.void;
              }),
            ),
        },
      },
    },
  };
});
vi.mock("solid-sonner", () => ({ toast: { error: h.toastError } }));

import { workCodeState } from "./workCodeView";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const letGo: Array<() => void> = [];

/** The state AS A VIEW HOLDS IT — under an owner, because it keeps an effect
 *  on the work's view, and let go of when the test ends, as the view is when
 *  it closes. */
const stateFor = (work: WorkId): CodeViewState =>
  createRoot((dispose) => {
    letGo.push(dispose);
    return workCodeState(work, () => "git");
  });

beforeEach(() => {
  h.reports = [];
  h.refuse = false;
  h.toastError.mockClear();
});

afterEach(() => {
  for (const dispose of letGo.splice(0)) dispose();
});

describe("a work's Code view in the browser", () => {
  it("moves at once, then reports the whole view", async () => {
    const state = stateFor("w-moves" as WorkId);
    h.shown = () => state.selectedFile("browse");

    state.setSelectedFile("browse", "notes.md");
    // A store write is not on screen until the frame it lands in — the frame
    // a person's click is drawn in.
    flush();
    expect(state.selectedFile("browse")).toBe("notes.md");
    await settle();
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

  it("writes the picked mode's leaf and leaves the other mode's alone", async () => {
    // A WORK THAT ALREADY HAS A RECORD, picked in two modes: the shape the
    // store's immutable-update detector answers on (two leaves written, one
    // of them unchanged). A single-mode fixture cannot reach it however many
    // times it writes, which is how a whole-container `Object.assign` lived
    // in this writer while the Right panel's was already per-key. The work id
    // is fresh because the module's store — and the detector's per-path
    // census — are shared across this file.
    const state = stateFor("w-leaf" as WorkId);

    state.setSelectedFile("local", "x.ts");
    flush();
    state.setSelectedFile("browse", "y.ts");
    flush();

    await settle();
    await settle();
    expect(state.selectedFile("local")).toBe("x.ts");
    expect(state.selectedFile("browse")).toBe("y.ts");
    expect(takeSolidDiagnostics()).toEqual([]);
  });

  it("says a refused report in one toast, however many clicks it refuses", async () => {
    h.refuse = true;
    const state = stateFor("w-refused" as WorkId);

    state.setSelectedFile("browse", "a.md");
    state.setSelectedFile("browse", "b.md");
    await settle();

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
    const state = stateFor("w-same" as WorkId);
    state.setCodeMode("local");
    await settle();
    const reports = h.reports.length;

    state.setCodeMode("local");
    await settle();

    expect(h.reports).toHaveLength(reports);
  });

  it("lets go of a work's view and history when the work goes", async () => {
    const work = "branch:local/%2Fsrv%2Fcode%2Fkestrel/export" as WorkId;
    h.setWorks([work]);
    const state = stateFor(work);
    await settle();
    state.setSelectedFile("browse", "notes.md");
    state.recordNavigation({ mode: "browse", path: "a.md" });
    state.recordNavigation({ mode: "browse", path: "notes.md" });
    flush();
    expect(state.canNavigateBack()).toBe(true);

    // Declined, or off the finished list: kolu-server has dropped its view.
    h.setWorks([]);
    await settle();

    // The same branch opened again reads where a fresh view stands.
    const again = stateFor(work);
    expect(again.selectedFile("browse")).toBeNull();
    expect(again.canNavigateBack()).toBe(false);
  });
});
