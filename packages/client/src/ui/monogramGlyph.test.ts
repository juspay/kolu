import { describe, expect, it } from "vitest";
import { repoMonogram } from "./monogramGlyph";

describe("repoMonogram", () => {
  it("uppercases the first alphanumeric of a repo name", () => {
    expect(repoMonogram("kolu")).toBe("K");
    expect(repoMonogram("spacetime")).toBe("S");
  });

  it("skips leading punctuation to the first letter", () => {
    expect(repoMonogram(".dotfiles")).toBe("D");
  });

  it("keeps a non-alphanumeric lead grapheme (home ~)", () => {
    expect(repoMonogram("~")).toBe("~");
  });

  it("returns ? only for an empty group", () => {
    expect(repoMonogram("")).toBe("?");
  });

  it("NFC and NFD equivalent names yield the same monogram", () => {
    const nfc = "éclair";
    const nfd = "e\u0301clair";
    expect(nfc.normalize("NFC")).not.toBe(nfd);
    expect(repoMonogram(nfc)).toBe(repoMonogram(nfd));
    expect(repoMonogram(nfc)).toBe("É");
  });
});
