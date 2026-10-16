/** A host's history log and `last-success` stamp, read back into the events
 *  and the last run its receipt carries. */

import { describe, expect, it } from "vitest";
import {
  historyAuthor,
  lastRunOf,
  RECEIPT_EVENTS,
  recentEvents,
  SAME_RUN_MS,
} from "./receipt.ts";

/** Real lines from a host's `agent-distro/history.log` — written before the
 *  one-package release, each naming its profile — then lines after it. */
const REAL = [
  "2026-10-05T12:12:31Z juspay skipped: bundle not fully cached yet (would build agent-distro-versions)",
  "2026-10-06T10:13:01-04:00 juspay updated: Codex 0.160.0 → 0.160.1, Claude Code 2.1.289 → 2.1.291",
  "2026-10-06T22:07:03-04:00 juspay updated: Oh My Pi 18.6.2 → 18.6.3",
  "2026-10-07T04:15:51-04:00 juspay skipped: bundle not fully cached yet (would build agent-distro-versions)",
  "2026-10-08T02:00:05+00:00 updated: Claude Code 2.1.292 → 2.1.293, juspay a1b2c3d → d4e5f6a",
  "2026-10-08T02:00:09+00:00 failed: nix build exit 1",
  "",
].join("\n");

describe("recentEvents", () => {
  it("keeps the last five, newest first — old and new lines alike", () => {
    const events = recentEvents(REAL);
    expect(events).toHaveLength(RECEIPT_EVENTS);
    expect(events.map((e) => e.at)).toEqual([
      "2026-10-08T02:00:09+00:00",
      "2026-10-08T02:00:05+00:00",
      "2026-10-07T04:15:51-04:00",
      "2026-10-06T22:07:03-04:00",
      "2026-10-06T10:13:01-04:00",
    ]);
  });

  it("reads a pre-#115 line's kind and words, and keeps the profile it named", () => {
    expect(
      recentEvents(
        "2026-10-06T22:07:03-04:00 juspay updated: Oh My Pi 18.6.2 → 18.6.3\n",
      ),
    ).toEqual([
      {
        at: "2026-10-06T22:07:03-04:00",
        kind: "updated",
        words: "Oh My Pi 18.6.2 → 18.6.3",
        profile: "juspay",
      },
    ]);
  });

  it("an empty log has no events", () => {
    expect(recentEvents("")).toEqual([]);
  });

  it("throws on a line upstream's reader refuses — never a silently shorter history", () => {
    expect(() => recentEvents(`${REAL}garbage\n`)).toThrow(/history line/);
    expect(() =>
      recentEvents("2026-10-08T02:00:04Z rebooted: why\n"),
    ).toThrow();
  });
});

describe("historyAuthor", () => {
  it("a skip or a failure is agent-distro's updater; an update or a stamp is the log's", () => {
    expect(historyAuthor("skipped")).toBe("agent-distro");
    expect(historyAuthor("failed")).toBe("agent-distro");
    expect(historyAuthor("updated")).toBe("log");
    expect(historyAuthor("unchanged")).toBe("log");
  });
});

describe("lastRunOf — the last run, off the files alone", () => {
  const events = recentEvents(REAL);
  const failedAt = Date.parse("2026-10-08T02:00:09+00:00");

  it("the newest event, when the stamp is that same run", () => {
    expect(lastRunOf(events, failedAt / 1000)).toEqual({
      at: failedAt,
      outcome: "failed",
      words: "nix build exit 1",
      by: "agent-distro",
    });
    // Within SAME_RUN_MS the stamp is still that run.
    expect(lastRunOf(events, (failedAt + SAME_RUN_MS) / 1000)?.outcome).toBe(
      "failed",
    );
  });

  it("an unchanged run when the stamp is later than every event", () => {
    const later = failedAt / 1000 + 6 * 3600;
    expect(lastRunOf(events, later)).toEqual({
      at: later * 1000,
      outcome: "unchanged",
      words: "",
      by: "log",
    });
    expect(lastRunOf([], later)).toMatchObject({ outcome: "unchanged" });
  });

  it("an update with no stamp is the last run, by the log", () => {
    const updated = recentEvents(
      "2026-10-08T02:00:05+00:00 updated: Claude Code 2.1.292 → 2.1.293\n",
    );
    expect(lastRunOf(updated, null)).toEqual({
      at: Date.parse("2026-10-08T02:00:05+00:00"),
      outcome: "updated",
      words: "Claude Code 2.1.292 → 2.1.293",
      by: "log",
    });
  });

  it("nothing before any run", () => {
    expect(lastRunOf([], null)).toBeUndefined();
  });
});

describe("lastRunOf — a legacy line's profile", () => {
  it("carries the profile a pre-#115 line named into the last run", () => {
    const events = recentEvents(
      "2026-10-06T22:07:03-04:00 juspay updated: Oh My Pi 18.6.2 → 18.6.3\n",
    );
    expect(lastRunOf(events, null)).toMatchObject({
      outcome: "updated",
      words: "Oh My Pi 18.6.2 → 18.6.3",
      profile: "juspay",
    });
  });
});
