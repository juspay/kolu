/**
 * Per-terminal on-disk scratch storage for content uploaded from the
 * browser — clipboard image pastes and drag-and-drop file drops both
 * land here via `saveTerminalFile`. The `router.ts` handlers call it
 * and then bracketed-paste the returned path into the PTY so agents
 * that accept paste-as-file-path (codex, Claude Code) can read the
 * file. `cleanupTerminalScratch` wipes the dir on terminal exit.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, parse, sep } from "node:path";
import { koluScratchDir } from "./koluRoot.ts";

function dirFor(terminalId: string): string {
  return join(koluScratchDir(), terminalId);
}

/** Strip everything but the basename and collapse any character that
 *  would let a dropped name escape the per-terminal directory or break
 *  shell tools that consume the path. Preserves the extension so the
 *  receiving agent still sees a meaningful suffix. Always returns a
 *  non-empty string. */
export function sanitizeUploadName(rawName: string): string {
  const base = basename(rawName);
  // Unicode-aware allowlist: keep letters/numbers/combining-marks of any
  // script (so `berichte_märz.pdf`, `文件.txt`, NFD-decomposed names survive)
  // plus `._-`, and collapse everything else to `_`. This still strips the
  // dangerous set — path separators (`/`, `\`), control chars, and shell
  // metacharacters — that could escape the per-terminal dir or break the
  // tools consuming the pasted path; only the old ASCII-only mangling of
  // legitimate unicode letters is lifted. `normalize("NFC")` composes
  // decomposed input first so a base letter + combining accent isn't split.
  const sanitized = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}._-]/gu, "_");
  // Strip leading dots so the result is never a hidden file or `..`.
  const trimmed = sanitized.replace(/^\.+/, "");
  return trimmed.length > 0 ? trimmed : "upload";
}

/** Pick a path that doesn't collide with an existing file in the same
 *  terminal directory. Appends `-1`, `-2`, … before the extension. */
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

/** Save base64-encoded data into the terminal's scratch directory,
 *  creating the dir on first use. Returns the on-disk path so the
 *  caller can bracketed-paste it into the PTY.
 *
 *  `name` is sanitized; a collision suffix (`-1`, `-2`, …) protects
 *  any prior file in the dir from being clobbered. Two pastes in
 *  flight — image then drop, drop then drop, or two pastes before the
 *  agent has consumed the first — each get their own path so the
 *  bracketed-paste references survive a late read. */
export function saveTerminalFile(
  terminalId: string,
  name: string,
  base64Data: string,
): string {
  const dir = dirFor(terminalId);
  // OWNER-ONLY perms on both the dir (0700) and the file (0600). The scratch
  // holds content pasted/dropped from the browser (clipboard images, dropped
  // files) — potentially sensitive — and the receiving agent runs as THIS user,
  // so owner-only is byte-identical for the legitimate read while closing the
  // world-readable-temp-file exposure (CodeQL js/insecure-temporary-file):
  // koluScratchDir normally sits under the per-user XDG_RUNTIME_DIR, but an
  // explicit mode is correct even if that ever falls back to a shared temp root.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = uniquePath(dir, sanitizeUploadName(name));
  writeFileSync(path, Buffer.from(base64Data, "base64"), { mode: 0o600 });
  return path;
}

/** Append base64-encoded data to a file ALREADY inside `terminalId`'s scratch
 *  directory — the continuation of a chunked upload. Returns the path, and the
 *  file's total size on disk after the append, so the caller can re-run the
 *  size policy against the accumulated total rather than the one chunk.
 *
 *  `path` arrives from the client (it is the path a previous `write` returned),
 *  so it is validated, not trusted: it must resolve INSIDE this terminal's own
 *  scratch dir and must already exist. That containment check is what stops a
 *  crafted `appendTo` from turning an upload into an arbitrary-file append —
 *  `..`, an absolute path elsewhere, and another terminal's dir are all
 *  refused. `realpathSync` resolves symlinks BEFORE the comparison, so a
 *  symlink planted inside the scratch dir cannot point the append out of it.
 *
 *  Throws on any violation; the caller turns that into a typed refusal. */
export function appendTerminalFile(
  terminalId: string,
  path: string,
  base64Data: string,
): { path: string; totalBytes: number } {
  const dir = realpathSync(dirFor(terminalId));
  // Resolve the target's own real path. It must already exist — an append is
  // only ever a CONTINUATION, never the thing that creates the file, so a
  // missing target is a protocol violation rather than a first chunk.
  if (!existsSync(path)) {
    throw new Error("scratch append target does not exist");
  }
  const real = realpathSync(path);
  // `sep`-terminated prefix: `/scratch/t1` must not match `/scratch/t10`.
  if (!real.startsWith(dir + sep)) {
    throw new Error("scratch append target is outside the terminal's dir");
  }
  appendFileSync(real, Buffer.from(base64Data, "base64"), { mode: 0o600 });
  return { path: real, totalBytes: statSync(real).size };
}

/** Remove a terminal's scratch directory. Safe to call when the dir
 *  was never created. */
export function cleanupTerminalScratch(terminalId: string): void {
  rmSync(dirFor(terminalId), { recursive: true, force: true });
}
