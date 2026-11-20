import fs from "node:fs";

/** Configuration for `readTailLines`. */
export interface TailReadConfig {
  /** Absolute path of the file to read. */
  path: string;
  /** Authoritative file size. Passed in (not restat'd) so callers that
   *  have already stat'd — e.g. to check whether the file has grown
   *  since the last read — can reuse the size without a second syscall. */
  size: number;
  /** Maximum number of trailing bytes to read. Actual read is
   *  `min(maxBytes, size)`. */
  maxBytes: number;
  /** Invoked when `openSync` or `readSync` throws. The file's absence
   *  is NOT signalled here — callers that care about ENOENT should
   *  stat first. This only fires on hard I/O errors during read.
   *  The function returns null after invoking; the caller decides
   *  what to log and at what level. */
  onError?: (err: unknown) => void;
}

/**
 * Read the last `maxBytes` of a file at the given `size`, split into
 * non-empty lines, and drop a possibly-partial first line unless the
 * read started at byte 0.
 *
 * Returns `null` if the open/read failed (and invokes `onError`
 * synchronously before returning). Returns `string[]` (possibly
 * empty) on success. The FD is closed on every path via a
 * `try/finally` — no leak on `readSync` throw.
 */
export function readTailLines(config: TailReadConfig): string[] | null {
  const { path, size, maxBytes, onError } = config;
  const start = Math.max(0, size - maxBytes);
  const toRead = Math.min(maxBytes, size);
  const buf = Buffer.alloc(toRead);

  try {
    const fd = fs.openSync(path, "r");
    try {
      fs.readSync(fd, buf, 0, toRead, start);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    onError?.(err);
    return null;
  }

  const text = buf.toString("utf8");
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (start > 0 && lines.length > 0) lines.shift();
  return lines;
}
