/** The family-name guard, against synthetic faces.
 *
 *  Synthetic rather than the real Nix closure: those files are only present
 *  inside `nix develop`, and what is under test is the RULE — that a face
 *  declaring the wrong family is refused by name — not that today's nixpkgs
 *  happens to ship the right ones. The real closure is exercised by
 *  `render.smoke.ts`, which loads it for real and would now die at thread
 *  start rather than emitting tofu.
 *
 *  The builder below writes just enough sfnt for the reader: a table directory
 *  with one `name` table in it. That is the whole surface `familyNamesOf`
 *  touches, so a fixture with a glyf/CFF table would only be scenery. */

import { describe, expect, it } from "vitest";
import {
  assertFamilyCoverage,
  familyNamesOf,
  PNG_FONT_FAMILIES,
} from "./pngFonts.ts";

/** UTF-16BE, the encoding every non-Macintosh name record uses. */
function utf16be(value: string): number[] {
  return [...value].flatMap((ch) => {
    const code = ch.charCodeAt(0);
    return [code >> 8, code & 0xff];
  });
}

/** A one-table sfnt whose `name` table carries the given `(nameId, value)`
 *  records, Windows platform (3). */
function face(
  records: readonly { nameId: number; value: string }[],
): Uint8Array {
  const strings: number[] = [];
  const nameRecords: number[] = [];
  for (const { nameId, value } of records) {
    const bytes = utf16be(value);
    const offset = strings.length;
    strings.push(...bytes);
    nameRecords.push(
      0,
      3, // platformID 3 (Windows)
      0,
      1, // encodingID 1 (Unicode BMP)
      0x04,
      0x09, // languageID 0x0409 (en-US)
      nameId >> 8,
      nameId & 0xff,
      bytes.length >> 8,
      bytes.length & 0xff,
      offset >> 8,
      offset & 0xff,
    );
  }
  const storageOffset = 6 + records.length * 12;
  const nameTable = [
    0,
    0, // version
    0,
    records.length,
    storageOffset >> 8,
    storageOffset & 0xff,
    ...nameRecords,
    ...strings,
  ];
  const nameOffset = 12 + 16;
  const header = [
    0,
    1,
    0,
    0, // sfntVersion 1.0
    0,
    1, // numTables
    0,
    0,
    0,
    0,
    0,
    0, // searchRange / entrySelector / rangeShift — unread
  ];
  const record = [
    ..."name".split("").map((c) => c.charCodeAt(0)),
    0,
    0,
    0,
    0, // checksum — unread
    (nameOffset >> 24) & 0xff,
    (nameOffset >> 16) & 0xff,
    (nameOffset >> 8) & 0xff,
    nameOffset & 0xff,
    (nameTable.length >> 24) & 0xff,
    (nameTable.length >> 16) & 0xff,
    (nameTable.length >> 8) & 0xff,
    nameTable.length & 0xff,
  ];
  return Uint8Array.from([...header, ...record, ...nameTable]);
}

describe("familyNamesOf", () => {
  it("reads the legacy family (name id 1)", () => {
    expect(
      familyNamesOf(face([{ nameId: 1, value: "DejaVu Sans Mono" }])),
    ).toEqual(["DejaVu Sans Mono"]);
  });

  it("prefers the TYPOGRAPHIC family (16) and does not union it with the legacy one", () => {
    // fontdb — the database inside resvg — resolves 16 when a face has one and
    // never falls back to 1 in that case. A guard that accepted the legacy name
    // too would pass on a face resvg cannot match, which is the whole failure
    // being guarded against.
    const both = face([
      { nameId: 1, value: "FiraCode NF Mono" },
      { nameId: 16, value: "FiraCode Nerd Font Mono" },
    ]);
    expect(familyNamesOf(both)).toEqual(["FiraCode Nerd Font Mono"]);
  });

  it("has no families to offer when the file carries no name table", () => {
    // The empty header alone: no `name` record for `tableOffset` to find.
    expect(
      familyNamesOf(Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toEqual([]);
  });
});

describe("assertFamilyCoverage", () => {
  const full = () =>
    PNG_FONT_FAMILIES.map((name) => face([{ nameId: 1, value: name }]));

  it("accepts a face set that declares every family the document may name", () => {
    expect(() =>
      assertFamilyCoverage(full(), ["a.ttf"], "/fonts"),
    ).not.toThrow();
  });

  it("names the family a renamed face took away", () => {
    // The real scenario: a nixpkgs bump renames a face's internal family. The
    // directory is still populated and every file still parses, so nothing else
    // in the pipeline notices — the render just comes out as tofu wherever the
    // primary face lacks a glyph.
    const renamed = PNG_FONT_FAMILIES.map((name) =>
      face([
        {
          nameId: 1,
          value: name === "Symbols Nerd Font Mono" ? "Symbols Nerd Font" : name,
        },
      ]),
    );
    expect(() => assertFamilyCoverage(renamed, ["sym.ttf"], "/fonts")).toThrow(
      /"Symbols Nerd Font Mono"/,
    );
  });

  it("refuses a directory of faces that declare nothing the document names", () => {
    expect(() =>
      assertFamilyCoverage(
        [face([{ nameId: 1, value: "Comic Sans MS" }])],
        ["comic.ttf"],
        "/fonts",
      ),
    ).toThrow(/pngFonts\.ts have parted/);
  });
});
