/** agent-distro's `--list --json`, parsed (a fixture of its U1 output). */

import { describe, expect, it } from "vitest";
import { parseAgentDistroList, parseProfileListing } from "./listing.ts";

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

describe("parseProfileListing — one profile bundle's own picker", () => {
  const one = (name: string) =>
    JSON.stringify({
      profiles: [{ name, description: `the ${name} set`, harnesses: [] }],
    });

  it("reads the one profile it lists", () => {
    expect(parseProfileListing("vanilla", one("vanilla")).description).toBe(
      "the vanilla set",
    );
  });

  it("throws when it lists another profile, or more than one — a broken build", () => {
    expect(() => parseProfileListing("vanilla", one("juspay"))).toThrow(
      /lists \[juspay\], not exactly 'vanilla'/,
    );
    expect(() => parseProfileListing("vanilla", FIXTURE)).toThrow(
      /lists \[vanilla, juspay\]/,
    );
    expect(() => parseProfileListing("vanilla", '{"profiles":[]}')).toThrow();
  });
});
