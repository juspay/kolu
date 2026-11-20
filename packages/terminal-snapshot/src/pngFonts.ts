import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const PNG_PRIMARY_FACE = "FiraCode Nerd Font Mono";

export const PNG_FONT_FAMILIES: readonly string[] = [
  PNG_PRIMARY_FACE,
  "Symbols Nerd Font Mono",
  "DejaVu Sans Mono",
  "Noto Sans Symbols 2",
  "Noto Sans Symbols",
];

export const PNG_FONT_FAMILY = PNG_FONT_FAMILIES.join(", ");

export function fontDir(): string {
  const dir = process.env.KOLU_SNAPSHOT_FONTS_DIR;
  if (!dir) {
    throw new Error(
      "KOLU_SNAPSHOT_FONTS_DIR is unset — the terminal-snapshot renderer needs the Nix-provided font directory (nix/packages/fonts). It is baked onto the daemon wrapper in default.nix and exported by shell.nix for a dev tree.",
    );
  }
  return dir;
}

// ── The `name` table ──────────────────────────────────────────────────
//
// An sfnt file is a 12-byte header, then `numTables` 16-byte records naming a
// tag and where its table starts. The `name` table is a 6-byte header, then
// `count` 12-byte records, then a string pool the records index into. Both
// layouts are fixed by the OpenType spec and have never changed; the only
// versioning is a `version` field this read does not need (v1's extra
// language-tag records sit AFTER the fields read here).

/** The two name IDs that spell a family, and the order fontdb — the font
 *  database inside resvg — resolves them in: the TYPOGRAPHIC family (16) when a
 *  face has one, the legacy family (1) otherwise, never a union of the two.
 *  Mirrored exactly, because a guard that accepted a name resvg would not match
 *  is a guard that passes while the render is tofu. */
const NAME_ID_FAMILY = 1;
const NAME_ID_TYPOGRAPHIC_FAMILY = 16;

export function familyNamesOf(face: Uint8Array): readonly string[] {
  const view = new DataView(face.buffer, face.byteOffset, face.byteLength);
  if (readTag(face, 0) === "ttcf") {
    throw new Error(
      "terminal-snapshot: a TrueType Collection (.ttc) is in the font directory; this reader handles single-face .ttf/.otf files only. Add collection support before adding one to nix/packages/fonts/snapshot.nix.",
    );
  }
  const nameTable = tableOffset(view, face, "name");
  if (nameTable === undefined) return [];

  const count = view.getUint16(nameTable + 2);
  const storage = nameTable + view.getUint16(nameTable + 4);
  const records = nameTable + 6;

  const typographic: string[] = [];
  const legacy: string[] = [];
  for (let i = 0; i < count; i++) {
    const record = records + i * 12;
    const nameId = view.getUint16(record + 6);
    if (nameId !== NAME_ID_FAMILY && nameId !== NAME_ID_TYPOGRAPHIC_FAMILY) {
      continue;
    }
    const platformId = view.getUint16(record);
    const length = view.getUint16(record + 8);
    const offset = storage + view.getUint16(record + 10);
    if (offset + length > face.byteLength) continue;
    const value = decodeName(
      face.subarray(offset, offset + length),
      platformId,
    );
    (nameId === NAME_ID_TYPOGRAPHIC_FAMILY ? typographic : legacy).push(value);
  }
  return typographic.length > 0 ? typographic : legacy;
}

export function assertFamilyCoverage(
  faces: readonly Uint8Array[],
  files: readonly string[],
  dir: string,
): void {
  const present = new Set(faces.flatMap((f) => [...familyNamesOf(f)]));
  const missing = PNG_FONT_FAMILIES.filter((f) => !present.has(f));
  if (missing.length === 0) return;
  throw new Error(
    `terminal-snapshot: ${dir} has no face whose \`name\` table declares ${missing
      .map((f) => `"${f}"`)
      .join(
        ", ",
      )} — the Nix font closure (nix/packages/fonts/snapshot.nix) and the family list in pngFonts.ts have parted, most likely on a nixpkgs bump that renamed a face's internal family. resvg resolves fallbacks by the DOCUMENT's family names, so this renders tofu for every glyph the first face lacks while still producing a valid-looking PNG. Read ${files.length} face(s): ${files.join(", ")}. Families found: ${[...present].sort().join(", ")}.`,
  );
}

export async function loadSnapshotFonts(): Promise<Uint8Array[]> {
  const dir = fontDir();
  const files = (await readdir(dir)).filter((f) => /\.(?:ttf|otf)$/i.test(f));
  if (files.length === 0) {
    throw new Error(
      `terminal-snapshot: ${dir} holds no font faces — the Nix font closure (nix/packages/fonts) is broken. A screenshot rendered in no font at all is not a degraded render, it is tofu.`,
    );
  }
  const faces = await Promise.all(
    files.map((f) => readFile(path.join(dir, f))),
  );
  assertFamilyCoverage(faces, files, dir);
  return faces;
}

function readTag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

function tableOffset(
  view: DataView,
  bytes: Uint8Array,
  tag: string,
): number | undefined {
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (readTag(bytes, record) === tag) return view.getUint32(record + 8);
  }
  return undefined;
}

/** One name record's string.
 *
 *  Platform 1 is Macintosh, whose strings are single-byte (MacRoman — ASCII for
 *  every family name a monospace face carries); every other platform stores
 *  UTF-16BE. Decoded by hand rather than through `TextDecoder("utf-16be")`,
 *  whose label is only recognised by a full-ICU build — a font family silently
 *  failing to decode on a small-ICU node is the very failure being guarded
 *  against. */
function decodeName(bytes: Uint8Array, platformId: number): string {
  if (platformId === 1) return String.fromCharCode(...bytes);
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  }
  return out;
}
