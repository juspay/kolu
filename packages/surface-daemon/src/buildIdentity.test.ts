import { afterEach, describe, expect, it, vi } from "vitest";
import { readBakedIdentity } from "./buildIdentity.ts";

const BUILD_ENV = "IDENTITY_TEST_BUILD_ID";
const COMMIT_ENV = "IDENTITY_TEST_COMMIT_HASH";

afterEach(() => vi.unstubAllEnvs());

describe("readBakedIdentity", () => {
  it("returns the complete baked pair", () => {
    vi.stubEnv(BUILD_ENV, "build-closure");
    vi.stubEnv(COMMIT_ENV, "deadbeef");

    expect(readBakedIdentity("IDENTITY_TEST")).toEqual({
      staleKey: "build-closure",
      navigableCommit: "deadbeef",
    });
  });

  it("returns honest unknown when neither field is baked", () => {
    vi.stubEnv(BUILD_ENV, undefined);
    vi.stubEnv(COMMIT_ENV, undefined);

    expect(readBakedIdentity("IDENTITY_TEST")).toEqual({
      staleKey: "",
      navigableCommit: "",
    });
  });

  it.each([
    [BUILD_ENV, "build-closure"],
    [COMMIT_ENV, "deadbeef"],
  ])("crashes on the contradictory half-pair with only %s", (name, value) => {
    vi.stubEnv(name, value);

    expect(() => readBakedIdentity("IDENTITY_TEST")).toThrow(
      "incomplete baked identity: IDENTITY_TEST_BUILD_ID and IDENTITY_TEST_COMMIT_HASH must be set together",
    );
  });
});
