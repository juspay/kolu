import {
  appendFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join, parse, sep } from "node:path";
import { koluScratchDir } from "./koluRoot.ts";

const OWNER_ONLY_DIR_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;

const SAFE_NAME_CHARS = /[^\p{L}\p{N}\p{M}._-]/gu;
const HIDDEN_PREFIX = /^\.+/;

function dirFor(terminalId: string): string {
  return join(koluScratchDir(), terminalId);
}

/** Strip everything but the basename and collapse any character that
 *  would let a dropped name escape the per-terminal directory or break
 *  shell tools that consume the path. Preserves the extension so the
 *  receiving agent still sees a meaningful suffix. Always returns a
 *  non-empty string. */
export function sanitizeUploadName(rawName: string): string {
  const visible = basename(rawName)
    .normalize("NFC")
    .replace(SAFE_NAME_CHARS, "_")
    .replace(HIDDEN_PREFIX, "");
  return visible.length > 0 ? visible : "upload";
}

function uniquePath(dir: string, name: string): string {
  const { name: stem, ext } = parse(name);
  let candidate = join(dir, name);
  let i = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}-${i}${ext}`);
    i++;
  }
  return candidate;
}

/** THE canonical spelling of a scratch path — every path this module HANDS OUT
 *  goes through here, so one file has exactly one name.
 *
 *  macOS reaches its temp root through a symlink (`/tmp` → `/private/tmp`), so
 *  an unresolved and a realpath-resolved spelling of the same file differ
 *  there; resolving makes the answer independent of which alias was used. */
function canonicalScratchPath(path: string): string {
  return realpathSync(path);
}

function assertInsideScratchDir(dirPath: string, candidate: string): string {
  const dir = canonicalScratchPath(dirPath);
  const real = canonicalScratchPath(candidate);
  if (!real.startsWith(dir + sep)) {
    throw new Error("scratch append target is outside the terminal's dir");
  }
  return real;
}

/** Save base64-encoded data into the terminal's scratch directory,
 *  creating the dir on first use. Returns the canonical on-disk path so the
 *  caller can bracketed-paste it into the PTY — and hand back as `appendTo`.
 *
 *  `name` is sanitized; a collision suffix (`-1`, `-2`, …) protects
 *  any prior file in the dir from being clobbered. */
export function saveTerminalFile(
  terminalId: string,
  name: string,
  base64Data: string,
): string {
  const dir = dirFor(terminalId);
  mkdirSync(dir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
  const path = uniquePath(dir, sanitizeUploadName(name));
  writeFileSync(path, Buffer.from(base64Data, "base64"), {
    mode: OWNER_ONLY_FILE_MODE,
  });
  return canonicalScratchPath(path);
}

/** Append base64-encoded data to a file ALREADY inside `terminalId`'s scratch
 *  directory — the continuation of a chunked upload. Returns the path, and the
 *  file's total size on disk after the append, so the caller can re-run the
 *  size policy against the accumulated total rather than the one chunk.
 *
 *  `path` arrives from the client (it is the path a previous `write` returned),
 *  so it is validated, not trusted: it must resolve INSIDE this terminal's own
 *  scratch dir and must already exist.
 *  Throws on any violation; the caller turns that into a typed refusal. */
export function appendTerminalFile(
  terminalId: string,
  path: string,
  base64Data: string,
): { path: string; totalBytes: number } {
  if (!existsSync(path)) {
    throw new Error("scratch append target does not exist");
  }
  const real = assertInsideScratchDir(dirFor(terminalId), path);
  appendFileSync(real, Buffer.from(base64Data, "base64"), {
    mode: OWNER_ONLY_FILE_MODE,
  });
  return { path: real, totalBytes: statSync(real).size };
}

/** Remove a terminal's scratch directory. Safe to call when the dir
 *  was never created. */
export function cleanupTerminalScratch(terminalId: string): void {
  rmSync(dirFor(terminalId), { recursive: true, force: true });
}

/** Remove a terminal's scratch directory WITHOUT blocking the event loop — the
 *  async twin of {@link cleanupTerminalScratch}. Safe to call when the dir
 *  was never created. */
export async function removeTerminalScratch(terminalId: string): Promise<void> {
  await rm(dirFor(terminalId), { recursive: true, force: true });
}
