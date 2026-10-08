import { describe, expect, it } from "vitest";
import { PLUGIN_SKILLS, parseSkill, skillBlurb } from "./pluginSkills";

describe("PLUGIN_SKILLS — the real agent-plugin/skills", () => {
  it("reads kolu's own skill with its name and first-clause blurb", () => {
    const kolu = PLUGIN_SKILLS.find((s) => s.name === "kolu");
    expect(kolu).toEqual({
      name: "kolu",
      blurb: "drive one AI agent from another through kolu's terminals",
    });
  });
});

describe("skillBlurb", () => {
  it("stops at the first `:` or `.` and lower-cases the first letter", () => {
    expect(skillBlurb("Drive things: more")).toBe("drive things");
    expect(skillBlurb("Watch a log. Then more")).toBe("watch a log");
    expect(skillBlurb("No stop at all")).toBe("no stop at all");
  });
});

describe("parseSkill", () => {
  it("reads a folded description", () => {
    const src =
      "---\nname: x\ndescription: >-\n  Say hello\n  twice: loudly\n---\nbody\n";
    expect(parseSkill("x/SKILL.md", src)).toEqual({
      name: "x",
      blurb: "say hello twice",
    });
  });

  it("throws on a file without front matter, a name, or a description", () => {
    expect(() => parseSkill("a", "no front matter")).toThrow(/front matter/);
    expect(() => parseSkill("b", "---\ndescription: d\n---\n")).toThrow(
      /no name/,
    );
    expect(() => parseSkill("c", "---\nname: c\n---\n")).toThrow(
      /no description/,
    );
  });
});
