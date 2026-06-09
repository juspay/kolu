import { describe, expect, it } from "vitest";
import {
  fetchUrlFor,
  logPathFor,
  parseGithubRemote,
  statusFor,
} from "./statuses";

// The context/description/log-path formats are byte-compatible with what
// justci posted (verified against live statuses on merged kolu PRs) — these
// strings are what branch protection matches on.
describe("logPathFor", () => {
  it("keeps the ci:: prefix in the filename, platform as the directory", () => {
    expect(logPathFor("338eb01", "ci::e2e@x86_64-linux")).toBe(
      ".ci/338eb01/x86_64-linux/ci::e2e.log",
    );
  });

  it("handles the unprefixed _ci-setup bookkeeping node", () => {
    expect(logPathFor("338eb01", "_ci-setup@aarch64-darwin")).toBe(
      ".ci/338eb01/aarch64-darwin/_ci-setup.log",
    );
  });
});

describe("statusFor", () => {
  const id = "ci::unit@x86_64-linux";
  const log = ".ci/abc1234/x86_64-linux/ci::unit.log";

  it("posts pending/success/failure in justci's wording", () => {
    expect(statusFor(id, "running", null, "abc1234")).toEqual({
      state: "pending",
      context: id,
      description: `Running: ${log}`,
    });
    expect(statusFor(id, "ok", 25_000, "abc1234")).toEqual({
      state: "success",
      context: id,
      description: `Succeeded (25s): ${log}`,
    });
    expect(statusFor(id, "failed", 8_000, "abc1234")).toEqual({
      state: "failure",
      context: id,
      description: `Failed (8s): ${log}`,
    });
  });

  it("maps infrastructure death to GitHub's error state", () => {
    expect(statusFor(id, "errored", 60_000, "abc1234")).toEqual({
      state: "error",
      context: id,
      description: `Errored (1m0s): ${log}`,
    });
  });

  // An absent required context is what correctly blocks the merge.
  it("posts nothing for skipped and pending", () => {
    expect(statusFor(id, "skipped", null, "abc1234")).toBeNull();
    expect(statusFor(id, "pending", null, "abc1234")).toBeNull();
  });
});

describe("github remote parsing", () => {
  it("understands https and ssh forms", () => {
    expect(parseGithubRemote("https://github.com/juspay/kolu.git")).toEqual({
      owner: "juspay",
      repo: "kolu",
    });
    expect(parseGithubRemote("git@github.com:juspay/kolu.git")).toEqual({
      owner: "juspay",
      repo: "kolu",
    });
    expect(parseGithubRemote("https://example.com/x/y")).toBeNull();
  });

  it("normalizes to the anonymous-https fetch URL lane hosts use", () => {
    expect(fetchUrlFor("git@github.com:juspay/kolu.git")).toBe(
      "https://github.com/juspay/kolu",
    );
    expect(fetchUrlFor("https://git.sr.ht/~x/y")).toBe(
      "https://git.sr.ht/~x/y",
    );
  });
});
