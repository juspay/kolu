/** File tree browsing — git-filtered file listing and file reading.
 *
 *  `listAll` uses `git ls-files --cached --others --exclude-standard` to
 *  enumerate tracked + untracked-but-not-ignored paths in one shot, so it never
 *  walks `node_modules/`, `.git/`, build artifacts, etc. `listIgnored` is its
 *  exact complement — the same enumeration for what git DOES ignore, collapsed
 *  so a fully-ignored directory costs one entry rather than its whole subtree.
 *  Union the two and you have the working tree.
 *
 *  `listDirectory` is the on-demand counterpart to that collapse: one level of
 *  a directory, read when the user expands a row the collapse left childless. */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  open as fsOpen,
  readFile as fsReadFile,
  readdir,
} from "node:fs/promises";
import { promisify } from "node:util";
import type { Logger } from "kolu-shared";
import { err, type GitResult, isFileGoneError, ok } from "./errors.ts";
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

/** Repo-relative entries git *ignores* — the exact complement of `listAll`'s
 *  `--cached --others --exclude-standard` (union the two and you have the whole
 *  working tree). `--directory` collapses a fully-ignored directory to its name
 *  (so `node_modules/` is one entry, not thousands); a directory entry KEEPS
 *  git's trailing slash, which is Pierre's own folder-key format — the Code tab
 *  hands it straight through as the marker for a childless dimmed row. The
 *  watcher needs no stripped variant: it resolves every entry to an absolute
 *  path, and `path.resolve` normalizes the trailing separator away. Note: this
 *  does NOT list `.git` (git never reports its own dir); callers that need it
 *  ignored must add it themselves.
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param log       Optional logger. */
export async function listIgnored(
  repoPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  return gitLsFiles(
    repoPath,
    ["--others", "--ignored", "--exclude-standard", "--directory"],
    "Failed to list ignored files",
    log,
  );
}

/** ONE level of a directory's contents, repo-relative, with git's trailing
 *  slash on each subdirectory — the same folder-key format `listIgnored` emits,
 *  so the two listings compose in the tree without a translation step.
 *
 *  This exists to answer an EXPAND of a collapsed ignored directory. Those rows
 *  are the one place the flat `listAll`/`listIgnored` snapshot deliberately
 *  stops: `--directory` collapses a wholly-ignored directory to its name, which
 *  is what keeps `node_modules/` at one row instead of thousands, but it also
 *  means the tree holds no child to paint when the user opens that row. Reading
 *  the level on demand restores the contents without giving the collapse up.
 *
 *  ONE level, not a recursive walk, is what bounds the cost: expanding
 *  `node_modules/` reads a single directory and hands back package names, each
 *  collapsed and expandable in its own turn. A recursive listing — the only
 *  thing `git ls-files` can produce here, since it has no depth limit — would
 *  be ~100k paths for that same click.
 *
 *  No ignore filtering, and none is missing: git collapses a directory only
 *  when EVERYTHING beneath it is ignored, so every entry inside a collapsed row
 *  is ignored by construction. Filtering would be a second, weaker authority
 *  answering a question git has already settled. (`browse.test.ts` checks that
 *  against git itself rather than trusting the argument.)
 *
 *  Same traversal guard as `readFile` — the directory key arrives over the wire.
 *  A missing or unreadable directory returns an err rather than an empty list:
 *  a cleaned build output must not paint as an authoritative empty folder.
 *
 *  @param repoPath  Absolute path to the repo root.
 *  @param dirPath   Path relative to repo root, with or without trailing slash.
 *  @param log       Optional logger. */
