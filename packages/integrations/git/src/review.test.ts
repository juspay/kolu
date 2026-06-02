import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDiff } from "./review.ts";

describe("getDiff path authority", () => {
  let repo: string;
  let outside: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-repo-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-review-outside-"));
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("rejects a repo-local symlink escaping the root before the --no-index fallback reads it", async () => {
    // The local-untracked branch diffs `/dev/null` against the resolved
    // absolute path; a `leak.txt -> /outside/secret.txt` symlink would
    // surface the external file's content verbatim without the realpath guard.
    const secret = path.join(outside, "secret.txt");
    fs.writeFileSync(secret, "TOP SECRET\n");
    fs.symlinkSync(secret, path.join(repo, "leak.txt"));

    const result = await getDiff(repo, "leak.txt", "local");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
  });

  it("still rejects lexical traversal", async () => {
    const result = await getDiff(repo, "../../etc/passwd", "local");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PATH_ESCAPES_ROOT");
  });
});
