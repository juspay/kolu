/** The two files `default.nix` bakes for agent-distro, as padi and
 *  kolu-server parse them. */

import { describe, expect, it } from "vitest";
import { parseAgentDistroDelivery, parseAgentDistroProfiles } from "./bake.ts";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";

describe("parseAgentDistroProfiles", () => {
  const profiles = {
    stateHomePlaceholder: PLACEHOLDER,
    history: `${PLACEHOLDER}/agent-distro/history.log`,
    profiles: [
      { name: "vanilla", state: `${PLACEHOLDER}/agent-distro/abc` },
      { name: "juspay", state: `${PLACEHOLDER}/agent-distro/def` },
    ],
  };

  it("reads the listing, in its order", () => {
    expect(parseAgentDistroProfiles(JSON.stringify(profiles))).toEqual(
      profiles,
    );
  });
  it("throws on an empty profiles list", () => {
    expect(() =>
      parseAgentDistroProfiles(JSON.stringify({ ...profiles, profiles: [] })),
    ).toThrow();
  });
  it("throws on a profile with no state directory", () => {
    expect(() =>
      parseAgentDistroProfiles(
        JSON.stringify({ ...profiles, profiles: [{ name: "vanilla" }] }),
      ),
    ).toThrow();
  });
});

describe("parseAgentDistroDelivery", () => {
  const delivery = {
    flake: "github:juspay/agent-distro",
    cache: {
      url: "https://cache.example.org",
      publicKey: "cache.example.org-1:AAAA",
    },
    schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
  };

  it("reads the flake, the cache and the schedule", () => {
    expect(parseAgentDistroDelivery(JSON.stringify(delivery))).toEqual(
      delivery,
    );
  });
  it("throws on one with no cache key", () => {
    expect(() =>
      parseAgentDistroDelivery(
        JSON.stringify({ ...delivery, cache: { url: delivery.cache.url } }),
      ),
    ).toThrow();
  });
});
