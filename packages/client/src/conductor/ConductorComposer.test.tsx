// @vitest-environment happy-dom
/**
 * THE `@` MENU AND ITS CHIPS SURVIVE A FLEET TICK.
 *
 * The candidate list is minted fresh on every notification — `fleetMentionCandidates`
 * maps the whole fleet into new objects — and the fleet index notifies on ANY
 * metadata change on ANY host. So a terminal retitling itself on a machine
 * nobody is looking at wakes this composer, and a reference-keyed list would
 * tear down and rebuild every row of the open menu and every armed chip: the
 * hovered row's highlight and the chip under the finger both vanish mid-press,
 * for a change about a different machine entirely.
 *
 * These tests hold the DOM nodes across exactly that tick. Identity (`toBe` on
 * the element) is the assertion, because "re-created" is not visible in the
 * rendered text — a rebuilt row looks right and behaves wrong.
 */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { ConductorMention, ConductorState } from "kolu-common/conductor";
import type { TerminalId } from "kolu-common/surface";
import { Option } from "effect";
import {
  askQuestions,
  endWork,
  type Membership,
  type NeedsYou,
  needsYou,
  openWork,
  type Work,
  type WorkId,
  type WorkRow,
} from "kolu-work";
import { type Accessor, createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalRow } from "../palette/fleetTerminals";
import { aboutWork, showAllChat } from "./chatScope";
import { askFromWelcome, composerText, setComposerText } from "./drafts";
import ConductorComposer from "./ConductorComposer";
import { pickedWork, unpickWork } from "./workListing";
import { standingLine } from "./workReadings";
import { Shown } from "../ui/shown";

/** The index is the ONE thing this test controls: everything downstream of it
 *  — the per-host key computation, the filter, the resolve — stays real, or
 *  the test would prove only that a mock can hold a node. */
const fleet = vi.hoisted(() => ({
  read: (() => []) as Accessor<FleetTerminalRow[]>,
}));
vi.mock(import("../palette/fleetTerminals"), async (importOriginal) => ({
  ...(await importOriginal()),
  useFleetTerminalIndex: () => fleet.read,
}));
/** The works mirror, the same way: the records and the waits are the test's,
 *  everything the menu makes of them — the order, the slug, the standing
 *  line — is the real reading. */
const mirror = vi.hoisted(() => ({
  works: (() => []) as Accessor<ReadonlyArray<WorkRow>>,
  needs: (() => []) as Accessor<ReadonlyArray<NeedsYou>>,
  membership: (() => new Map()) as Accessor<ReadonlyMap<string, Membership>>,
}));
vi.mock("./useWorks", () => ({
  useWorks: () => mirror.works,
  useNeedsYou: () => mirror.needs,
  useWorkMap: () => () => new Map(mirror.works()),
  useMembership: () => mirror.membership,
  // A work's chip reads its terminals; these works have none.
  useWorkMembers: () => () => new Map(),
  useSeen: () => () => new Map(),
}));
// The wire-facing neighbours, inert: a real upload would only add a second
// thing to fail. The prompt verb is a spy the tests read — what a message
// CARRIES is half of what a mention is for.
const sent = vi.hoisted(() => ({ prompt: vi.fn() }));
vi.mock("./useConductor", () => ({
  useConductor: () => ({ prompt: sent.prompt, cancel: vi.fn() }),
}));
vi.mock("./attachFiles", () => ({
  attachPastedFiles: () => false,
  reattachComposerFiles: () => {},
}));
vi.mock("../host/hostChipTone", () => ({ hostLabel: () => "host" }));

const LOCAL: HostKey = { kind: "local" };
const REMOTE: HostKey = { kind: "remote", target: "srid@builder" };

const meta = (branch: string, intent: string): TerminalMetadata =>
  ({
    state: "active",
    cwd: "/home/srid/code/kolu",
    git: { kind: "repo", info: { repoName: "kolu", branch } },
    intent,
  }) as unknown as TerminalMetadata;

const row = (
  host: HostKey,
  id: string,
  branch: string,
  intent: string,
): FleetTerminalRow => ({
  host,
  id: id as TerminalId,
  meta: meta(branch, intent),
  recencyAt: 1_000,
});

