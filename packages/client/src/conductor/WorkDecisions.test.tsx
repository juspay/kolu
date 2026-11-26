// @vitest-environment happy-dom
/**
 * A CARD'S DECISIONS SURVIVE THE RECORD BEING READ AGAIN.
 *
 * The rows are a fold over the work — one row object per decision, minted on
 * every run — so the list is never the list it was. What a reader must not
 * see is the lines being rebuilt, and their open/closed state with them,
 * because some other leaf of the work moved.
 */

import type { Decision, Work } from "kolu-work";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import WorkDecisions from "./WorkDecisions";

const AT = "2026-01-01T00:00:00.000Z";

const asked = (id: string, question: string): Decision => ({
  kind: "settled",
  id,
  ask: `${id}-ask`,
  at: AT,
  topic: "work",
  question,
  header: { kind: "none" },
  options: ["yes", "no"],
  multiple: false,
  file: { kind: "none" },
  answer: {
    how: "answered",
    at: AT,
    from: "card",
    said: { kind: "picked", picked: ["yes"] },
  },
});

const DECISIONS: ReadonlyArray<Decision> = [
  asked("d-1", "Ship it?"),
  asked("d-2", "Squash the commits?"),
];

/** The same work, read again — a fresh record around the same decisions. */
const reread = (): Work => ({
  key: {
    kind: "branch",
    host: "local",
    repo: "/r",
    branch: "decided",
    repoBy: { kind: "git" },
  },
  title: "A work with decisions",
  startedAt: AT,
  decisions: [...DECISIONS],
  events: [],
  state: { kind: "open" },
  worktree: { kind: "unread" },
});

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
});

const rows = (el: HTMLElement): ReadonlyArray<HTMLElement> => [
  ...el.querySelectorAll<HTMLElement>('[data-testid="work-decision"]'),
];

describe("a card's decisions", () => {
  it("keeps its rows while the record is read again five times", () => {
    const [work, setWork] = createSignal<Work>(reread());
    root = document.createElement("div");
    document.body.append(root);
    const el = root;
    dispose = render(() => <WorkDecisions work={work()} />, root);
    const before = rows(el);
    expect(before).toHaveLength(2);
    // Five, not four: the diagnostic names a memo at four equal publishes.
    for (let read = 1; read <= 5; read += 1) {
      setWork(reread());
      flush();
    }
    const after = rows(el);
    expect(after).toHaveLength(2);
    expect(after.every((one, at) => one === before[at])).toBe(true);
    expect(el.textContent).toContain("Ship it?");
  });
});
