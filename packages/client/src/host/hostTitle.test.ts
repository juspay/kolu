import { LOCAL_HOST } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import { hostTitle } from "./hostTitle";

describe("hostTitle — tab identity binds to the active host", () => {
  it("plain 'Kolu' on the local default (no host qualifier)", () => {
    expect(hostTitle(LOCAL_HOST)).toBe("Kolu");
  });

  it("'Kolu [<host>]' when a remote host is active", () => {
    expect(hostTitle({ kind: "remote", target: "srid@zest" })).toBe(
      "Kolu [srid@zest]",
    );
    expect(hostTitle({ kind: "remote", target: "pu-42" })).toBe("Kolu [pu-42]");
  });

  it("never emits a comma-seed list — it is one active host, not the env", () => {
    const active = { kind: "remote" as const, target: "zest" };
    expect(hostTitle(active)).toBe("Kolu [zest]");
    expect(hostTitle(active)).not.toContain(",");
  });
});
