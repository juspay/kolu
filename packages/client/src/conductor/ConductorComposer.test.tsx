// @vitest-environment happy-dom

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
import { type Accessor, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FleetTerminalRow } from "../palette/fleetTerminals";
import { aboutWork, showAllChat } from "./chatScope";
import { setComposerText } from "./drafts";
import ConductorComposer from "./ConductorComposer";
import { standingLine } from "./workReadings";
import { Shown } from "../ui/shown";

const fleet = vi.hoisted(() => ({
  read: (() => []) as Accessor<FleetTerminalRow[]>,
}));
vi.mock(import("../palette/fleetTerminals"), async (importOriginal) => ({
  ...(await importOriginal()),
  useFleetTerminalIndex: () => fleet.read,
}));
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
}));
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

const here = () =>
  row(LOCAL, "aaaaaaaa-0000-4000-8000-000000000001", "alpha", "here");
const there = (intent: string) =>
  row(REMOTE, "bbbbbbbb-0000-4000-8000-000000000002", "beta", intent);

const STATE = {
  phase: "idle",
  commands: [],
} as unknown as ConductorState;

const AGENTS = "branch:local/%2Fr/agents" as WorkId;
const PANE = "branch:local/%2Fr/pane" as WorkId;
const FOLDERS = "branch:local/%2Fr/folders" as WorkId;
const ALPHA_REF = "local/aaaaaaaa-0000-4000-8000-000000000001";

const opened = (title: string, branch: string): Work =>
  openWork({
    key: { kind: "branch", host: "local", repo: "/r", branch },
    title,
    at: "2026-11-16T01:00:00.000Z",
    request: { kind: "none" },
  });

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
});

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
      <Shown.Provider value={() => true}>
        <ConductorComposer state={STATE} />
      </Shown.Provider>
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
  return { el: root, box, tick: setRows };
}

const sentMentions = (): ReadonlyArray<ConductorMention> =>
  sent.prompt.mock.calls[0]?.[1] as ReadonlyArray<ConductorMention>;

const press = (el: HTMLElement, key: string): void => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
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

    tick([here(), there("second")]);

    const after = rowsIn(el, "conductor-mention-row");
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
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
    expect(details).toEqual(
      [AGENTS, PANE, FOLDERS].map((id) => {
        const record = new Map(WORKS).get(id);
        if (record === undefined) throw new Error(`no record for ${id}`);
        return standingLine(record, Option.none()).lead;
      }),
    );
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
      '[data-testid="conductor-scope-chip"]',
    )?.click();
    expect(el.querySelector('[data-testid="conductor-scope-chip"]')).toBeNull();
  });
});
