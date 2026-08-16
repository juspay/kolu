import { describe, expect, it } from "vitest";
import { stampEpisode, type AgentEpisode } from "./sensors.ts";

function episode(partial: Partial<AgentEpisode> = {}): AgentEpisode {
  return {
    since: null,
    pid: undefined,
    watchedShellIdle: false,
    ...partial,
  };
}

describe("stampEpisode", () => {
  it("dates the idle→busy edge and does not restamp a later busy pid", () => {
    const ep = episode({ watchedShellIdle: true });
    stampEpisode(ep, 111);
    expect(ep.pid).toBe(111);
    expect(ep.since).not.toBeNull();
    expect(ep.watchedShellIdle).toBe(false);
    const first = ep.since;
    stampEpisode(ep, 222);
    expect(ep.pid).toBe(222);
    expect(ep.since).toBe(first);
  });
});
