import { describe, expect, it } from "vitest";
import {
  assertFamilyCoverage,
  familyNamesOf,
  PNG_FONT_FAMILIES,
} from "./pngFonts.ts";

function utf16be(value: string): number[] {
  return [...value].flatMap((ch) => {
    const code = ch.charCodeAt(0);
    return [code >> 8, code & 0xff];
  });
}

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
    const both = face([
      { nameId: 1, value: "FiraCode NF Mono" },
      { nameId: 16, value: "FiraCode Nerd Font Mono" },
    ]);
    expect(familyNamesOf(both)).toEqual(["FiraCode Nerd Font Mono"]);
  });

  it("has no families to offer when the file carries no name table", () => {
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
