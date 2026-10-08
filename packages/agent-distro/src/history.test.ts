import { describe, expect, it } from "vitest";
import { lastRunOf, parseHistoryLine, recentEvents } from "./history.ts";

/** Real lines from a host's `agent-distro/history.log` (2026-10-05..07). */
const REAL = [
  "2026-10-05T12:12:31Z juspay skipped: bundle not fully cached yet (would build agent-distro-versions)",
  "2026-10-05T09:23:41-04:00 juspay updated: Oh My Pi 18.5.0 → 18.6.2, Claude Code 2.1.288 → 2.1.289, OpenCode v2 2.0.22 → 2.0.23, Pi 1.0.0 → 1.0.3",
  "2026-10-06T08:09:27-04:00 juspay skipped: bundle not fully cached yet (would build agent-distro-versions)",
  "2026-10-06T10:13:01-04:00 juspay updated: Codex 0.160.0 → 0.160.1, Claude Code 2.1.289 → 2.1.291, OpenCode v2 2.0.23 → 2.0.24, Pi 1.0.3 → 1.0.4",
  "2026-10-06T16:10:17-04:00 juspay skipped: bundle not fully cached yet (would build agent-distro-versions)",
  "2026-10-06T22:07:03-04:00 juspay updated: Oh My Pi 18.6.2 → 18.6.3",
  "2026-10-07T04:15:51-04:00 juspay skipped: bundle not fully cached yet (would build agent-distro-versions)",
  "2026-10-07T06:15:53-04:00 vanilla updated: Oh My Pi 18.7.0, Codex 0.160.1, Claude Code 2.1.292, OpenCode 1.18.35+53d1eab, OpenCode v2 2.0.24, Pi 1.0.4",
  "",
].join("\n");

describe("parseHistoryLine", () => {
  it("reads time, profile, kind and the updater's own words", () => {
    expect(
      parseHistoryLine(
        "2026-10-06T22:07:03-04:00 juspay updated: Oh My Pi 18.6.2 → 18.6.3",
      ),
    ).toEqual({
      at: "2026-10-06T22:07:03-04:00",
      profile: "juspay",
      kind: "updated",
      words: "Oh My Pi 18.6.2 → 18.6.3",
    });
    expect(
      parseHistoryLine(
        "2026-10-05T12:12:31Z juspay skipped: bundle not fully cached yet (would build agent-distro-versions)",
      ).kind,
    ).toBe("skipped");
    expect(
      parseHistoryLine(
        "2026-10-08T02:00:04+00:00 vanilla failed: nix build exit 1",
      ),
    ).toMatchObject({ kind: "failed", words: "nix build exit 1" });
  });
  it("throws on a line that is not the documented shape", () => {
    expect(() => parseHistoryLine("garbage")).toThrow();
    expect(() =>
      parseHistoryLine("2026-10-08T02:00:04Z vanilla rebooted: why"),
    ).toThrow();
    expect(() => parseHistoryLine("notatime vanilla updated: x")).toThrow();
  });
});

describe("recentEvents", () => {
  it("keeps one profile's last five, newest first", () => {
    const juspay = recentEvents(REAL, "juspay");
    expect(juspay.map((e) => e.at)).toEqual([
      "2026-10-07T04:15:51-04:00",
      "2026-10-06T22:07:03-04:00",
      "2026-10-06T16:10:17-04:00",
      "2026-10-06T10:13:01-04:00",
      "2026-10-06T08:09:27-04:00",
    ]);
    expect(recentEvents(REAL, "vanilla")).toHaveLength(1);
    expect(recentEvents("", "vanilla")).toEqual([]);
  });
});

describe("lastRunOf — the last run, off the files alone", () => {
  const events = recentEvents(REAL, "vanilla");
  const updatedAt = Date.parse("2026-10-07T06:15:53-04:00");
  it("the newest event, when the stamp is that same run", () => {
    expect(lastRunOf(events, updatedAt / 1000)).toEqual({
      at: updatedAt,
      outcome: "updated",
      words:
        "Oh My Pi 18.7.0, Codex 0.160.1, Claude Code 2.1.292, OpenCode 1.18.35+53d1eab, OpenCode v2 2.0.24, Pi 1.0.4",
    });
  });
  it("an unchanged run when the stamp is later than every event", () => {
    const later = updatedAt / 1000 + 6 * 3600;
    expect(lastRunOf(events, later)).toEqual({
      at: later * 1000,
      outcome: "unchanged",
      words: "",
    });
    expect(lastRunOf([], later)).toMatchObject({ outcome: "unchanged" });
  });
  it("a skip after the last success is the last run", () => {
    const juspay = recentEvents(REAL, "juspay");
    const stamp = Date.parse("2026-10-06T22:07:03-04:00") / 1000;
    expect(lastRunOf(juspay, stamp)).toMatchObject({ outcome: "skipped" });
  });
  it("nothing before any run", () => {
    expect(lastRunOf([], null)).toBeUndefined();
  });
});
