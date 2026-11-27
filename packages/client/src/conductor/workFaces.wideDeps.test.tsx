// @vitest-environment happy-dom
/**
 * THE FACES OF ONE LONG WORK READ ITS SNAPSHOT, NOT ITS STORE.
 *
 * `createWorkRecord` gave every whole-work fold ONE dependency, and the card's
 * own readings take it. The faces drawn INSIDE the card — the subtitle, the
 * words of the standing line, the terminals' rows, the open question — are
 * handed a work of their own, and a face handed the store's proxy folds it
 * leaf by leaf: `prLinks`, `workSubtitleParts`, `roleSetupOf` and
 * `decisions.filter` each walk the whole record, so one of them on a work with
 * a long timeline is a scope of hundreds of sources and Solid's development
 * build raises `WIDE_SCOPE_DEPS` on it.
 *
 * The fixture is ONE work at the size a months-old work reaches: 250 timeline
 * events and 100 decisions, with a PR, a member and two asks still open. Each
 * case mounts a real face over it, and judges:
 *
 *   - every diagnostic Solid raised, `info` graded ones included — the list is
 *     empty or the case says what was raised and on which scope;
 *   - what the face DREW, against the words built from the fixture's own
 *     constants rather than from the readings under test;
 *   - the same two after one more event lands on the record.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { ConductorRow } from "kolu-common/conductor";
import {
  ABOUT_WORK,
  answerAsk,
  askQuestions,
  joinWork,
  openWork,
  type Question,
  type RecordableEvent,
  recordEvent,
  type SentAnswer,
  type Work,
  type WorkEvent,
  type WorkId,
  workIdOf,
} from "kolu-work";
import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import { createStore, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const HOST = "local";
const REPO = "/code/r";
const REPO_NAME = "r";
const BRANCH = "long-record";
const MODE = "full";
const PR = 7;
const PR_HREF = "https://forge.example/r/pull/7";
const TERMINAL = "t";

const KEY = {
  kind: "branch",
  host: HOST,
  repo: REPO,
  branch: BRANCH,
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);
const REF = `${HOST}/${TERMINAL}`;

/** THE WORKS THE MIRROR HOLDS — empty but for the chat's case, which looks
 *  the work up by id rather than being handed it. */
const mirror = vi.hoisted(() => ({
  works: new Map<string, unknown>(),
}));
// The fleet, as far as this card is concerned: nothing of its terminal is in
// it — no standing, no rows, so a member's name falls back to its role. The
// module's pure helpers (the grouping a name reading folds) stay real.
vi.mock(import("../palette/fleetTerminals"), async (importOriginal) => ({
  ...(await importOriginal()),
  fleetTerminalStanding: () => ({ kind: "gone" }) as const,
  useFleetTerminalIndex: () => () => [],
}));
vi.mock("./useWorks", () => ({
  useWorkMap: () => () => mirror.works,
  useWorkAt: (id: string) => mirror.works.get(id),
  useWorkMembers: () => () =>
    new Map([[REF, { work: ID, role: "planner", joinedAt: at(1_000) }]]),
  useWorkPrs: () => () => new Map(),
  useSeen: () => () => new Map(),
  useMembership: () => () => new Map(),
  useSetupAnswers: () => () => [],
  useAgentNotes: () => () => [],
  useFileHolders: () => () => new Map(),
}));
vi.mock("./useConductor", () => ({
  useConductor: () => ({ answerWork: vi.fn(), answer: vi.fn(), send: vi.fn() }),
}));
vi.mock("./WorkCode", () => ({ default: () => <div /> }));
vi.mock("./WorkLive", () => ({ default: () => <div /> }));
vi.mock("./ConductorDiffs", () => ({ default: () => null }));

import { Shown } from "../ui/shown";
import { repoMonogram } from "../ui/monogramGlyph";
import ConductorTranscript from "./ConductorTranscript";
import type { Turn } from "./turnWorks";
import WorkCard from "./WorkCard";
import { WorkChipCard } from "./WorkChip";
import { pickWork, unpickWork } from "./workListing";

const T0 = Date.parse("2026-11-16T01:00:00.000Z");
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const MEMBER = { kind: "member", terminal: TERMINAL } as const;