/** Both hosts carry a terminal; the REMOTE one is the one that moves. */
const here = () =>
  row(LOCAL, "aaaaaaaa-0000-4000-8000-000000000001", "alpha", "here");
const there = (intent: string) =>
  row(REMOTE, "bbbbbbbb-0000-4000-8000-000000000002", "beta", intent);

const STATE = {
  phase: "idle",
  commands: [],
} as unknown as ConductorState;

/** The works the menu offers, as kolu would have them: one waiting on the
 *  human, one the agents are on, one merged. */
const AGENTS = "branch:local/%2Fr/agents" as WorkId;
const PANE = "branch:local/%2Fr/pane" as WorkId;
const FOLDERS = "branch:local/%2Fr/folders" as WorkId;
/** The fleet ref of the local terminal above — `host/id`, the key membership
 *  is kept under. */
const ALPHA_REF = "local/aaaaaaaa-0000-4000-8000-000000000001";

const opened = (title: string, branch: string): Work =>
  openWork({
    key: { kind: "branch", host: "local", repo: "/r", branch },
    title,
    at: "2026-11-16T01:00:00.000Z",
    request: { kind: "none" },
  });

/** In the works collection's own order: in progress oldest first, then the
 *  finished ones. The one with a question open — the one that needs the
 *  human — is the SECOND of them, so a menu that offers it first is offering
 *  it by the needs-you reading and not by the collection's order.
 *
 *  Immutable records, so one list serves every test. */
const WORKS: WorkRow[] = [
  [PANE, opened("Page chats open in a pane", "pane")],
  [
    AGENTS,
    askQuestions(opened("Published agents fetchable by any host", "agents"), {
      ask: "ask-checks",
      questions: [
        {
          id: "q",
          topic: "work",
          question: "May I update master's required checks?",
          header: { kind: "none" },
          options: ["Yes, after a dry run", "No, leave it to me"],
          multiple: false,
          file: { kind: "none" },
        },
      ],
      at: "2026-11-16T02:00:00.000Z",
    }),
  ],
  [
    FOLDERS,
    endWork(opened("Folders inside a work's files", "folders"), {
      outcome: { kind: "merged", pr: 2401 },
      at: "2026-11-16T03:25:00.000Z",
    }),
  ],
];
/** The one reading of what needs the human, over those records. */
const NEEDS: ReadonlyArray<NeedsYou> = needsYou(WORKS);

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  setComposerText("");
  showAllChat();
  sent.prompt.mockReset();
  mirror.works = () => [];
  mirror.needs = () => [];
  mirror.membership = () => new Map();
  unpickWork();
});

/** Mount the composer over a fleet whose rows the caller can move — and over
 *  the works it names — and put `text` in the box with the caret at its end:
 *  the input event is how the component learns where the caret is, so the
 *  menu opens the way a typed `@` opens it rather than by poking at
 *  internals. */
function mount(
  text: string,
  works: ReadonlyArray<WorkRow> = [],
  needs: ReadonlyArray<NeedsYou> = [],
  members: ReadonlyMap<string, Membership> = new Map(),
): {
  readonly el: HTMLElement;
  readonly box: HTMLTextAreaElement;
  readonly tick: (rows: FleetTerminalRow[]) => void;
} {
  const [rows, setRows] = createSignal<FleetTerminalRow[]>([
    here(),
    there("first"),
  ]);
  fleet.read = rows;
  mirror.works = () => works;
  mirror.needs = () => needs;
  mirror.membership = () => members;
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <Shown value={() => true}>
        <ConductorComposer state={STATE} />
      </Shown>
    ),
    root,
  );
  const box = root.querySelector<HTMLTextAreaElement>(
    '[data-testid="conductor-input"]',
  );
  if (box === null) throw new Error("the composer did not render its box");
  box.value = text;
  box.setSelectionRange(text.length, text.length);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
  return {
    el: root,
    box,
    // A fleet frame, as the composer sees it: on the frame after.
    tick: (next: FleetTerminalRow[]) => {
      setRows(next);
      flush();
    },
  };
}

/** What the one Send on screen was handed. */
const sentMentions = (): ReadonlyArray<ConductorMention> =>
  sent.prompt.mock.calls[0]?.[1] as ReadonlyArray<ConductorMention>;

const press = (el: HTMLElement, key: string): void => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  flush();
};

