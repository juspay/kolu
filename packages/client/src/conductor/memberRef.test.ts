import { describe, expect, it } from "vitest";
import { splitMemberRef } from "./memberRef";

const ID = "aaaaaaaa-0000-4000-8000-000000000001";

describe("splitting a member's ref", () => {
  it("splits a ref whose halves are both resolvable", () => {
    expect(splitMemberRef(`local/${ID}`)).toEqual({ host: "local", id: ID });
    expect(splitMemberRef(`remote:ssh://box/3/${ID}`)).toEqual({
      host: "remote:ssh://box/3",
      id: ID,
    });
  });

  it("answers null rather than guessing", () => {
    expect(splitMemberRef(ID)).toBeNull();
    expect(splitMemberRef(`elsewhere/${ID}`)).toBeNull();
    expect(splitMemberRef("local/not-a-uuid")).toBeNull();
  });
});
