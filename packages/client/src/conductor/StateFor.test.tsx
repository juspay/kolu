// @vitest-environment happy-dom
/**
 * A TERMINAL'S STATE, AND FOR HOW LONG: the time is kolu's watch's, and it is
 * said only beside the word it measures. A terminal the browser is still
 * finding, or one whose watch has it at another level, shows its word alone.
 */

import type { MemberReading } from "kolu-common/works";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import StateFor from "./StateFor";

const NOW = Date.parse("2026-01-01T02:00:00Z");
const TWO_HOURS: MemberReading = {
  level: "working",
  since: "2026-01-01T00:00:00Z",
} as MemberReading;

const thinking: FleetTerminalStanding = {
  kind: "here",
  meta: {
    state: "active",
    foreground: null,
    agent: { kind: "claude-code", state: "thinking" },
  } as never,
};
const loading: FleetTerminalStanding = { kind: "loading" };

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

function draw(standing: FleetTerminalStanding): HTMLElement {
  const host = document.createElement("div");
  dispose = render(
    () => (
      <StateFor
        word="thinking"
        standing={standing}
        reading={TWO_HOURS}
        now={NOW}
        testId="since"
      />
    ),
    host,
  );
  return host;
}

describe("a terminal's state and how long", () => {
  it("says the watch's time beside the word it measures", () => {
    expect(draw(thinking).textContent).toBe("thinking for 2h 0m");
  });

  it("says the word alone when the watch measures something else", () => {
    const el = draw(loading);
    expect(el.textContent).toBe("thinking");
    expect(el.querySelector('[data-testid="since"]')).toBeNull();
  });
});