const rowsIn = (el: HTMLElement, testId: string): HTMLElement[] => [
  ...el.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];

describe("the `@` menu across a fleet tick", () => {
  it("keeps every candidate row's node when an UNRELATED host's terminal changes", () => {
    const { el, tick } = mount("@");
    const before = rowsIn(el, "conductor-mention-row");
    expect(before.map((node) => node.dataset.terminalId)).toEqual([
      "aaaaaaaa-0000-4000-8000-000000000001",
      "bbbbbbbb-0000-4000-8000-000000000002",
    ]);

    // The remote host retitles a terminal: a new row array, new row objects,
    // new candidate objects — the whole fleet notification, as it arrives.
    tick([here(), there("second")]);

    const after = rowsIn(el, "conductor-mention-row");
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    // …and the retained node is LIVE, not frozen: the host that moved shows
    // its new intent inside the very node that was kept.
    expect(after[1]?.textContent).toContain("second");
  });

  it("keeps an armed chip's node across the same tick", () => {
    const { el, tick } = mount("@alpha ");
    const before = rowsIn(el, "conductor-mention-chip");
    expect(before).toHaveLength(1);

    tick([here(), there("second")]);

    const after = rowsIn(el, "conductor-mention-chip");
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(before[0]);
  });
});

describe("the `@` menu offers the works first", () => {
  it("lists what needs the human, then what is in progress, then the finished, then the terminals", () => {
    const { el } = mount("@", WORKS, NEEDS);
    const rows = rowsIn(el, "conductor-mention-row");
    expect(rows.map((node) => node.dataset.kind)).toEqual([
      "work",
      "work",
      "work",
      "terminal",
      "terminal",
    ]);
    expect(rows.slice(0, 3).map((node) => node.dataset.work)).toEqual([
      AGENTS,
      PANE,
      FOLDERS,
    ]);
    expect(
      rowsIn(el, "conductor-mention-heading").map((node) => node.textContent),
    ).toEqual(["Works", "Terminals"]);
  });

  it("says where each work stands, in the card's own words", () => {
    const { el } = mount("@", WORKS, NEEDS);
    const details = rowsIn(el, "conductor-mention-detail")
      .filter((node) => node.dataset.kind === "work")
      .map((node) => node.textContent);
    // THE CARD'S LEAD, not a second vocabulary for the same fact — the menu
    // row says what the work column says about that work.
    expect(details).toEqual(
      [AGENTS, PANE, FOLDERS].map((id) => {
        const record = new Map(WORKS).get(id);
        if (record === undefined) throw new Error(`no record for ${id}`);
        return standingLine(record, Option.none()).lead;
      }),
    );
    // …which for the one waiting on a person names them, and for the one
    // that ended names how.
    expect(details[0]).toMatch(/you/i);
    expect(details[2]).toBe("Merged #2401");
  });

  it("says which work a MEMBER terminal is in instead of the intent it was made with", () => {
    const { el } = mount(
      "@alpha",
      WORKS,
      NEEDS,
      new Map<string, Membership>([
        [
          ALPHA_REF,
          {
            work: PANE,
            title: "Page chats open in a pane",
            role: "planner",
            driver: "conductor",
          },
        ],
      ]),
    );
    const detail = rowsIn(el, "conductor-mention-detail")[0];
    expect(detail?.textContent).toBe("planner of «Page chats open in a pane»");
  });
});

