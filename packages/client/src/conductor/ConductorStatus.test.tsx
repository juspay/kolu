// @vitest-environment happy-dom
/**
 * THE ONE STATUS LINE, as a person meets it: the state word the header chip
 * used to carry, what the conversation is doing and for how long, the count
 * of work that, on a phone, opens the Work tab, and the waiting count that is
 * ABSENT at zero rather than rendering its own silence.
 */

import {
  DEFAULT_CONDUCTOR_STATE,
  type ConductorRow,
  type ConductorState,
} from "kolu-common/conductor";
import { needsYou, type WorkRow } from "kolu-work";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// The count is a CONTROL on a phone, and a plain readout on a desktop, where
// the works are already beside the line — this file is about the control.
vi.mock("../useMobile", () => ({ layoutMode: () => "phone" }));

/** The works the line counts, swapped per test — the mirror itself is a wire
 *  collection, and what this file is about is the sentence over it. */
let works: WorkRow[] = [];
vi.mock("./useWorks", () => ({
  useWorks: () => () => works,
  // The one needs-you reading, over the same works — as the real mirror
  // derives it.
  useNeedsYou: () => () => needsYou(works),
}));

import ConductorStatus from "./ConductorStatus";
import { phoneView, setPhoneView } from "./phoneView";
import { Shown } from "../ui/shown";

const SINCE = "2026-01-01T00:00:00.000Z";

/** A piece of work with nothing observed about it yet: in progress, waiting
 *  on its agents. Enough to be counted, which is all this line does — and it
 *  arrives as the PAIR every reader holds, because the record carries no id
 *  of its own: the key it is filed under is the id. */
const work = (branch: string, title: string): WorkRow => [
  `branch:local/%2Fcode%2Fkolu/${branch}`,
  {
    key: {
      kind: "branch",
      host: "local",
      repo: "/code/kolu",
      branch,
      repoBy: { kind: "git" },
    },
    title,
    events: [],
    decisions: [],
    startedAt: "2026-01-01T09:00:00.000Z",
    state: { kind: "open" },
    worktree: { kind: "unread" },
  },
];

const agentRow = (text: string): ConductorRow => ({
  id: "a",
  seq: 1,
  since: SINCE,
  kind: "agent",
  text,
});

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  works = [];
});

function mount(
  over: Partial<ConductorState> = {},
  rows: readonly ConductorRow[] = [],
): (testid: string) => HTMLElement | undefined {
  root = document.createElement("div");
  document.body.append(root);
  const state: ConductorState = { ...DEFAULT_CONDUCTOR_STATE, ...over };
  dispose = render(
    () => (
      // The pane is a retained view; every part of it reads its visibility
      // from this context, so a status line mounted for a test says it is
      // being looked at.
      <Shown value={() => true}>
        <ConductorStatus state={state} rows={rows} />
      </Shown>
    ),
    root,
  );
  return (testid) =>
    root?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? undefined;
}

describe("the status line", () => {
  it("says the phase in the words the header chip used", () => {
    const at = mount({ phase: "idle" });
    expect(at("conductor-phase")?.textContent).toBe("idle");
    expect(at("conductor-status")?.dataset.phase).toBe("idle");
  });

  it("says what it is doing, and for how long, while it works", () => {
    const at = mount(
      {
        phase: "working",
        busySince: new Date(Date.now() - 5_000).toISOString(),
      },
      [agentRow("briefing the planner")],
    );
    expect(at("conductor-phase")?.textContent).toBe("working");
    expect(at("conductor-status-detail")?.textContent).toBe(
      "briefing the planner",
    );
    // Seconds, ticking from the instant the turn began.
    expect(at("conductor-status-since")?.textContent).toMatch(/^\d+s$/);
  });

  it("carries no clock while nothing is running", () => {
    const at = mount({ phase: "idle", busySince: null });
    expect(at("conductor-status-since")).toBeUndefined();
    expect(at("conductor-status-detail")).toBeUndefined();
  });

  it("says how many pieces of work are in flight, and shows the works on a press", () => {
    works = [work("w1", "fix-parser"), work("w2", "docs-pass")];
    setPhoneView("chat");
    const at = mount();
    const button = at("conductor-work-count");
    // The words a person reads, and the same number as data for anything that
    // should not have to parse English. Nothing waits on the human here, so
    // that half of the sentence — and its datum — is simply absent.
    expect(button?.textContent?.replace(/\s+/g, " ")).toBe("2 pieces of work");
    expect(button?.dataset.work).toBe("2");
    expect(button?.dataset.waiting).toBeUndefined();

    button?.click();
    flush();
    expect(phoneView()).toBe("work");
  });

  it("says one piece of work in the singular", () => {
    works = [work("w1", "fix-parser")];
    const at = mount();
    expect(at("conductor-work-count")?.textContent?.replace(/\s+/g, " ")).toBe(
      "1 piece of work",
    );
  });

  it("counts a question about no work as something waiting on you", () => {
    // The work is waiting on its agents; the open ask belongs to no work, so
    // it is the conversation's own and counts on its own.
    works = [work("w1", "fix-parser")];
    const at = mount({ openAsks: ["ask-1"] });
    const button = at("conductor-work-count");
    expect(button?.textContent?.replace(/\s+/g, " ")).toBe(
      "1 piece of work · 1 needs you",
    );
    expect(button?.dataset.waiting).toBe("1");
  });

  it("says NOTHING with no work and nothing waiting — no count, no control", () => {
    // `0 pieces of work` and a press that opened an empty column were both
    // readouts of nothing. The line simply does not carry them.
    const at = mount();
    expect(at("conductor-work-count")).toBeUndefined();
    expect(at("work-column")).toBeUndefined();
    expect(at("conductor-status")?.textContent).not.toContain("0");
  });

  it("says how many events are waiting, and nothing at all at zero", () => {
    expect(mount({ held: [] })("conductor-held")).toBeUndefined();
    dispose?.();
    root?.remove();

    const at = mount({ held: ["local/a", "local/b", "local/c"] });
    expect(at("conductor-held")?.textContent).toContain("3");
  });

  it("carries the steer hint only while steering is on offer", () => {
    // The hint had a row of its own under the composer. It lives on the line
    // that reports the running turn now, and it is still true exactly when
    // the chord works: a conversation that steers, with a turn in flight.
    expect(
      mount({ steers: true, phase: "idle" })("conductor-steer-hint"),
    ).toBeUndefined();
    dispose?.();
    root?.remove();

    expect(
      mount({ steers: false, phase: "working" })("conductor-steer-hint"),
    ).toBeUndefined();
    dispose?.();
    root?.remove();

    const at = mount({ steers: true, phase: "working" });
    expect(at("conductor-steer-hint")?.textContent).toContain("steers");
  });
});
