/** A conversation's title: `annotations/<id>.pbtxt`, one line of protobuf
 *  text format (`title:"…"`), which `agy` writes about half a second after a
 *  conversation's first prompt and replaces at `/rename`.
 *
 *  Its own leaf: the text format revs with `agy`'s annotations, not with the
 *  transcript or the lock files, and nothing else here reads it. */

import fs from "node:fs";
import type { Logger } from "kolu-shared";
import type { AntigravitySession } from "./core.ts";

/** Single-character escapes of protobuf text format, as bytes. */
const SIMPLE_ESCAPES: Record<string, number> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  v: 0x0b,
  "\\": 0x5c,
  "'": 0x27,
  '"': 0x22,
  "?": 0x3f,
};

/** Decode the body of a protobuf text-format string literal: the escapes the
 *  format defines (simple, octal, `\x` hex), bytes then read as UTF-8. Null
 *  for an escape the format does not define, or bytes that are not UTF-8. */
export function decodeProtoTextString(body: string): string | null {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      const code = body.codePointAt(i) as number;
      const char = String.fromCodePoint(code);
      bytes.push(...encoder.encode(char));
      i += char.length - 1;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) return null;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      bytes.push(simple);
      i += 1;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      const value = Number.parseInt(octal[0], 8);
      if (value > 0xff) return null;
      bytes.push(value);
      i += octal[0].length;
      continue;
    }
    const hex = /^x([0-9a-fA-F]{1,2})/.exec(body.slice(i + 1, i + 4));
    if (hex?.[1]) {
      bytes.push(Number.parseInt(hex[1], 16));
      i += hex[0].length;
      continue;
    }
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes),
    );
  } catch {
    return null;
  }
}

/** The whole file, one `title:"…"` line and nothing else. */
const TITLE_RE = /^title:\s*"((?:[^"\\\n]|\\.)*)"$/;

/** The conversation's own title, or null — the file is absent, unreadable
 *  (logged), or anything but the one `title:"…"` line. kolu makes none up. */
export function readTitle(
  session: AntigravitySession,
  log?: Logger,
): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(session.annotationsPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: session.annotationsPath, session: session.id },
        "antigravity: title unreadable",
      );
    }
    return null;
  }
  const m = TITLE_RE.exec(raw.trimEnd());
  if (!m || m[1] === undefined) return null;
  const title = decodeProtoTextString(m[1]);
  return title !== null && title.trim() !== "" ? title : null;
}