describe("completing a work", () => {
  it("offers `@pa` as the pane work, and Enter writes its slug and chips it", () => {
    const { el, box } = mount("@pa", WORKS, NEEDS);
    expect(rowsIn(el, "conductor-mention-row")[0]?.dataset.work).toBe(PANE);

    press(box, "Enter");

    expect(box.value).toBe("@page-chats-open-in-a-pane ");
    const chip = rowsIn(el, "conductor-mention-chip")[0];
    expect(chip?.dataset.kind).toBe("work");
    expect(chip?.dataset.work).toBe(PANE);
    expect(chip?.textContent).toContain("Page chats open in a pane");
  });

  it("steps the highlight from the works into the terminals — one list", () => {
    const { el, box } = mount("@", WORKS, NEEDS);
    for (let i = 0; i < 3; i++) press(box, "ArrowDown");
    const rows = rowsIn(el, "conductor-mention-row");
    expect(rows[3]?.dataset.kind).toBe("terminal");
    expect(rows[3]?.dataset.selected).toBe("");

    press(box, "Tab");
    expect(box.value).toBe("@alpha ");
  });

  it("sends the work the words named, as a work", () => {
    const { el } = mount(
      "what is left in @page-chats-open-in-a-pane",
      WORKS,
      NEEDS,
    );
    el.querySelector<HTMLElement>('[data-testid="conductor-send"]')?.click();
    expect(sentMentions()).toEqual([
      { kind: "work", work: PANE, title: "Page chats open in a pane" },
    ]);
  });

  it("keeps a terminal mention a terminal", () => {
    const { el } = mount("@alpha go", WORKS, NEEDS);
    el.querySelector<HTMLElement>('[data-testid="conductor-send"]')?.click();
    expect(sentMentions()).toEqual([
      {
        kind: "terminal",
        terminalId: "aaaaaaaa-0000-4000-8000-000000000001",
        host: "local",
        name: "alpha",
        intent: "here",
        cwd: "/home/srid/code/kolu",
      },
    ]);
  });
});

describe("the welcome's example ask", () => {
  it("writes the words into the box, caret after them, and sends nothing", () => {
    const text = "Plan and build a dark mode toggle";
    const { box } = mount("");
    askFromWelcome(text);
    flush();

    expect(box.value).toBe(text);
    expect(composerText()).toBe(text);
    expect(box.selectionStart).toBe(text.length);
    expect(sent.prompt).not.toHaveBeenCalled();
  });
});

describe("a chat pointed at one piece of work", () => {
  it("shows it as a chip, asks about it, and sends it with the message", () => {
    aboutWork(PANE);
    const { el, box } = mount("what is left?", WORKS, NEEDS);
    const chip = el.querySelector<HTMLElement>(
      '[data-testid="conductor-scope-chip"]',
    );
    expect(chip?.dataset.work).toBe(PANE);
    expect(chip?.textContent).toContain("Page chats open in a pane");
    expect(box.placeholder).toBe("Ask about this work…");

    el.querySelector<HTMLElement>('[data-testid="conductor-send"]')?.click();
    expect(sentMentions()).toEqual([
      { kind: "work", work: PANE, title: "Page chats open in a pane" },
    ]);
  });

  it("does not name the work twice when the words already did", () => {
    aboutWork(PANE);
    const { el } = mount("@page-chats-open-in-a-pane and now?", WORKS, []);
    el.querySelector<HTMLElement>('[data-testid="conductor-send"]')?.click();
    expect(sentMentions()).toHaveLength(1);
  });

  it("hands the whole chat back when the chip's × is pressed", () => {
    aboutWork(PANE);
    const { el } = mount("hello", WORKS, []);
    el.querySelector<HTMLElement>(
      '[data-testid="conductor-scope-chip-remove"]',
    )?.click();
    flush();
    expect(el.querySelector('[data-testid="conductor-scope-chip"]')).toBeNull();
  });

  it("goes to the work when the chip's name is pressed, and keeps the chip", () => {
    aboutWork(PANE);
    const { el } = mount("hello", WORKS, []);
    el.querySelector<HTMLElement>(
      '[data-testid="conductor-scope-chip"] [data-testid="work-chip"]',
    )?.click();
    flush();
    expect(pickedWork()).toBe(PANE);
    expect(
      el.querySelector('[data-testid="conductor-scope-chip"]'),
    ).not.toBeNull();
  });
});

describe("a work mentioned in the box", () => {
  it("goes to the work from its name, and only its × takes it out", () => {
    const { el, box } = mount("@pa", WORKS, NEEDS);
    press(box, "Enter");
    const chip = () => rowsIn(el, "conductor-mention-chip")[0];
    chip()?.querySelector<HTMLElement>('[data-testid="work-chip"]')?.click();
    flush();
    expect(pickedWork()).toBe(PANE);
    expect(chip()).toBeDefined();
    chip()
      ?.querySelector<HTMLElement>(
        '[data-testid="conductor-mention-chip-remove"]',
      )
      ?.click();
    flush();
    expect(rowsIn(el, "conductor-mention-chip")).toHaveLength(0);
    expect(box.value).not.toContain("@page-chats-open-in-a-pane");
  });
});
