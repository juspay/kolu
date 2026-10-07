/** The profile listing Settings offers, parsed from agent-distro's own
 *  `--list --json` (a fixture of its U1 output). */

import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";
import { describe, expect, it } from "vitest";
import {
  parseAgentDistroList,
  readAgentDistroListing,
} from "./agentDistroListing.ts";

const FIXTURE = JSON.stringify({
  profiles: [
    {
      name: "vanilla",
      description: "Upstream harnesses with your own provider",
      harnesses: [
        {
          name: "claude",
          title: "Claude Code",
          tagline: "Anthropic login · plugin dirs per session",
          version: "2.1.286",
        },
        { name: "codex", title: "Codex", tagline: "OpenAI", version: "0.42.0" },
      ],
    },
    {
      name: "juspay",
      description: "Juspay skills + Kolu, via Juspay's LiteLLM gateway",
      harnesses: [],
    },
  ],
});

describe("parseAgentDistroList", () => {
  it("reads every profile, the default first", () => {
    const listing = parseAgentDistroList(FIXTURE);
    expect(listing.kind).toBe("available");
    if (listing.kind !== "available") return;
    expect(listing.profiles.map((p) => p.name)).toEqual(["vanilla", "juspay"]);
    expect(listing.profiles[0]?.harnesses[0]?.title).toBe("Claude Code");
  });

  it("throws on output that is not a listing — a broken picker crashes the boot", () => {
    expect(() =>
      parseAgentDistroList("vanilla claude Claude Code 2.1"),
    ).toThrow();
    expect(() => parseAgentDistroList('{"profiles":[]}')).toThrow();
  });
});

describe("readAgentDistroListing", () => {
  it("unbaked → unavailable, and nothing is run", () => {
    let ran = false;
    expect(
      readAgentDistroListing({}, () => {
        ran = true;
        return FIXTURE;
      }),
    ).toEqual({ kind: "unavailable" });
    expect(ran).toBe(false);
  });

  it("baked → runs the floor's picker with --list --json", () => {
    const calls: string[][] = [];
    const listing = readAgentDistroListing(
      { [AGENT_DISTRO_BUNDLE_ENV]: "/nix/store/x-agent-distro-bundle" },
      (bin, args) => {
        calls.push([bin, ...args]);
        return FIXTURE;
      },
    );
    expect(calls).toEqual([
      ["/nix/store/x-agent-distro-bundle/bin/agent-distro", "--list", "--json"],
    ]);
    expect(listing.kind).toBe("available");
  });
});
