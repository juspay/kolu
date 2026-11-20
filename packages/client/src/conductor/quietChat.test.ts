import type { ConductorRow } from "kolu-common/conductor";
import { describe, expect, it } from "vitest";
import { firstSentence, quietChat, type WorkNote } from "./quietChat";

describe("firstSentence, over last night's replies", () => {
  it("keeps a handed-over PR's head together with the sentence (07:12)", () => {
    expect(
      firstSentence(
        "The olai PR is ready for you: https://github.com/juspay/olai/pull/700 at head `c8897e2`, reviewed three times, with ten lanes green and not merged. That was the last thing running, so here is where the night ended.\n\n## Merged\n",
      ),
    ).toBe(
      "The olai PR is ready for you: https://github.com/juspay/olai/pull/700 at head c8897e2, reviewed three times, with ten lanes green and not merged.",
    );
  });

  it("does not stop inside a commit hash (03:25)", () => {
    expect(
      firstSentence(
        "PR #2401 is merged into kolu master as `69b08e9`, by a normal squash merge with every check green, which closes out #2399. I've closed both of its terminals.\n",
      ),
    ).toBe(
      "PR #2401 is merged into kolu master as 69b08e9, by a normal squash merge with every check green, which closes out #2399.",
    );
  });

  it("does not stop inside a dotted path (00:13)", () => {
    expect(
      firstSentence(
        "The olai mockup is ready: sixteen screenshots in `.waterfall/mockup/` of the `chat-on-any-entity` worktree on naiveintent, with a `README.md` that says what each shows. I have read the README but not looked at the pictures myself.\n",
      ),
    ).toBe(
      "The olai mockup is ready: sixteen screenshots in .waterfall/mockup/ of the chat-on-any-entity worktree on naiveintent, with a README.md that says what each shows.",
    );
  });

  it("does not stop inside a worktree path or a version (22:53)", () => {
    expect(
      firstSentence(
        "You chose trivial, so the implementor is starting on naiveintent with no planner, in a fresh worktree at `/home/srid/code/kolu/.worktrees/agents-fetchable-from-cache`, running omp with Opus 5.5. It merges on green.\n",
      ),
    ).toBe(
      "You chose trivial, so the implementor is starting on naiveintent with no planner, in a fresh worktree at /home/srid/code/kolu/.worktrees/agents-fetchable-from-cache, running omp with Opus 5.5.",
    );
  });

  it("does not stop inside a URL or a quoted title (00:52)", () => {
    expect(
      firstSentence(
        "The Conductor-next planner has filed the folder problem as a bug: https://github.com/juspay/kolu/issues/2399, \"A work's card ignores folders inside .waterfall/, so a planner's mockups never show and are not kept\". I sent it nothing.\n",
      ),
    ).toBe(
      "The Conductor-next planner has filed the folder problem as a bug: https://github.com/juspay/kolu/issues/2399, \"A work's card ignores folders inside .waterfall/, so a planner's mockups never show and are not kept\".",
    );
  });

  it("ends after the head a bare URL is followed by (23:22)", () => {
    expect(
      firstSentence(
        "The olai website PR is ready for you: https://github.com/juspay/olai/pull/699, at head `2de9f2348`. I have not merged it.\n\n- **CI:** the website and docs lanes are green.\n",
      ),
    ).toBe(
      "The olai website PR is ready for you: https://github.com/juspay/olai/pull/699, at head 2de9f2348.",
    );
  });

  it("takes the first of two short sentences (03:38)", () => {
    expect(
      firstSentence("Green, clean, on croissant per its table. Merging."),
    ).toBe("Green, clean, on croissant per its table.");
  });

  it("keeps a short opening sentence short (23:29)", () => {
    expect(
      firstSentence(
        "The olai planner has answered. It read code and docs only and ran nothing.\n\n**How it works today:** a chat belongs to an outline row.\n",
      ),
    ).toBe("The olai planner has answered.");
  });

  it("reads a reply that opens in lower case (01:11)", () => {
    expect(
      firstSentence(
        "odu PR #182 is merged into master as `3f1c65c`, by a normal squash merge with every check green. No other odu PR is open, so there is nothing to rebase.\n",
      ),
    ).toBe(
      "odu PR #182 is merged into master as 3f1c65c, by a normal squash merge with every check green.",
    );
  });

  it("stops at the sentence, not at the bold block under it (23:18)", () => {
    expect(
      firstSentence(
        "The #2398 planner has finished its plan, and I've put five questions on the work's card for you.\n\n**What it found:** hosts on Nix 2.35 or newer, and every Mac, cannot take any published agents.\n",
      ),
    ).toBe(
      "The #2398 planner has finished its plan, and I've put five questions on the work's card for you.",
    );
  });

  it("reads through a colon and a code span (03:30)", () => {
    expect(
      firstSentence(
        "Kolu PR #2400 is not merged yet: its new head, `98257c8`, came back red on two checks, and I've sent the implementor to run them again.\n\n**What is red:**\n",
      ),
    ).toBe(
      "Kolu PR #2400 is not merged yet: its new head, 98257c8, came back red on two checks, and I've sent the implementor to run them again.",
    );
  });
});

