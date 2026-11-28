/** A reply's first sentence: the one line a notification says about it.
 *
 *  The headlines below are the openings of real replies from the night of
 *  16–17 November — the awkward ones first, because that is where a
 *  first-sentence rule goes wrong: a commit hash, a path and a version
 *  number are full stops that end nothing, and a URL is a sentence's worth of
 *  them. */

import { describe, expect, it } from "vitest";
import { firstSentence } from "./firstSentence";

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
  it("takes the heading of a reply that opens with one", () => {
    expect(firstSentence("\n## Merged\n\n- odu #182 as `3f1c65c`.\n")).toBe(
      "Merged",
    );
  });

  it("takes the first item of a reply that opens with a list", () => {
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
