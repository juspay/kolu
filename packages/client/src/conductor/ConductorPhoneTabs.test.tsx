// @vitest-environment happy-dom
/**
 * THE TWO TABS COUNT THE SAME THING WHILE THE LIST BEHIND THEM MOVES.
 *
 * What needs you is one item per WORK, and the list is read again whenever
 * any work moves: a question answered and the next one taken up is a new item
 * about the same work, so the Work tab still says one. The tabs' capsules,
 * and the tabs themselves, must not be redrawn for that.
 */

import type { NeedsYou, WorkId } from "kolu-work";
import { render } from "@solidjs/web";
import { type Accessor, createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAdvisorySolidDiagnostic,
  takeSolidDiagnostics,
} from "@kolu/solid-test-setup/setup";

const WORK = "branch:local/%2Fr/waiting" as WorkId;
const AT = "2026-11-16T01:00:00.000Z";

/** The list as the app hands it over: read again, so a fresh item each time,
 *  about the same one work. */
const needs = vi.hoisted((): { value: Accessor<ReadonlyArray<NeedsYou>> } => ({
  value: () => [],
}));
vi.mock("./useWorks", () => ({ useNeedsYou: () => needs.value }));
// Nothing is proposed, so the Chat tab counts nothing: the Work tab's count
// is what moves here.
vi.mock("./memory/useMemory", () => ({ useMemoryNeed: () => () => undefined }));

import ConductorPhoneTabs from "./ConductorPhoneTabs";
import { setPhoneView } from "./phoneView";

/** One wait on you, about the work's newest question. */
const waiting = (ask: string): NeedsYou => ({
  work: WORK,
  title: "A work with questions",
  why: { why: "question", ask, question: "Approve the plan?", since: AT },
  since: AT,
  wanted: "Approve the plan?",
  key: `${WORK}:question:${ask}`,
});

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  setPhoneView("work");
});

const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics()
    .filter((event) => !isAdvisorySolidDiagnostic(event))
    .map((event) => `${event.code}: ${event.message}`);

describe("the phone's two tabs", () => {
  it("keeps its tabs and its badge while the list is read five times", () => {
    const [list, setList] = createSignal<ReadonlyArray<NeedsYou>>([
      waiting("ask-0"),
    ]);
    needs.value = list;
    root = document.createElement("div");
    document.body.append(root);
    const el = root;
    dispose = render(() => <ConductorPhoneTabs />, root);
    flush();
    const tabs = [
      ...el.querySelectorAll<HTMLElement>(
        '[data-testid="conductor-phone-tab"]',
      ),
    ];
    const badge = el.querySelector('[data-testid="conductor-phone-tab-badge"]');
    expect(tabs).toHaveLength(2);
    expect(badge?.textContent).toBe("1");
    takeSolidDiagnostics();

    // Five, not four: the diagnostic names a memo at four equal publishes.
    for (let read = 1; read <= 5; read += 1) {
      setList([waiting(`ask-${read}`)]);
      flush();
    }

    const after = [
      ...el.querySelectorAll<HTMLElement>(
        '[data-testid="conductor-phone-tab"]',
      ),
    ];
    expect(after.every((one, index) => one === tabs[index])).toBe(true);
    expect(el.querySelector('[data-testid="conductor-phone-tab-badge"]')).toBe(
      badge,
    );
    expect(badge?.textContent).toBe("1");
    expect(findings()).toEqual([]);
  });
});
