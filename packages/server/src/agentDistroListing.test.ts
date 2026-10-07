/** The profile listing Settings offers: running the baked picker, and the boot
 *  check that kolu's default profile leads it. (Parsing `--list --json` is
 *  `@kolu/agent-distro/listing`'s, tested there.) */

import { AGENT_DISTRO_BUNDLE_ENV } from "@kolu/padi/agentDistroBake";
import { describe, expect, it } from "vitest";
import { parseAgentDistroList } from "@kolu/agent-distro/listing";
import {
  assertDefaultAgentProfile,
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

describe("assertDefaultAgentProfile", () => {
  it("passes when the listing leads with kolu's default, and when unbaked", () => {
    const listing = parseAgentDistroList(FIXTURE);
    expect(assertDefaultAgentProfile(listing, "vanilla")).toBe(listing);
    expect(
      assertDefaultAgentProfile({ kind: "unavailable" }, "vanilla"),
    ).toEqual({ kind: "unavailable" });
  });

  it("fails the boot when the two defaults disagree", () => {
    expect(() =>
      assertDefaultAgentProfile(parseAgentDistroList(FIXTURE), "juspay"),
    ).toThrow(/leads with 'vanilla'.*'juspay'/);
  });
});
