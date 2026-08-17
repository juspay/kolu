/**
 * `kolu create`'s PURE gates — blank flags, and the placement pair — pinned
 * through the verb's OWN entry point.
 *
 * Driving `run` rather than the (unexported) gate function is the point: what
 * must stay true is not that a predicate exists but that it fires BEFORE the
 * dial. `Effect.runSyncExit` is the assertion — the gate is pure, so a refusal
 * that still lands synchronously here is a refusal that reached the user without
 * a socket, and without `--host` having Nix-provisioned a cold box first.
 *
 * The rule itself (`isBlank`, whitespace included) is `exit.ts`'s, shared with
 * `endpointOf`'s blank-endpoint refusal; this pins the flags `create` runs it
 * over, each of which used to reach the wire as a nonsense name (`--worktree ""`
 * → a worktree called `""`) or an explicit empty cwd.
 */

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { type CreateArgs, run } from "./create.ts";

/** A create with nothing set — the fixture each case varies ONE flag of.
 *
 *  `toplevel: false` with `parent: undefined` is the literal `kolu create` a user
 *  types with no flags: since the placement rule landed, that is itself a refusal
 *  (see the third describe below), which is why the blank-flag cases must and do
 *  hit the BLANK gate first — `run` checks blankness before it reads any flag for
 *  meaning. */
const NOTHING: CreateArgs = {
  argv: [],
  cwd: undefined,
  toplevel: false,
  parent: undefined,
  intent: undefined,
  repo: undefined,
  worktree: undefined,
  message: undefined,
  json: false,
};

/** The refusal text of a create that must not succeed — a NAMED throw if it
 *  did, never a silent `undefined` the assertions would vacuously pass
 *  against. */
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
    // `--worktree " "` is `--worktree "$NAME"` with `$NAME` set to a space; the
    // shared `isBlank` rule says both are unset, so the two cannot diverge.
    expect(refusalOf({ worktree: " " })).toContain("--worktree");
  });
});

describe("kolu create refuses to guess a placement", () => {
  // The gate this file's harness was built for: PURE, so `runSyncExit` catching
  // the refusal is proof it landed without a socket — and, for `--host`, without
  // Nix having provisioned a cold box for a command that was never going to run.

  it("refuses a bare create, naming BOTH flags and the rule", () => {
    // `kolu create` with no flags at all. This USED to be a legal, silent
    // top-level create; it is the exact call that flattened a fleet of reviewer
    // agents onto the canvas for two days without anything failing.
    const text = refusalOf({});
    expect(text).toContain("--toplevel");
    expect(text).toContain("--parent");
    expect(text).toContain("exactly one");
    // The rule, not just the flags — a caller who did not know there was a
    // decision to make needs to learn WHY, or they will pick one at random.
    expect(text).toContain("no default");
    // …and the migration, in the one word it costs a script.
    expect(text).toContain("`kolu create --toplevel`");
  });

  it("refuses a create that carries no flags but an argv — the agent-loop shape", () => {
    // `kolu create -- claude` is what a driving loop actually types, and the
    // argv must not buy it an exemption: the terminal still lands somewhere.
    expect(refusalOf({ argv: ["claude"] })).toContain("--toplevel");
  });

  it("refuses BOTH flags at once, naming the exclusion rather than picking one", () => {
    const text = refusalOf({ toplevel: true, parent: "3f9c" });
    expect(text).toContain("--toplevel and --parent are mutually exclusive");
    expect(text).toContain("Pass exactly one");
    // A precedence winner would BE the silent decision this pair deletes, so
    // neither flag may be described as the one that wins.
    expect(text).not.toMatch(/takes precedence|is ignored|wins/);
  });

  it("accepts exactly one — neither spelling is refused at the gate", () => {
    // The gate is pure and the dial is not, so a create that PASSES it cannot be
    // driven to completion by `runSyncExit`. What is provable here is the
    // negative that matters: whatever failure follows is not this gate's. Both
    // spellings are driven end-to-end against a live padi in the PR's evidence.
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
