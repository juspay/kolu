import { describe, expect, it } from "vitest";
import { isBlank, parsePlacementFlags } from "./placementFlags.ts";

const refusalOf = (
  command: string,
  flags: { toplevel: boolean; parent: string | undefined },
): string => {
  const read = parsePlacementFlags(command, flags);
  return read.kind === "refused" ? read.message : "";
};

describe("parsePlacementFlags refuses a pair that is not a statement", () => {
  it("neither flag — names BOTH spellings, the rule, and the migration", () => {
    const text = refusalOf("kolu create", {
      toplevel: false,
      parent: undefined,
    });
    expect(text).toContain("--toplevel");
    expect(text).toContain("--parent <id>");
    expect(text).toContain("exactly one");
    expect(text).toContain("There is no default");
    expect(text).toContain("who-works-for-whom");
    expect(text).toContain("`kolu create --toplevel`");
  });

  it("BOTH flags — names the exclusion rather than picking a winner", () => {
    const text = refusalOf("kolu create", { toplevel: true, parent: "3f9c" });
    expect(text).toContain("--toplevel and --parent are mutually exclusive");
    expect(text).toContain("Pass exactly one");
    expect(text).not.toMatch(/takes precedence|is ignored|wins/);
  });

  it("the required refusal names the CALLING command, so a script can copy it", () => {
    expect(
      refusalOf("padi-tui create", {
        toplevel: false,
        parent: undefined,
      }),
    ).toContain("`padi-tui create --toplevel`");
    expect(
      refusalOf("kolu create", {
        toplevel: false,
        parent: undefined,
      }),
    ).not.toContain("padi-tui");
  });

  it("a BLANK --parent is not a statement — an empty string is not an id", () => {
    for (const blank of ["", " ", "\t"]) {
      const text = refusalOf("padi-tui create", {
        toplevel: false,
        parent: blank,
      });
      expect(text).toContain("--parent was passed with an empty value");
      expect(text).toContain("--toplevel");
      expect(text).not.toContain("There is no default");
    }
  });

  it("whitespace counts as blank — the quoted-space accident", () => {
    expect(isBlank(" ")).toBe(true);
    expect(isBlank("3f9c")).toBe(false);
  });

  it("the exclusion refusal is face-INDEPENDENT — one sentence, both faces", () => {
    const both = { toplevel: true, parent: "3f9c" };
    expect(refusalOf("kolu create", both)).toBe(
      refusalOf("padi-tui create", both),
    );
  });
});

describe("parsePlacementFlags reads exactly one flag as its arm", () => {
  it("--toplevel alone is the toplevel arm", () => {
    expect(
      parsePlacementFlags("kolu create", {
        toplevel: true,
        parent: undefined,
      }),
    ).toEqual({ kind: "toplevel" });
  });

  it("--parent alone is the child-of arm, carrying the RAW query", () => {
    expect(
      parsePlacementFlags("kolu create", { toplevel: false, parent: "3f9c" }),
    ).toEqual({ kind: "child-of", parentQuery: "3f9c" });
  });

  it("the arm never depends on which face asked", () => {
    for (const flags of [
      { toplevel: true, parent: undefined },
      { toplevel: false, parent: "3f9c" },
    ]) {
      expect(parsePlacementFlags("kolu create", flags)).toEqual(
        parsePlacementFlags("padi-tui create", flags),
      );
    }
  });

  it("all four pairs are accounted for — three outcomes, no fourth", () => {
    const kinds = [
      { toplevel: false, parent: undefined },
      { toplevel: true, parent: undefined },
      { toplevel: false, parent: "3f9c" },
      { toplevel: true, parent: "3f9c" },
    ].map((f) => parsePlacementFlags("kolu create", f).kind);
    expect(kinds).toEqual(["refused", "toplevel", "child-of", "refused"]);
  });
});
