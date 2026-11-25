/** What the `@` menu offers: the works, in the one order, and each terminal
 *  with the row detail that tells it from the others under the same name.
 *  Same-named terminals are ordinary — one repo, several branches — and a
 *  menu of five identical rows is a choice a person cannot make. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  type Membership,
  type NeedsYou,
  openWork,
  type Work,
  type WorkId,
} from "kolu-work";
import { describe, expect, it } from "vitest";
import type { FleetTerminalRow } from "../palette/fleetTerminals";
import {
  fleetMentionCandidates,
  memberDetail,
  mentionDetail,
  workMentionCandidates,
} from "./mentionCandidates";
import { armedMentions } from "./mentions";

const meta = (fields: Record<string, unknown>): TerminalMetadata =>
  ({
    state: "active",
    cwd: "/home/srid/code/kolu",
    agent: null,
    ...fields,
  }) as unknown as TerminalMetadata;

describe("mentionDetail", () => {
  it("is the intent a person gave the terminal, first line only", () => {
    expect(
      mentionDetail(
        meta({
          intent: "fix the parser\nand its tests",
          agent: { kind: "claude-code", state: "waiting" },
        }),
      ),
    ).toEqual({ kind: "intent", text: "fix the parser" });
  });

  it("is the agent and its state when there is no intent", () => {
    const detail = mentionDetail(
      meta({ agent: { kind: "claude-code", state: "waiting" } }),
    );
    expect(detail?.kind).toBe("agent");
    expect(detail?.text).toMatch(/^Claude Code · \S/);
  });

  it("is the directory when there is neither", () => {
    expect(mentionDetail(meta({ intent: "  " }))).toEqual({
      kind: "directory",
      text: "/home/srid/code/kolu",
    });
  });

  it("names no agent for a sleeping terminal — it has no live one", () => {
    expect(
      mentionDetail(
        meta({
          state: "sleeping",
          agent: { kind: "claude-code", state: "waiting" },
        }),
      )?.kind,
    ).toBe("directory");
  });
});

const work = (title: string, at: string): Work =>
  openWork({
    key: {
      kind: "branch",
      host: "local",
      repo: "/r",
      branch: title,
      repoBy: "git",
    },
    title,
    at,
    request: { kind: "none" },
  });

const AGENTS = "branch:local/%2Fr/agents" as WorkId;
const PANE = "branch:local/%2Fr/pane" as WorkId;
const FOLDERS = "branch:local/%2Fr/folders" as WorkId;

describe("memberDetail", () => {
  it("names the work a terminal is a member of, and its part in it", () => {
    const at: Membership = {
      work: PANE,
      title: "Page chats open in a pane",
      role: "planner",
      driver: "conductor",
    };
    expect(memberDetail(at)).toEqual({
      kind: "work",
      text: "planner of «Page chats open in a pane»",
    });
  });
});

describe("fleetMentionCandidates", () => {
  const LOCAL: HostKey = { kind: "local" };
  const ID = "aaaaaaaa-0000-4000-8000-000000000001" as TerminalId;
  const rows: FleetTerminalRow[] = [
    {
      host: LOCAL,
      id: ID,
      meta: meta({
        intent: "take the olai PR to green",
        git: { kind: "repo", info: { repoName: "kolu", branch: "pane" } },
      }),
      recencyAt: 1_000,
    },
  ];

  it("says which work a MEMBER is in, not the intent it was created with", () => {
    // The intent names the work it was cut for, which can be hours dead; the
    // membership is where the terminal stands now.
    const at: Membership = {
      work: PANE,
      title: "Page chats open in a pane",
      role: "implementor",
      driver: "conductor",
    };
    const [one] = fleetMentionCandidates(rows, new Map([[`local/${ID}`, at]]));
    expect(one?.detail).toEqual({
      kind: "work",
      text: "implementor of «Page chats open in a pane»",
    });
  });

  it("keeps today's detail for a terminal in no work", () => {
    const [one] = fleetMentionCandidates(rows, new Map());
    expect(one?.detail).toEqual({
      kind: "intent",
      text: "take the olai PR to green",
    });
  });
});

describe("workMentionCandidates", () => {
  const works = [
    [PANE, work("Page chats open in a pane", "2026-11-16T01:00:00.000Z")],
    [
      AGENTS,
      work(
        "Published agents fetchable by any host",
        "2026-11-16T02:00:00.000Z",
      ),
    ],
    [
      FOLDERS,
      work("Folders inside a work's files", "2026-11-16T03:00:00.000Z"),
    ],
  ] as const;
  const needs = [{ work: AGENTS } as NeedsYou, { work: FOLDERS } as NeedsYou];

  const NONE: ReadonlySet<string> = new Set();

  it("offers what needs the human first, then the rest in the works' order", () => {
    expect(
      workMentionCandidates([...works], needs, NONE).map((one) => one.work),
    ).toEqual([AGENTS, FOLDERS, PANE]);
  });

  it("offers each work once, by a slug of its title, with where it stands", () => {
    const [first] = workMentionCandidates([...works], [], NONE);
    expect(first).toMatchObject({
      kind: "work",
      work: PANE,
      name: "page-chats-open-in-a-pane",
      title: "Page chats open in a pane",
    });
    // The card's own lead, not a second vocabulary for the same fact.
    expect(first?.standing).toBe("Agents at work");
  });

  it("drops a wait whose work the mirror no longer lists", () => {
    expect(
      workMentionCandidates(
        [works[0]],
        [{ work: AGENTS } as NeedsYou],
        NONE,
      ).map((one) => one.work),
    ).toEqual([PANE]);
  });

  it("gives two works of one title each its own word, and each word picks its own work", () => {
    // The real store: "Published agents fetchable by any host" twice — one
    // stopped, one merged as #2400 — on two branches of one repo.
    const title = "Published agents fetchable by any host";
    const stopped = "branch:local/%2Fr/agents-closure" as WorkId;
    const merged = "branch:local/%2Fr/agents-closure-in-cache" as WorkId;
    const offered = workMentionCandidates(
      [
        [stopped, work(title, "2026-11-16T01:00:00.000Z")],
        [merged, work(title, "2026-11-16T02:00:00.000Z")],
      ],
      [],
      NONE,
    );
    expect(offered.map((one) => one.name)).toEqual([
      "published-agents-fetchable-by-any-host-agents-closure",
      "published-agents-fetchable-by-any-host-agents-closure-in-cache",
    ]);
    for (const row of offered)
      expect(armedMentions(`@${row.name} ok`, offered)).toEqual([
        { token: row.name, mention: { kind: "work", work: row.work, title } },
      ]);
  });

  it("never takes a word a terminal is already called", () => {
    const [one] = workMentionCandidates(
      [[PANE, work("Page chats", "2026-11-16T01:00:00.000Z")]],
      [],
      new Set(["page-chats"]),
    );
    expect(one?.name).toBe("page-chats-pane");
  });
});
