import { describe, expect, it } from "vitest";
import { parseRawWorkFileTarget } from "./workFilesRoute.ts";

const idOf = (repo: string): string =>
  `branch:local/${encodeURIComponent(repo)}/survive-the-night`;

const urlOf = (work: string, path: string): string =>
  `/api/works/${encodeURIComponent(work)}/files/${path}`;

describe("the kept-file request", () => {
  it("reads the work and the file out of a real, doubly-encoded id", () => {
    const work = idOf("/tmp/nix-shell.xQRVKQ/kolu-work-repo-2057587");
    expect(parseRawWorkFileTarget(urlOf(work, ".waterfall/plan.md"))).toEqual({
      workId: work,
      encodedTail: ".waterfall/plan.md",
    });
  });

  it("keeps the file tail ENCODED, for serve-dir's own one decode", () => {
    const work = idOf("/srv/repo");
    expect(
      parseRawWorkFileTarget(urlOf(work, ".waterfall/a%20plan%23two.md"))
        ?.encodedTail,
    ).toBe(".waterfall/a%20plan%23two.md");
  });

  it("says NOTHING for a target that is not one of this route's", () => {
    expect(parseRawWorkFileTarget("/api/works/")).toBeNull();
    expect(parseRawWorkFileTarget("/api/works/abc")).toBeNull();
    expect(parseRawWorkFileTarget("/api/works//files/plan.md")).toBeNull();
    expect(parseRawWorkFileTarget("/api/terminals/x/files/plan.md")).toBeNull();
  });

  it("ignores the query string, as the raw pathname does", () => {
    const work = idOf("/srv/repo");
    expect(parseRawWorkFileTarget(`${urlOf(work, "plan.md")}?v=7`)).toEqual({
      workId: work,
      encodedTail: "plan.md",
    });
  });
});
