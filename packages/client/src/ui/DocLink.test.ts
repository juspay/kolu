/**
 * DocLink registry guards.
 *
 * 1. Set equality — `DOC_SLUGS` must match the basenames of
 *    `website/src/content/docs/*.mdx` exactly. Adding, renaming, or deleting a
 *    doc page without updating the registry (or vice versa) is a red build.
 * 2. Grep law — no `kolu.dev` literal anywhere in `packages/client/src`
 *    outside `DocLink.tsx`. Keeps the consolidation permanent.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGuardSourceFiles } from "../architectureGuardSources.testlib";
import { DOC_SLUGS, docUrl } from "./DocLink";

const UI_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = join(UI_DIR, "..");
const REPO_ROOT = join(CLIENT_SRC, "../../..");
const DOCS_DIR = join(REPO_ROOT, "website/src/content/docs");
const DOCLINK_FILE = join(UI_DIR, "DocLink.tsx");

describe("DocLink registry", () => {
  it("DOC_SLUGS equals the website docs page basenames", () => {
    const pages = readdirSync(DOCS_DIR)
      .filter((name) => name.endsWith(".mdx"))
      .map((name) => name.slice(0, -".mdx".length))
      .sort();
    const registry = [...DOC_SLUGS].sort();
    expect(registry).toEqual(pages);
  });

  it("docUrl spells the trailing-slash form with optional anchor", () => {
    expect(docUrl("kaval")).toBe("https://kolu.dev/kaval/");
    expect(docUrl("remote-access", "remote")).toBe(
      "https://kolu.dev/remote-access/#remote",
    );
  });

  it("no kolu.dev literal outside DocLink.tsx", () => {
    const offenders: string[] = [];
    for (const file of listGuardSourceFiles(CLIENT_SRC)) {
      if (file === DOCLINK_FILE) continue;
      const text = readFileSync(file, "utf8");
      if (text.includes("kolu.dev")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
