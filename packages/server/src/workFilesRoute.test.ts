/**
 * THE KEPT-FILE URL, PARSED — the half of `/api/works/<work>/files/<path>` that
 * decides which work and which file, off the RAW request target.
 *
 * A work id carries slashes (`branch:<host>/<repo>/<branch>`), so the id rides
 * the URL percent-encoded TWICE over: `/` becomes `%2F`, and the `%` of the
 * repo path's own encoding becomes `%25`. A router that decodes a path before
 * matching reads those `%2F`s as separators, a `:workId` param matches nothing,
 * and the request falls through to the SPA — which the browser then renders as
 * the plan's "bytes" (#2376: the reader showed kolu's index.html).
 */

import { describe, expect, it } from "vitest";
import { workFileRequest } from "./workFilesRoute.ts";

const idOf = (repo: string): string =>
  `branch:local/${encodeURIComponent(repo)}/survive-the-night`;

/** The URL the client builds (`client/src/conductor/workFile.ts`). */
const urlOf = (work: string, path: string): string =>
  `/api/works/${encodeURIComponent(work)}/files/${path}`;

describe("the kept-file request", () => {
  it("reads the work and the file out of a real, doubly-encoded id", () => {
    const work = idOf("/tmp/nix-shell.xQRVKQ/kolu-work-repo-2057587");
    expect(workFileRequest(urlOf(work, ".waterfall/plan.md"))).toEqual({
      workId: work,
      tail: ".waterfall/plan.md",
    });
  });

  it("keeps the file tail ENCODED, for serve-dir's own one decode", () => {
    // A `#` or a space in a file name reaches the reader as itself only
    // because nothing here decodes the tail a second time.
    const work = idOf("/srv/repo");
    expect(
      workFileRequest(urlOf(work, ".waterfall/a%20plan%23two.md"))?.tail,
    ).toBe(".waterfall/a%20plan%23two.md");
  });

  it("says NOTHING for a target that is not one of this route's", () => {
    expect(workFileRequest("/api/works/")).toBeNull();
    expect(workFileRequest("/api/works/abc")).toBeNull();
    expect(workFileRequest("/api/works//files/plan.md")).toBeNull();
    expect(workFileRequest("/api/terminals/x/files/plan.md")).toBeNull();
  });

  it("ignores the query string, as the raw pathname does", () => {
    const work = idOf("/srv/repo");
    expect(workFileRequest(`${urlOf(work, "plan.md")}?v=7`)).toEqual({
      workId: work,
      tail: "plan.md",
    });
  });
});
