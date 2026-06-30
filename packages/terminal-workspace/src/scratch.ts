/**
 * `@kolu/terminal-workspace/scratch` — the host-side paste/upload sink: write a
 * dropped file into a per-terminal scratch dir on THIS machine and return its
 * on-disk path (the caller bracketed-pastes it into the host's PTY so an agent
 * can read it). The NODE face, beside `./endpoint`.
 *
 * Lifted out of kolu-server so the SAME write+sanitize lives in one place behind
 * the `scratch.write` surface procedure both homes serve: kolu-server (its
 * `koluScratchDir`) and the `pulam` daemon (its own scratch root). Only the
 * scratch ROOT varies per home — the safety (sanitize to a basename, collision
 * suffix, write under the per-terminal dir) is one implementation.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, parse } from "node:path";

/** Strip everything but the basename and collapse any character that would let
 *  a dropped name escape the per-terminal directory or break shell tools that
 *  consume the path. Preserves the extension so the receiving agent still sees a
 *  meaningful suffix. Always returns a non-empty string. */
export function sanitizeUploadName(rawName: string): string {
  const base = basename(rawName);
  // Unicode-aware allowlist: keep letters/numbers/combining-marks of any script
  // (so `berichte_märz.pdf`, `文件.txt`, NFD-decomposed names survive) plus
  // `._-`, and collapse everything else to `_`. This still strips the dangerous
  // set — path separators (`/`, `\`), control chars, and shell metacharacters —
  // that could escape the per-terminal dir or break the tools consuming the
  // pasted path. `normalize("NFC")` composes decomposed input first so a base
  // letter + combining accent isn't split.
  const sanitized = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\p{M}._-]/gu, "_");
  // Strip leading dots so the result is never a hidden file or `..`.
  const trimmed = sanitized.replace(/^\.+/, "");
  return trimmed.length > 0 ? trimmed : "upload";
}

/** Pick a path that doesn't collide with an existing file in the same terminal
 *  directory. Appends `-1`, `-2`, … before the extension. */
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

/** Save base64-encoded `data` into `<scratchRoot>/<terminalId>/<sanitized-name>`,
 *  creating the per-terminal dir on first use. Returns the on-disk path so the
 *  caller can bracketed-paste it into the PTY.
 *
 *  `name` is sanitized; a collision suffix (`-1`, `-2`, …) protects any prior
 *  file in the dir from being clobbered, so two pastes in flight each get their
 *  own path and a late read still resolves. */
export function writeScratchFile(
  scratchRoot: string,
  terminalId: string,
  name: string,
  base64Data: string,
): string {
  const dir = join(scratchRoot, terminalId);
  mkdirSync(dir, { recursive: true });
  const path = uniquePath(dir, sanitizeUploadName(name));
  writeFileSync(path, Buffer.from(base64Data, "base64"));
  return path;
}