/** ONE ROUND OF A TIMELINE, in the events kolu really records. */
const round = (i: number): ReadonlyArray<RecordableEvent> => [
  {
    at: at(i * 60_000 + 2_000),
    by: "kolu",
    about: { ...MEMBER },
    kind: "asking",
    why: { kind: "none" },
  },
  {
    at: at(i * 60_000 + 3_000),
    by: "kolu",
    about: { ...MEMBER },
    kind: "ready",
    why: { kind: "none" },
  },
  {
    at: at(i * 60_000 + 4_000),
    by: "agent",
    about: { ...MEMBER },
    kind: "file",
    path: `.waterfall/step-${i}.md`,
  },
  {
    at: at(i * 60_000 + 5_000),
    by: "ci",
    about: ABOUT_WORK,
    kind: "checks-running",
    pr: PR,
    head: { kind: "commit", sha: `sha${i}` },
    failing: [],
  },
  {
    at: at(i * 60_000 + 6_000),
    by: "ci",
    about: ABOUT_WORK,
    kind: "checks-passed",
    pr: PR,
    head: { kind: "commit", sha: `sha${i}` },
    failing: [],
  },
];

/** 50 rounds of five is 250 timeline events — the length a work kolu has run
 *  for weeks reaches, and more than the 200 sources a fold that reads one
 *  node per event is judged at. */
const ROUNDS = 50;
/** 20 forms of five questions is 100 decisions. The last two are still open:
 *  a card draws a question per open ask, which is the face judged here. */
const ASKS = 20;
const OPEN_ASKS = 2;

const askOf = (ask: number, i: number): Question => ({
  id: `${ask}-${i}`,
  question: `Question ${i} of form ${ask}?`,
  topic: "work",
  header: { kind: "header", text: `form ${ask}` },
  options: ["yes", "no"],
  multiple: false,
  file: { kind: "none" },
});

const MODE_QUESTION: Question = {
  id: "mode",
  question: "Which mode?",
  topic: "setup",
  key: "mode",
  options: [MODE, "trivial"],
  given: { kind: "ask" },
};

/** THE WORK: a branch work with a member, a PR, 250 events, 100 decisions and
 *  two forms still waiting on a person. */
const grown = (): Work => {
  let work = openWork({
    key: KEY,
    title: "A work with a long record",
    at: at(0),
    request: { kind: "none" },
  });
  work = joinWork(work, { terminal: TERMINAL, role: "planner", at: at(1_000) });
  work = recordEvent(work, {
    at: at(1_500),
    by: "kolu",
    about: ABOUT_WORK,
    kind: "pr-opened",
    pr: PR,
    title: "The long record",
    url: { kind: "link", href: PR_HREF },
    draft: "ready",
  });
  for (let i = 0; i < ROUNDS; i++)
    for (const one of round(i)) work = recordEvent(work, one);
  for (let ask = 0; ask < ASKS; ask++) {
    const when = at(ROUNDS * 60_000 + ask * 1_000);
    const questions =
      ask === 0
        ? [MODE_QUESTION, ...[1, 2, 3, 4].map((i) => askOf(ask, i))]
        : [0, 1, 2, 3, 4].map((i) => askOf(ask, i));
    work = askQuestions(work, { ask: `ask-${ask}`, questions, at: when });
    if (ask >= ASKS - OPEN_ASKS) continue;
    const values = new Map<string, SentAnswer>(
      questions.map((one) => [one.id, [one.id === "mode" ? MODE : "yes"]]),
    );
    work = answerAsk(work, {
      ask: `ask-${ask}`,
      at: at(ROUNDS * 60_000 + ask * 1_000 + 500),
      from: "card",
      reply: { kind: "answered", values },
    });
  }
  return work;
};

/** THE SUBTITLE A PERSON READS, built from the fixture's own constants: the
 *  repository's monogram and name, the branch, then the host, the mode the
 *  setup answered and the PR. */
const SUBTITLE = `${repoMonogram(REPO_NAME)}${REPO_NAME} · ${BRANCH} · ${HOST} · ${MODE} · PR #${PR}`;

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

const mount = (ui: () => JSX.Element): HTMLElement => {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <Shown value={() => true}>{ui()}</Shown>, root);
  flush();
  return root;
};

/** EVERY DIAGNOSTIC SOLID RAISED, in one line each — `info` included, so a
 *  finding of any grade shows here rather than in the suite's `afterEach`. */
