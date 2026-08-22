/** The PNG backend's FONT STACK — which families a document may name, and the
 *  faces that have to be there to answer them.
 *
 *  Both halves live in one module because they are one fact stated twice, and
 *  they were previously stated in two files with nothing checking that they
 *  agreed. The FILE-name half was already safe: `nix/packages/fonts/snapshot.nix`
 *  is the one authority for which face files exist, and the loader below reads
 *  whatever the directory holds rather than re-spelling that list. The
 *  FAMILY-name half was not. `PNG_FONT_FAMILIES` names five families that must
 *  match the `name` tables INSIDE those files, across a language boundary Nix
 *  cannot check and TypeScript cannot see — so a nixpkgs bump that renames a
 *  face's internal family ("Symbols Nerd Font Mono" → "Symbols Nerd Font")
 *  leaves the build green, the directory populated and `sceneToPng` happy, and
 *  renders every braille spinner frame and every `⎿` connector as tofu in a
 *  perfectly valid PNG. That is the silent-wrong-output failure this package's
 *  guards exist to prevent, and it is the same class as the one `sceneToPng`
 *  already catches one level up (a scene that names the wrong family).
 *
 *  So {@link loadSnapshotFonts} reads each face's `name` table and REFUSES to
 *  hand back a font set that cannot answer the document. Loud, by name, at the
 *  same point the empty-directory throw fires — the thread fails to evaluate
 *  and every screenshot fails with the missing family in the message, rather
 *  than one arriving in the wrong glyphs.
 *
 *  ## Why a hand-read `name` table and not a font library
 *
 *  Checked first, as the rule says: nothing in the workspace parses fonts
 *  (`@resvg/resvg-wasm` exposes no family introspection — you hand it buffers
 *  and it resolves internally), and neither candidate is free. `opentype.js`
 *  ships no type declarations at all as of 2.0.0 — its only types are a
 *  DefinitelyTyped package pinned to the 1.x API, so a strict-TS workspace
 *  would be adding a second spelling of the library's surface that drifts from
 *  it: the exact two-things-that-part failure this file exists to close.
 *  `fontkit` is the same story plus nine transitive dependencies. Against that,
 *  the thing actually needed is ONE table with a fixed, forty-year-old layout
 *  and no version skew, read once at thread start — about sixty lines, below.
 *  `terminal-snapshot` is a leaf whose closure ships from the Nix store; ~4 MB
 *  of untyped glyph-outline parser to read four uint16s is not a trade.
 *
 *  NOT in the package's export map: `png.ts` applies the family list (so a
 *  caller cannot get it wrong) and the worker takes the faces. Nothing outside
 *  this package has a use for either. */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** The face every other is a fallback for — the head of the list, not a value
 *  beside it, so the two cannot drift. */
export const PNG_PRIMARY_FACE = "FiraCode Nerd Font Mono";

/** The font families a PNG document may name, most-specific first.
 *
 *  Ordered: resvg falls back along the family list in the DOCUMENT, not along
 *  the order buffers were registered in. kolu's own FiraCode Nerd Font first
 *  (it is what the browser draws, and it alone carries the powerline and
 *  private-use icons a shell prompt uses), then DejaVu Sans Mono and the two
 *  Noto symbol faces, which between them supply the glyphs FiraCode lacks and
 *  an agent TUI leans on constantly.
 *
 *  Every name here is asserted present by {@link loadSnapshotFonts}. */
export const PNG_FONT_FAMILIES: readonly string[] = [
  PNG_PRIMARY_FACE,
  "Symbols Nerd Font Mono",
  "DejaVu Sans Mono",
  "Noto Sans Symbols 2",
  "Noto Sans Symbols",
];

/** The family list as a document says it. */
export const PNG_FONT_FAMILY = PNG_FONT_FAMILIES.join(", ");

/** Where the font files live, baked by Nix.
 *
 *  No PATH search and no bundled-copy fallback: kolu's rule is that a
 *  required value is baked in and its absence CRASHES rather than silently
 *  degrading, and a screenshot rendered in a substitute font is exactly the
 *  silent degradation that rule exists to prevent — it would look plausible
 *  and be wrong. */
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

/** The families this face answers to, as resvg would resolve them.
 *
 *  Every language's spelling is collected, not just the English one: a face
 *  whose only family record is, say, Japanese still answers to that string,
 *  and dropping it would fail a face that works. */
export function familyNamesOf(face: Uint8Array): readonly string[] {
  const view = new DataView(face.buffer, face.byteOffset, face.byteLength);
  if (readTag(face, 0) === "ttcf") {
    // A collection holds several faces behind one more level of indirection.
    // Named rather than skipped: the Nix font set has none today, and a face
    // this read silently ignored would be a family missing from the guard's
    // view — the guard's own failure mode, reintroduced.
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

/** Refuse a font set that cannot answer the document.
 *
 *  Throws by NAME, in the style of {@link fontDir}'s throw: the message says
 *  which family went missing and which files were actually read, because the
 *  fix is always in `nix/packages/fonts/snapshot.nix` and the reader needs to
 *  know what the bump renamed. */
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

/** Every face in the font directory, checked against the family list.
 *
 *  The DIRECTORY is the authority for which files exist — `snapshot.nix` names
 *  them, and a copy of that list here could only fail at runtime with an ENOENT
 *  once the two parted. Order is immaterial (the document's family list is what
 *  picks), so the read takes everything. */
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

/** The 4-byte ASCII tag at `at`. */
function readTag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + 4));
}

/** Where a table starts, or `undefined` when the file has no such table. */
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
