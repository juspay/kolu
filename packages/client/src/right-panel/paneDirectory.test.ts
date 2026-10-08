import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import { paneDirectory } from "./paneDirectory";

const meta = (cwd: string, repoRoot?: string | null): TerminalMetadata =>
  ({
    cwd,
    git:
      repoRoot === undefined
        ? { kind: "none" }
        : { kind: "repo", info: { repoRoot } },
  }) as never;

describe("paneDirectory", () => {
  it("splits at the repo root, shortening each half by the shared shortener", () => {
    expect(
      paneDirectory(
        meta("/home/srid/code/kolu/packages/client", "/home/srid/code/kolu"),
      ),
    ).toEqual({
      root: "~/code/kolu",
      rest: "/packages/client",
      full: "/home/srid/code/kolu/packages/client",
    });
  });

  it("a pane AT its repo root has nothing below it", () => {
    expect(
      paneDirectory(meta("/home/srid/code/kolu", "/home/srid/code/kolu")),
    ).toEqual({
      root: "~/code/kolu",
      rest: "",
      full: "/home/srid/code/kolu",
    });
  });

  it("outside a repo the whole path is the root half", () => {
    expect(paneDirectory(meta("/tmp", null))).toEqual({
      root: "/tmp",
      rest: "",
      full: "/tmp",
    });
  });

  it("a cwd that left the repo gets the plain path, not a false prefix", () => {
    // `startsWith` on the bare string would read /repo-2 as inside /repo.
    expect(paneDirectory(meta("/repo-2/x", "/repo"))).toEqual({
      root: "/repo-2/x",
      rest: "",
      full: "/repo-2/x",
    });
  });

  it("no pane, no line", () => {
    expect(paneDirectory(null)).toBeNull();
  });
});