const findings = (): ReadonlyArray<string> =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity ?? "none"}] ${event.code} ${event.message}`,
  );

const textOf = (host: HTMLElement, testId: string): string =>
  host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "(absent)";

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  mirror.works = new Map();
  unpickWork();
  flush();
});

describe("a card drawn over a long record", () => {
  it("says where the work is, with its PR a link, from one read", () => {
    const [work] = createStore(grown());

    const el = mount(() => <WorkCard id={ID} work={work} shape="card" />);

    expect(textOf(el, "work-subtitle")).toBe(SUBTITLE);
    expect(
      el.querySelector('[data-testid="work-pr-link"]')?.getAttribute("href"),
    ).toBe(PR_HREF);
    expect(findings()).toEqual([]);
  });

  it("draws the question of every open ask", () => {
    const [work] = createStore(grown());

    const el = mount(() => <WorkCard id={ID} work={work} shape="card" />);

    const asked = [...el.querySelectorAll('[data-testid="work-question"]')].map(
      (one) => one.getAttribute("data-ask"),
    );
    expect(asked).toEqual(["ask-18", "ask-19"]);
    // Five fields in the form, each drawn once.
    expect(el.querySelectorAll("[data-decision]").length).toBe(OPEN_ASKS * 5);
    expect(findings()).toEqual([]);
  });

  it("draws its terminals' rows", () => {
    const [work] = createStore(grown());
    pickWork(ID);

    const el = mount(() => <WorkCard id={ID} work={work} shape="picked" />);

    expect(
      [...el.querySelectorAll('[data-testid="work-member"]')].map((one) =>
        one.getAttribute("data-ref"),
      ),
    ).toEqual([REF]);
    expect(findings()).toEqual([]);
  });

  it("follows one more event without widening a scope", () => {
    const [work, setWork] = createStore(grown());
    const el = mount(() => <WorkCard id={ID} work={work} shape="card" />);
    expect(findings()).toEqual([]);

    setWork((draft: Work) => {
      (draft.events as WorkEvent[]).push({
        at: at(ROUNDS * 60_000 + 60_000),
        by: "kolu",
        about: ABOUT_WORK,
        kind: "draft-state",
        pr: PR,
        draft: "draft",
      });
    });
    flush();

    expect(textOf(el, "work-subtitle")).toBe(
      `${repoMonogram(REPO_NAME)}${REPO_NAME} · ${BRANCH} · ${HOST} · ${MODE} · draft PR #${PR}`,
    );
    expect(findings()).toEqual([]);
  });
});

describe("a work chip's hover card over a long record", () => {
  it("says the same words, from one read", () => {
    const [work] = createStore(grown());

    const el = mount(() => <WorkChipCard id={ID} work={work} />);

    expect(textOf(el, "work-chip-terminal")).not.toBe("(absent)");
    expect(
      el.querySelector('[data-testid="work-pr-link"]')?.getAttribute("href"),
    ).toBe(PR_HREF);
    expect(findings()).toEqual([]);
  });
});

/** The chat's row for the LAST form still open on the work: the ask the row
 *  names is the one the face draws, so what it draws is that form's five
 *  questions. */
const CHAT_ASK = `ask-${ASKS - 1}`;
const ROWS: readonly ConductorRow[] = [
  {
    id: CHAT_ASK,
    seq: 1,
    since: at(ROUNDS * 60_000 + (ASKS - 1) * 1_000),
    kind: "work-ask",
    text: "Question 0 of form 19?",
    ask: { fields: [], standing: { kind: "open" } },
    work: ID,
  },
];
const TURNS: ReadonlyMap<string, Turn> = new Map([
  [CHAT_ASK, { head: CHAT_ASK, works: [ID] } satisfies Turn],
]);

describe("the chat's own copy of a question", () => {
  it("draws the form from one read of the work", () => {
    const [work] = createStore(grown());
    mirror.works = new Map([[ID, work]]);

    const el = mount(() => (
      <ConductorTranscript
        rows={ROWS}
        turns={TURNS}
        pending={false}
        error={undefined}
        containerRef={() => {}}
      />
    ));

    const form = el.querySelector(`[data-testid="work-question"]`);
    expect(form?.getAttribute("data-ask")).toBe(CHAT_ASK);
    expect(form?.querySelectorAll("[data-decision]").length).toBe(5);
    expect(findings()).toEqual([]);
  });
});
