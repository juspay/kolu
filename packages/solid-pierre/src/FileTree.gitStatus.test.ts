import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from "@pierre/trees/ssr";
import { describe, expect, it } from "vitest";

function openingTagFor(html: string, path: string): string {
  const encodedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = html.match(
    new RegExp(`<button(?=[^>]*data-item-path="${encodedPath}")[^>]*>`),
  )?.[0];
  if (!tag) throw new Error(`missing rendered row for ${path}`);
  return tag;
}

describe("Pierre initial git-status roll-up", () => {
  it("marks every changed file ancestor while leaving a clean sibling unmarked", () => {
    const html = serializeFileTreeSsrPayload(
      preloadFileTree({
        paths: ["src/feature/a.txt", "src/keep.txt", "lib/b.txt"],
        gitStatus: [{ path: "src/feature/a.txt", status: "modified" }],
        initialExpansion: "open",
      }),
    );

    expect(openingTagFor(html, "src/")).toContain(
      'data-item-contains-git-change="true"',
    );
    expect(openingTagFor(html, "src/feature/")).toContain(
      'data-item-contains-git-change="true"',
    );
    expect(openingTagFor(html, "lib/")).not.toContain(
      "data-item-contains-git-change",
    );
  });
});
