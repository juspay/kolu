/**
 * `kolu create`'s blank-flag gate, pinned through the verb's OWN entry point.
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

/** A create with nothing set — the fixture each case varies ONE flag of. */
const NOTHING: CreateArgs = {
  argv: [],
  cwd: undefined,
  parent: undefined,
  intent: undefined,
  repo: undefined,
  worktree: undefined,
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
