/**
 * A member terminal kolu has no name for is called by its host, never by an
 * id: beside its role, "on nix@example"; alone, "Implementor on nix@example".
 */

import { describe, expect, it } from "vitest";
import { onHostWords, standaloneName } from "./memberNames";

const REMOTE = "remote:nix@example/11111111-1111-4111-8111-111111111111";
const LOCAL = "local/22222222-2222-4222-8222-222222222222";

describe("a member's name", () => {
  it("is its own name when kolu has one", () => {
    expect(standaloneName("api-server", REMOTE, "implementor")).toBe(
      "api-server",
    );
  });

  it("is its role on its host when kolu has none", () => {
    expect(standaloneName(undefined, REMOTE, "implementor")).toBe(
      "Implementor on nix@example",
    );
    expect(standaloneName(undefined, LOCAL, "planner")).toBe(
      "Planner on local",
    );
  });

  it("calls a terminal in no work a terminal", () => {
    expect(standaloneName(undefined, LOCAL, undefined)).toBe(
      "Terminal on local",
    );
  });

  it("names the host beside a role, and never the id", () => {
    expect(onHostWords(REMOTE)).toBe("on nix@example");
    expect(onHostWords(REMOTE)).not.toContain("11111111");
  });

  it("says so when the ref names no host it can read", () => {
    expect(onHostWords("not a ref")).toBe("on a host kolu cannot read");
  });
});
