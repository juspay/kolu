import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { type CreateArgs, run } from "./create.ts";

const NOTHING: CreateArgs = {
  argv: [],
  cwd: undefined,
  toplevel: false,
  parent: undefined,
  intent: undefined,
  repo: undefined,
  worktree: undefined,
  json: false,
};

const refusalOf = (over: Partial<CreateArgs>): string => {
  const exit = Effect.runSyncExit(
    run({ kind: "auto" }, { ...NOTHING, ...over }),
  );
  if (!Exit.isFailure(exit)) {
    throw new Error(
      `expected \`kolu create ${JSON.stringify(over)}\` to be refused; it was not`,
    );
  }
  const err = Cause.squash(exit.cause) as { readonly stderr?: string };
  return err.stderr ?? "";
};

describe("kolu create refuses a blank flag value at the gate", () => {
  it("names the flag that was empty, for every flag that names something", () => {
    for (const [flag, over] of [
      ["--cwd", { cwd: "" }],
      ["--parent", { parent: "" }],
      ["--intent", { intent: "" }],
      ["--repo", { repo: "" }],
      ["--worktree", { worktree: "" }],
    ] as const satisfies ReadonlyArray<
      readonly [string, Partial<CreateArgs>]
    >) {
      const text = refusalOf(over);
      expect(text).toContain(flag);
      expect(text).toContain("empty value");
    }
  });

  it("counts whitespace as empty — a quoted space is the same accident", () => {
    expect(refusalOf({ worktree: " " })).toContain("--worktree");
  });
});

describe("kolu create refuses to guess a placement", () => {
  it("refuses a bare create, naming BOTH flags and the rule", () => {
    const text = refusalOf({});
    expect(text).toContain("--toplevel");
    expect(text).toContain("--parent");
    expect(text).toContain("exactly one");
    expect(text).toContain("no default");
    expect(text).toContain("`kolu create --toplevel`");
  });

  it("refuses a create that carries no flags but an argv — the agent-loop shape", () => {
    expect(refusalOf({ argv: ["claude"] })).toContain("--toplevel");
  });

  it("refuses BOTH flags at once, naming the exclusion rather than picking one", () => {
    const text = refusalOf({ toplevel: true, parent: "3f9c" });
    expect(text).toContain("--toplevel and --parent are mutually exclusive");
    expect(text).toContain("Pass exactly one");
    expect(text).not.toMatch(/takes precedence|is ignored|wins/);
  });

  it("accepts exactly one — neither spelling is refused at the gate", () => {
    for (const over of [{ toplevel: true }, { parent: "3f9c" }] as const) {
      const exit = Effect.runSyncExit(
        run({ kind: "auto" }, { ...NOTHING, ...over }),
      );
      const text = Exit.isFailure(exit)
        ? ((Cause.squash(exit.cause) as { readonly stderr?: string }).stderr ??
          "")
        : "";
      expect(text).not.toContain("--toplevel");
      expect(text).not.toContain("mutually exclusive");
    }
  });
});
