/**
 * Host-side per-terminal scratch storage for content uploaded from the browser
 * — clipboard image pastes and drag-and-drop file drops land here via
 * `writeWatcherFile`, which kolu-server reaches through the watcher's
 * `fs.writeFile` procedure. The returned path is bracketed-pasted into the PTY
 * so agents that accept paste-as-file-path (codex, Claude Code) can read the
 * file from the HOST the terminal actually runs on, not kolu-server's machine.
 *
 * This intentionally mirrors kolu-server's `terminalScratch.ts` across the
 * package boundary: the same `sanitizeUploadName` (security-sensitive — kept
 * VERBATIM) + `uniquePath` logic, writing under a host scratch ROOT instead of
 * kolu-server's `koluScratchDir`. The two copies are independent on purpose (no
 * cross-package import of node-fs scratch internals); a change to the sanitizer
 * must be made in both places.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { basename, join, parse } from "node:path";

/** Per-host scratch root: `$XDG_RUNTIME_DIR/kolu-watcher-scratch`, falling back
 *  to the OS tmpdir when the host has no `XDG_RUNTIME_DIR`. */
const scratchRoot = join(
  process.env.XDG_RUNTIME_DIR ?? os.tmpdir(),
  "kolu-watcher-scratch",
);

function dirFor(terminalId: string): string {
  return join(scratchRoot, terminalId);
}

/** Strip everything but the basename and collapse any character that
 *  would let a dropped name escape the per-terminal directory or break
 *  shell tools that consume the path. Preserves the extension so the
 *  receiving agent still sees a meaningful suffix. Always returns a
 *  non-empty string.
 *
 *  This intentionally MIRRORS kolu-server's `terminalScratch.ts`
 *  `sanitizeUploadName` across the package boundary — keep the two copies in
 *  lockstep (it is security-sensitive; do not weaken either). */
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

/** Save base64-encoded data into the host's per-terminal scratch directory,
 *  creating the dir on first use. Returns the on-disk path so the caller can
 *  bracketed-paste it into the PTY. `name` is sanitized; a collision suffix
 *  (`-1`, `-2`, …) protects any prior file in the dir from being clobbered. */
export function writeWatcherFile(
  terminalId: string,
  name: string,
  base64Data: string,
): string {
  const dir = dirFor(terminalId);
  mkdirSync(dir, { recursive: true });
  const path = uniquePath(dir, sanitizeUploadName(name));
  writeFileSync(path, Buffer.from(base64Data, "base64"));
  return path;
}
