/** The two files `default.nix` bakes for agent-distro, as padi and
 *  kolu-server parse them. */

import { describe, expect, it } from "vitest";
import { parseAgentDistroDelivery, parseAgentDistroHostState } from "./bake.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

describe("parseAgentDistroHostState", () => {
  const state = {
    stateHomePlaceholder: PLACEHOLDER,
    state: `${PLACEHOLDER}/agent-distro/abc`,
    history: `${PLACEHOLDER}/agent-distro/history.log`,
    landed: `${PLACEHOLDER}/kolu/agent-distro-landed.json`,
  };

  it("reads the package's state directory, the shared history log and kolu's landed record", () => {
    expect(parseAgentDistroHostState(JSON.stringify(state))).toEqual(state);
  });
  it("throws on a host state without its landed record — a broken build", () => {
    const { landed: _, ...noLanded } = state;
    expect(() => parseAgentDistroHostState(JSON.stringify(noLanded))).toThrow();
  });
  it("throws on an empty path, or on text that is no JSON", () => {
    expect(() =>
      parseAgentDistroHostState(JSON.stringify({ ...state, state: "" })),
    ).toThrow();
    expect(() => parseAgentDistroHostState("state")).toThrow();
  });
});

describe("parseAgentDistroDelivery", () => {
  const delivery = {
    flake: "github:juspay/agent-distro",
    index: "https://index.example.org/ca-index",
    cache: {
      url: "https://cache.example.org",
      publicKey: "cache.example.org-1:AAAA",
    },
    schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
  };

  it("reads the index, the cache and the schedule", () => {
    expect(parseAgentDistroDelivery(JSON.stringify(delivery))).toEqual(
      delivery,
    );
  });
  it("throws on one with no index", () => {
    expect(() =>
      parseAgentDistroDelivery(JSON.stringify({ ...delivery, index: "" })),
    ).toThrow();
  });
  it("throws on a schedule with no period — kolu never decides one", () => {
    expect(() =>
      parseAgentDistroDelivery(
        JSON.stringify({
          ...delivery,
          schedule: { periodSeconds: 0, offsetSeconds: 0 },
        }),
      ),
    ).toThrow();
  });
});
