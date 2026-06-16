/** File tree browsing — git-filtered file listing and file reading.
 *
 *  Uses `git ls-files --cached --others --exclude-standard` to enumerate
 *  tracked + untracked-but-not-ignored paths in one shot. This avoids
 *  listing `node_modules/`, `.git/`, build artifacts, etc. */

import { execFile } from "node:child_process";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import { promisify } from "node:util";
import type { Logger } from "kolu-shared";
import { err, type GitResult, ok } from "./errors.ts";
import { resolveExistingUnder } from "./safe-path.ts";

const execFileAsync = promisify(execFile);

/** Single spawn/parse/error path shared by the two `git ls-files` listings.
 *  Owns the `ls-files -z` invocation, the maxBuffer ceiling, the NUL split +
 *  empty-entry filter, and the GIT_FAILED error envelope; callers supply the
 *  selection flags and the message prefix used on failure.
 *
 *  `-z` is load-bearing: without it git quotes "unusual" path bytes per
 *  `core.quotePath` — a unicode name like `People/Amélie.md` comes back as the
 *  C-escaped, double-quote-wrapped `"People/Am\303\251lie.md"`. The leading
 *  quote then becomes part of the first path segment (a spurious `"People`
 *  folder) and the leaf renders as `Am\303\251lie.md"`. `-z` emits each path
 *  verbatim, NUL-terminated and unquoted, so accented/emoji/CJK names reach the
 *  tree intact. */
async function gitLsFiles(
  repoPath: string,
  selectionArgs: string[],
  failMsg: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "-z", ...selectionArgs],
      {
        cwd: repoPath,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const paths = stdout.split("\0").filter((l) => l.length > 0);
    return ok(paths);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log?.error({ err: msg, repoPath }, "git ls-files failed");
    return err({ code: "GIT_FAILED", message: `${failMsg}: ${msg}` });
  }
}

/** Flat list of every repo-relative path (tracked + untracked-but-not-ignored).
 *  One-shot snapshot for Pierre's `@pierre/trees`, which builds the tree
 *  hierarchy itself from a flat path list.
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param log       Optional logger. */
export async function listAll(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  return gitLsFiles(
    repoPath,
    ["--cached", "--others", "--exclude-standard"],
    "Failed to list files",
    log,
  );
}

/** Repo-relative paths git *ignores* — the exact complement of `listAll`'s
 *  `--cached --others --exclude-standard` (union the two and you have the whole
 *  working tree). `--directory` collapses a fully-ignored directory to its name
 *  (so `node_modules/` is one entry, not thousands), and any trailing slash is
 *  stripped here. The working-tree watcher feeds these to parcel's `ignore`, so
 *  it watches exactly what the browse tree shows — committed build outputs
 *  (Atlas's `docs/atlas/dist/`) included, gitignored ones excluded. Note: this
 *  does NOT list `.git` (git never reports its own dir); callers that need it
 *  ignored must add it themselves.
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param log       Optional logger. */
export async function listIgnoredPaths(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  const result = await gitLsFiles(
    repoPath,
    ["--others", "--ignored", "--exclude-standard", "--directory"],
    "Failed to list ignored files",
    log,
  );
  if (!result.ok) return result;
  return ok(result.value.map((l) => l.replace(/\/+$/, "")));
}

/** Max file size to read (1 MB). Larger files get a truncation notice. */
const MAX_READ_BYTES = 1_048_576;

/** Read a file's UTF-8 content, guarded against path traversal.
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param filePath  Path relative to repo root.
 *  @param log       Optional logger. */
export async function readFile(
  repoPath: string,
  filePath: string,
  log?: Logger,
): Promise<GitResult<{ content: string; truncated: boolean }>> {
  const resolved = await resolveExistingUnder(repoPath, filePath, log);
  if (!resolved.ok)
    return resolved as GitResult<{ content: string; truncated: boolean }>;

  try {
    const buf = await fsReadFile(resolved.value.abs);
    if (buf.length > MAX_READ_BYTES) {
      // May split a multi-byte UTF-8 sequence at the boundary; Node
      // replaces the incomplete trailing character with U+FFFD.
      return ok({
        content: buf.subarray(0, MAX_READ_BYTES).toString("utf-8"),
        truncated: true,
      });
    }
    return ok({ content: buf.toString("utf-8"), truncated: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "GIT_FAILED", message: `Failed to read file: ${msg}` });
  }
}

/** Read a file's RAW bytes (base64-encoded) under the same path-traversal +
 *  realpath guard as `readFile`. Unlike `readFile` it neither decodes to UTF-8
 *  nor truncates — it is the binary-preview read (images / PDFs / docs) the
 *  iframe file route serves. For a REMOTE terminal kolu-server forwards this
 *  over the watcher so the bytes come from the host the file actually lives on. */
export async function readFileBytes(
  repoPath: string,
  filePath: string,
  log?: Logger,
): Promise<GitResult<{ bytesBase64: string }>> {
  const resolved = await resolveExistingUnder(repoPath, filePath, log);
  if (!resolved.ok) return resolved as GitResult<{ bytesBase64: string }>;
  try {
    const buf = await fsReadFile(resolved.value.abs);
    return ok({ bytesBase64: buf.toString("base64") });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "GIT_FAILED", message: `Failed to read file: ${msg}` });
  }
}

/** Stat a file's mtime in ms-since-epoch, used to cache-bust the iframe URL
 *  for binary previewable kinds. Same path-traversal guard as `readFile`. */
export async function statFileMtimeMs(
  repoPath: string,
  filePath: string,
  log?: Logger,
): Promise<GitResult<number>> {
  const resolved = await resolveExistingUnder(repoPath, filePath, log);
  if (!resolved.ok) return resolved as GitResult<number>;
  try {
    const s = await fsStat(resolved.value.abs);
    return ok(s.mtimeMs);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "GIT_FAILED", message: `Failed to stat file: ${msg}` });
  }
}