export async function listDirectory(
  repoPath: string,
  dirPath: string,
  log?: Logger,
): Promise<GitResult<string[]>> {
  const resolved = await resolveExistingUnder(repoPath, dirPath, log);
  if (!resolved.ok) return resolved as GitResult<string[]>;
  // `rel` is the lexically normalized key with any trailing slash already gone
  // (`path.relative` erases it), so the two spellings a caller may hold —
  // Pierre's folder key `out/` and the bare `out` — converge here.
  const { abs, rel } = resolved.value;
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    return ok(
      entries.map((e) => {
        const child = rel === "" ? e.name : `${rel}/${e.name}`;
        // A symlink is reported as neither file nor directory by `withFileTypes`
        // (no stat is performed); leaving it slash-free renders it as a leaf,
        // which is the honest row for something we will not follow.
        return e.isDirectory() ? `${child}/` : child;
      }),
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log?.error({ err: msg, repoPath, dirPath }, "listDirectory failed");
    return err({
      code: "GIT_FAILED",
      message: `Failed to list directory: ${msg}`,
    });
  }
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

/** A cache-buster TAG for the iframe preview URL (the `?v=<tag>` on the binary
 *  route). The contract: the tag changes **iff the file's bytes change**, so an
 *  edit reloads the preview but an identical-content rewrite does NOT. The
 *  latter — a `git checkout` across branches, or a formatter's atomic
 *  write-and-rename — bumps mtime without changing content, and a mtime-keyed
 *  URL would reload the iframe and scroll a mid-scrolled preview to the top.
 *
 *  So the tag is a hash of the CONTENT, not the mtime: the file's bytes are the
 *  honest identity of "has this preview changed?", where mtime is only a proxy
 *  that a working-tree re-materialization falsely trips. The WHOLE file is
 *  hashed — no size cutoff, no leading-bytes shortcut — so a tail-only edit of a
 *  large previewable file (a 40 MiB generated HTML report, a big PDF) is never
 *  silently missed: every previewable kind reflects its full content, not a
 *  prefix that a mid/tail edit leaves untouched.
 *
 *  Bounded heap regardless of size: the bytes stream through one open handle in
 *  the read-stream's fixed-size chunks (`createReadStream`'s default 64 KiB
 *  highWaterMark), fed to the hash chunk-by-chunk — so even a multi-GB video is
 *  hashed without ever landing whole in the (possibly remote) padi heap,
 *  honoring serve-dir's never-buffer invariant on this identity path too. The
 *  single open handle pins ONE inode: an atomic write-and-rename mid-hash yields
 *  a consistent snapshot of the file we opened, never a torn stat/read pair
 *  where the size and the bytes describe different inodes (the same reason
 *  serve-dir derives size + body from one `open`, not a `stat(path)` then a
 *  separate read of the path).
 *
 *  The bytes are read once per on-disk *change* (the `subscribeFileChange` pulse
 *  is debounced and fires only on real repo events, never on a timer), and only
 *  for the bounded set of binary-previewable kinds. Same path-traversal guard as
 *  `readFile`.
 *
 *  Cancellable: the caller (a superseded `createPolledQuery`) aborts the request
 *  `signal` when its input changes or a fresh pulse re-fires. We check it before
 *  opening and between chunks so a hash whose result is already stale — most
 *  costly on a multi-GB video where a full read runs for seconds — stops promptly
 *  instead of burning disk and CPU while overlapping the next scan. On abort we
 *  re-throw the abort (not a `GIT_FAILED` err) so the surface framework sees a
 *  cancellation, and the catch does not misclassify it as an I/O fault to log. */
export async function filePreviewTag(
  repoPath: string,
  filePath: string,
  log?: Logger,
  signal?: AbortSignal,
): Promise<GitResult<string>> {
  const resolved = await resolveExistingUnder(repoPath, filePath, log);
  if (!resolved.ok) return resolved as GitResult<string>;
  const abs = resolved.value.abs;
  try {
    signal?.throwIfAborted();
    const hash = createHash("sha1");
    // One open handle for the whole read: size-and-bytes-from-one-inode (no
    // TOCTOU on an atomic replace) and a bounded, streamed hash (never a
    // whole-file slurp, whatever the size). `autoClose: false` so the `finally`
    // owns the handle's close deterministically — including when an abort throws
    // out of the loop mid-read (the iterator's `return()` destroys the stream,
    // then `finally` closes the fd we still own).
    const fh = await fsOpen(abs, "r");
    try {
      for await (const chunk of fh.createReadStream({ autoClose: false })) {
        signal?.throwIfAborted();
        hash.update(chunk as Buffer);
      }
    } finally {
      // Close failures are not actionable once the read is done, and must never
      // MASK a real error propagating out of the try (JS discards the original
      // throw when a `finally` throws) — swallow close's own error so the
      // caught error below is the true root cause.
      await fh.close().catch(() => {});
    }
    return ok(hash.digest("hex"));
  } catch (e: unknown) {
    // A superseded query aborted mid-hash: propagate the cancellation untouched
    // — it is neither a missing file nor an I/O fault, so it must not log or
    // collapse to a `GIT_FAILED` err the endpoint would then re-throw opaquely.
    // Key off the ERROR's identity (the `AbortError` `throwIfAborted` raises),
    // not `signal.aborted`: a genuine I/O fault that happens to land after the
    // signal aborted for an unrelated reason must still be logged as a fault,
    // not silently misread as the cancellation.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    const msg = e instanceof Error ? e.message : String(e);
    // A file deleted while the Code tab is viewing it (ENOENT) is EXPECTED — the
    // delete-while-viewing race servePadi maps to a typed NOT_FOUND — so it logs
    // at debug, not error. Any other failure is a genuine, unexpected preview
    // I/O fault and MUST surface at error level for operators (errors-must-log-
    // at-error). The gone-file test is the SAME predicate servePadi's
    // `fileGoneAsNotFound` maps on — one source of truth, so they can't drift.
    if (isFileGoneError(e)) {
      log?.debug({ err: msg, repoPath, filePath }, "preview-tag file gone");
    } else {
      log?.error({ err: msg, repoPath, filePath }, "preview-tag hash failed");
    }
    return err({ code: "GIT_FAILED", message: `Failed to hash file: ${msg}` });
  }
}
