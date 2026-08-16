/**
 * The CLI-flag half of the no-default rule, pinned once for BOTH padi CLI faces.
 *
 * `kolu create` and `padi-tui create` carry the same verb and must answer the
 * `--toplevel` / `--parent` pair identically. They do so by running the same
 * `parsePlacementFlags`, so this file is the whole behavioural pin for both — the
 * faces add only their command name and their own failure type, and
 * `kolu-cli`'s `create.test.ts` pins that its gate fires before the dial.
 *
 * Before the parse was shared, the branch was hand-written twice and only the
 * SENTENCES were imported from one place. That is a weaker guarantee than it
 * reads as: two copies of a four-branch decision drift on the next edit — a
 * reordered check, a third flag — and nothing structural notices. Which would be
 * the no-default defect one layer up, two faces quietly disagreeing about what a
 * create meant.
 */

import { describe, expect, it } from "vitest";
import { isBlank, parsePlacementFlags } from "./render.ts";

/** The refusal text for a pair that says nothing, or `""` if it was accepted —
 *  so a regression reads as a missing sentence rather than a thrown accessor. */
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
    // The rule, not just the flags: a caller who did not know there was a
    // decision to make will otherwise pick whichever arm is named first.
    expect(text).toContain("There is no default");
    expect(text).toContain("who-works-for-whom");
    // …and the migration, in the one word it costs a script.
    expect(text).toContain("`kolu create --toplevel`");
  });

  it("BOTH flags — names the exclusion rather than picking a winner", () => {
    const text = refusalOf("kolu create", { toplevel: true, parent: "3f9c" });
    expect(text).toContain("--toplevel and --parent are mutually exclusive");
    expect(text).toContain("Pass exactly one");
    // A precedence winner would BE the silent decision this pair deletes, so
    // neither flag may be described as the one that wins.
    expect(text).not.toMatch(/takes precedence|is ignored|wins/);
  });

  it("the required refusal names the CALLING command, so a script can copy it", () => {
    // The one thing that legitimately differs between the two faces. `padi-tui`
    // users must not be told to type `kolu create`, and vice versa.
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
    // `--parent "$ID"` with `$ID` unset. Treated as a `child-of` arm this reached
    // the far side and failed only after the dial, so `padi-tui create --parent ""`
    // over `--host` provisioned a cold box for a command that could not run.
    for (const blank of ["", " ", "\t"]) {
      const text = refusalOf("padi-tui create", {
        toplevel: false,
        parent: blank,
      });
      expect(text).toContain("--parent was passed with an empty value");
      // Both repairs, because an unset variable and a changed mind want opposite
      // ones — and neither is "we picked top level for you".
      expect(text).toContain("--toplevel");
      expect(text).not.toContain("There is no default");
    }
  });

  it("whitespace counts as blank — the quoted-space accident", () => {
    // The same rule `kolu create`'s own blank gate applies, and now literally the
    // same predicate: `isBlank` is authored here and re-exported by `exit.ts`.
    expect(isBlank(" ")).toBe(true);
    expect(isBlank("3f9c")).toBe(false);
  });

  it("the exclusion refusal is face-INDEPENDENT — one sentence, both faces", () => {
    // It names only the flags, which are spelled the same everywhere, so there
    // is nothing per-face in it to get wrong.
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
    // Raw, not a `TerminalId`: a user hands either CLI any unique prefix, and
    // widening it needs the live roster — which needs the dial. Deciding the ARM
    // purely is what lets both faces refuse a bad pair before a `--host`
    // provisions a cold box for a command that was never going to run.
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
    // The exhaustiveness IS the rule: any pair that is not exactly one flag is a
    // refusal, and there is no arm-order fallthrough that could quietly return a
    // placement nobody stated.
    const kinds = [
      { toplevel: false, parent: undefined },
      { toplevel: true, parent: undefined },
      { toplevel: false, parent: "3f9c" },
      { toplevel: true, parent: "3f9c" },
    ].map((f) => parsePlacementFlags("kolu create", f).kind);
    expect(kinds).toEqual(["refused", "toplevel", "child-of", "refused"]);
  });
});