describe("firstSentence, on what is not a sentence", () => {
  it("folds a reply that opens with a heading to the heading", () => {
    expect(firstSentence("\n## Merged\n\n- odu #182 as `3f1c65c`.\n")).toBe(
      "Merged",
    );
  });

  it("folds a reply that opens with a list to its first item", () => {
    expect(
      firstSentence(
        "- **kolu #2402** at `09c0619`: green and reviewed.\n- olai #700.\n",
      ),
    ).toBe("kolu #2402 at 09c0619: green and reviewed.");
  });

  it("reads past a leading rule", () => {
    expect(firstSentence("---\n\nThe deploy is done. And more.")).toBe(
      "The deploy is done.",
    );
  });

  it("does not stop at e.g. or i.e.", () => {
    expect(
      firstSentence(
        "Some checks are flaky, e.g. the macOS build, so I re-ran them. Then I stopped.",
      ),
    ).toBe("Some checks are flaky, e.g. the macOS build, so I re-ran them.");
  });

  it("gives the whole paragraph when nothing ends it", () => {
    expect(firstSentence("Still working through the review")).toBe(
      "Still working through the review",
    );
  });

  it("says nothing for an empty reply", () => {
    expect(firstSentence("\n\n")).toBe("");
  });
});

const at = (minute: number): string =>
  new Date(Date.UTC(2026, 10, 17, 3, minute)).toISOString();

const head = (id: string, minute: number) => ({
  id,
  seq: minute,
  since: at(minute),
});

const user = (id: string, minute: number): ConductorRow => ({
  ...head(id, minute),
  kind: "user",
  text: "what is left?",
  attachments: [],
});

const agent = (id: string, minute: number, text: string): ConductorRow => ({
  ...head(id, minute),
  kind: "agent",
  text,
});

const wake = (id: string, minute: number): ConductorRow => ({
  ...head(id, minute),
  kind: "wake",
  from: "kolu",
  events: [],
  text: "the planner stopped",
});

const tool = (id: string, minute: number): ConductorRow => ({
  ...head(id, minute),
  kind: "tool",
  tool: "screen_text",
  text: "screen_text",
  detail: "",
  status: "completed",
});

const workAsk = (id: string, minute: number): ConductorRow => ({
  ...head(id, minute),
  kind: "work-ask",
  text: "May I update master's required checks?",
  work: "branch:local/%2Fr/a",
  ask: { fields: [], standing: { kind: "open" } },
});

const note = (minute: number, text: string): WorkNote => ({
  at: Date.parse(at(minute)),
  text,
});

describe("quietChat", () => {
  it("never folds a turn that began with your message", () => {
    const chat = quietChat(
      [user("u1", 0), agent("a1", 1, "Understood. I'll keep going.")],
      [],
    );
    const turn = chat.of.get("a1");
    expect(turn?.folds).toBe(false);
    expect(turn?.says).toEqual({
      kind: "prose",
      headline: "Understood.",
    });
  });

  it("leaves the newest reply open and folds the ones before it", () => {
    const chat = quietChat(
      [
        wake("w1", 0),
        agent("a1", 1, "The planner has opened PR #700."),
        wake("w2", 2),
        agent("a2", 3, "The PR is ready for you."),
      ],
      [],
    );
    expect(chat.of.get("w1")?.open).toBe(false);
    expect(chat.of.get("w2")?.open).toBe(true);
    expect(chat.turns.map((one) => one.folds)).toEqual([true, true]);
  });

  it("keeps a question in a folded turn", () => {
    const chat = quietChat(
      [
        wake("w1", 0),
        agent("a1", 1, "I need your word on the gate."),
        workAsk("q1", 2),
        wake("w2", 3),
        agent("a2", 4, "Merged."),
      ],
      [],
    );
    const turn = chat.of.get("w1");
    expect(turn?.open).toBe(false);
    expect([...(turn?.asks ?? [])]).toEqual(["q1"]);
  });

  it("reads the line off the turn's LAST reply (03:38)", () => {
    const chat = quietChat(
      [
        wake("w1", 38),
        agent("a1", 38, "Green, clean, on croissant per its table."),
        tool("t1", 39),
        agent(
          "a2",
          39,
          "Kolu PR #2400 is merged into master as `d3f4185`, with every check green on that exact head. Hosts can already take today's agents.",
        ),
        user("u1", 45),
      ],
      [],
    );
    expect(chat.of.get("w1")?.says).toEqual({
      kind: "prose",
      headline:
        "Kolu PR #2400 is merged into master as d3f4185, with every check green on that exact head.",
    });
  });

  it("says the note a turn wrote instead of a reply", () => {
    const chat = quietChat(
      [
        wake("w1", 0),
        tool("t1", 1),
        wake("w2", 10),
        agent("a2", 11, "Merged."),
      ],
      [
        note(2, "Second review accepted everything"),
        note(20, "later, elsewhere"),
      ],
    );
    expect(chat.of.get("w1")?.says).toEqual({
      kind: "noted",
      text: "Second review accepted everything",
    });
  });

  it("is a quiet line when a turn wrote neither prose nor a note", () => {
    const chat = quietChat([wake("w1", 0), tool("t1", 1)], []);
    expect(chat.of.get("w1")?.says).toEqual({ kind: "quiet" });
  });

  it("counts the replies since your last message", () => {
    const chat = quietChat(
      [
        wake("w0", 0),
        agent("a0", 1, "Before you spoke."),
        user("u1", 2),
        agent("a1", 3, "Understood."),
        wake("w1", 4),
        agent("a2", 5, "The planner has opened PR #700."),
        wake("w2", 6),
        agent("a3", 7, "It is merged."),
      ],
      [],
    );
    expect(chat.since).toEqual({ from: "w1", count: 2 });
  });

  it("has no heading when nothing followed your message", () => {
    expect(quietChat([user("u1", 0), agent("a1", 1, "Done.")], []).since).toBe(
      null,
    );
    expect(quietChat([wake("w1", 0), agent("a1", 1, "Done.")], []).since).toBe(
      null,
    );
  });
});
