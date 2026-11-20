import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { familyNamesOf, PNG_FONT_STACK } from "./pngFonts.ts";

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

describe("the font stack is the only way to the faces", () => {
  const dirs: string[] = [];
  const previous = process.env.KOLU_SNAPSHOT_FONTS_DIR;

  afterEach(async () => {
    if (previous === undefined) delete process.env.KOLU_SNAPSHOT_FONTS_DIR;
    else process.env.KOLU_SNAPSHOT_FONTS_DIR = previous;
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true })));
  });

  async function fontDirOf(faces: readonly Uint8Array[]): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "terminal-snapshot-fonts-"));
    dirs.push(dir);
    await Promise.all(
      faces.map((f, i) => writeFile(path.join(dir, `face-${i}.ttf`), f)),
    );
    return dir;
  }

  const stackNamed = (as: (family: string) => string) =>
    fontDirOf(
      PNG_FONT_STACK.families.map((family) =>
        face([{ nameId: 1, value: as(family) }]),
      ),
    );

  it("loads every face when the directory declares every family", async () => {
    process.env.KOLU_SNAPSHOT_FONTS_DIR = await stackNamed((family) => family);
    await expect(PNG_FONT_STACK.load()).resolves.toHaveLength(
      PNG_FONT_STACK.families.length,
    );
  });

  it("names the family a renamed face took away", async () => {
    process.env.KOLU_SNAPSHOT_FONTS_DIR = await stackNamed((family) =>
      family === "Symbols Nerd Font Mono" ? "Symbols Nerd Font" : family,
    );
    await expect(PNG_FONT_STACK.load()).rejects.toThrow(
      /"Symbols Nerd Font Mono"/,
    );
  });

  it("refuses a directory of faces that declare nothing the document names", async () => {
    process.env.KOLU_SNAPSHOT_FONTS_DIR = await fontDirOf([
      face([{ nameId: 1, value: "Comic Sans MS" }]),
    ]);
    await expect(PNG_FONT_STACK.load()).rejects.toThrow(
      /pngFonts\.ts have parted/,
    );
  });

  it("refuses a directory with no faces in it at all", async () => {
    process.env.KOLU_SNAPSHOT_FONTS_DIR = await fontDirOf([]);
    await expect(PNG_FONT_STACK.load()).rejects.toThrow(/holds no font faces/);
  });
});
