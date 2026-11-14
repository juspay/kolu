/**
 * Follow a growing line-oriented file (a JSONL transcript): each `read()`
 * hands over the complete lines appended since the previous one.
 *
 * The companion to `readTailLines`, for a reader that needs EVERY line rather
 * than a recent window — a fact written once near the top of a session file
 * and not repeated. The first `read()` covers the whole file; later ones only
 * what was appended, so a large file is read once.
 *
 * - **A half-written line waits.** The bytes after the last newline are held
 *   back until their newline lands.
 * - **A character split across two reads stays whole** (a `StringDecoder`
 *   holds back a partial multi-byte sequence).
 * - **A rewritten file is read again from byte 0.** A file replaced
 *   atomically (a new inode), or rewritten shorter than the point already
 *   read, cannot be continued from the old offset — that would start
 *   mid-line in different content — so `onRestart` fires and every line is
 *   handed over again.
 * - **Bounded memory per step**: the file is read in fixed-size chunks.
 */

import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";

const CHUNK_BYTES = 1024 * 1024;

/** Configuration for `createAppendedLineReader`. */
export interface AppendedLineConfig {
  /** Absolute path of the file to follow. */
  path: string;
  /** Each complete line (without its newline), in file order. Empty lines
   *  are skipped. */
  onLine: (line: string) => void;
  /** The file was replaced or shrank: everything handed over so far is void,
   *  and the lines that follow start again from the top of the file. */
  onRestart: () => void;
  /** Invoked when opening or reading the file throws — absence included. The
   *  next `read()` tries again from where the last good one stopped. */
  onError: (err: unknown) => void;
}

export interface AppendedLineReader {
  /** Hand every complete line appended since the last call to `onLine`. */
  read(): void;
}

export function createAppendedLineReader(
  config: AppendedLineConfig,
): AppendedLineReader {
  const { path, onLine, onRestart, onError } = config;
  let ino: number | null = null;
  let offset = 0;
  let decoder = new StringDecoder("utf8");
  let carry = "";

  return {
    read() {
      let fd: number;
      try {
        fd = fs.openSync(path, "r");
      } catch (err) {
        onError(err);
        return;
      }
      try {
        const stat = fs.fstatSync(fd);
        if (stat.ino !== ino || stat.size < offset) {
          if (ino !== null) onRestart();
          ino = stat.ino;
          offset = 0;
          decoder = new StringDecoder("utf8");
          carry = "";
        }
        while (offset < stat.size) {
          const want = Math.min(CHUNK_BYTES, stat.size - offset);
          const buf = Buffer.allocUnsafe(want);
          const got = fs.readSync(fd, buf, 0, want, offset);
          if (got === 0) break;
          offset += got;
          const lines = (carry + decoder.write(buf.subarray(0, got))).split(
            "\n",
          );
          carry = lines.pop() ?? "";
          for (const line of lines) {
            if (line.length > 0) onLine(line);
          }
        }
      } catch (err) {
        onError(err);
      } finally {
        fs.closeSync(fd);
      }
    },
  };
}
