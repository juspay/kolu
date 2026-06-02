import { describe, expect, it } from "vitest";
import { clientIsStale, isCleanRef } from "./commitRef";

describe("isCleanRef", () => {
  it.each([
    { sha: "0784979", expected: true, why: "a real short SHA" },
    { sha: undefined, expected: false, why: "absent" },
    { sha: "", expected: false, why: "empty" },
    { sha: "dev", expected: false, why: "the dev sentinel" },
    { sha: "0784979-dirty", expected: false, why: "a dirty working tree" },
  ])("$why → $expected", ({ sha, expected }) => {
    expect(isCleanRef(sha)).toBe(expected);
  });
});

describe("clientIsStale", () => {
  it.each([
    {
      server: "0784979",
      client: "abc1234",
      expected: true,
      why: "two clean refs that disagree → stale (cached old bundle)",
    },
    {
      server: "0784979",
      client: "0784979",
      expected: false,
      why: "identical clean refs → up to date",
    },
    {
      server: "dev",
      client: "abc1234",
      expected: false,
      why: "dev server can't prove staleness",
    },
    {
      server: "0784979",
      client: "dev",
      expected: false,
      why: "dev client can't be called stale",
    },
    {
      server: "0784979-dirty",
      client: "abc1234",
      expected: false,
      why: "dirty server is not a trustworthy baseline",
    },
    {
      server: "0784979",
      client: "abc1234-dirty",
      expected: false,
      why: "dirty client is a local build, not a cache miss",
    },
    {
      server: undefined,
      client: "abc1234",
      expected: false,
      why: "no server info yet (link still connecting)",
    },
  ])("$why", ({ server, client, expected }) => {
    expect(clientIsStale(server, client)).toBe(expected);
  });
});
