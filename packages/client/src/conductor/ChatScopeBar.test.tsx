// @vitest-environment happy-dom
/**
 * THE BAR'S COUNT IS FOLDED AGAIN, AND SAYS THE SAME THING.
 *
 * "5 of 15" is a walk over the whole conversation, re-run on every chunk the
 * agent streams: the rows list is replaced, the turn index is rebuilt, and the
 * record the chip is drawn from is read again. While the two numbers have not
 * moved, nothing under the bar — the chip and its hover card above all — has
 * any reason to be redrawn.
 */

import type { ConductorRow } from "kolu-common/conductor";
import { openWork, type Work, type WorkId, workIdOf } from "kolu-work";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAdvisorySolidDiagnostic,
  takeSolidDiagnostics,
} from "@kolu/solid-test-setup/setup";

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/r",
  branch: "scoped",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);
const AT = "2026-11-16T01:00:00.000Z";

const WORK: Work = openWork({
  key: KEY,
  title: "The work the chat is about",
  at: AT,
  request: { kind: "none" },
});

// The map the scope reads its record from — one work, one record, so the
// chip's subject is the same object on every read.
vi.mock("./useWorks", () => ({
  useWorkMap: () => () => new Map([[ID, WORK]]),
  useWorkAt: (id: WorkId) => (id === ID ? WORK : undefined),
}));
// The chip is its own face with its own hover card; what this file judges is
// the bar's fold, and the chip stands for whatever the bar hands it.
vi.mock("./WorkChip", () => ({ default: () => <span data-testid="chip" /> }));

import ChatScopeBar from "./ChatScopeBar";
import { pointChatAt, showAllChat } from "./chatScope";
import type { Turn } from "./turnWorks";

const row = (id: string, minute: number): ConductorRow =>
  ({
    id,
    seq: minute,
    since: new Date(Date.parse(AT) + minute * 60_000).toISOString(),
    kind: "agent",
    text: "ok",
  }) satisfies ConductorRow;

/** Three turns of the chat, one of them about the work in scope. */
const ROWS: ReadonlyArray<ConductorRow> = [
  row("a", 1),
  row("b", 2),
  row("c", 3),
];

/** The index the transcript filters by, built again — fresh `Turn` records
 *  around the same two numbers, which is what a chunk of output does. */
const index = (): ReadonlyMap<string, Turn> =>
  new Map<string, Turn>([
    ["a", { head: "a", works: [ID] }],
    ["b", { head: "b", works: [] }],
    ["c", { head: "c", works: [] }],
  ]);

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  showAllChat();
});

const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics()
    .filter((event) => !isAdvisorySolidDiagnostic(event))
    .map((event) => `${event.code}: ${event.message}`);

describe("the bar over a chat pointed at one work", () => {
  it("keeps its bar and its chip while the turns are folded five times", () => {
    pointChatAt(ID);
    const [turns, setTurns] = createSignal(index());
    root = document.createElement("div");
    document.body.append(root);
    const el = root;
    dispose = render(
      () => <ChatScopeBar rows={[...ROWS]} turns={turns()} />,
      root,
    );
    flush();
    const bar = el.querySelector('[data-testid="chat-scope-bar"]');
    const chip = el.querySelector('[data-testid="chip"]');
    expect(bar?.textContent).toContain("1 of 3");
    takeSolidDiagnostics();

    // Five, not four: the diagnostic names a memo at four equal publishes.
    for (let fold = 1; fold <= 5; fold += 1) {
      setTurns(index());
      flush();
    }

    expect(el.querySelector('[data-testid="chat-scope-bar"]')).toBe(bar);
    expect(el.querySelector('[data-testid="chip"]')).toBe(chip);
    expect(bar?.textContent).toContain("1 of 3");
    expect(findings()).toEqual([]);
  });
});
