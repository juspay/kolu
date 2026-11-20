import { Schema } from "effect";

/** `inherit` — copy the host's active terminal's theme; `shuffle` — auto-pick a
 *  distinct tint from the given family. `mode` is already resolved: the
 *  preference's `"auto"` never appears here (kolu-server folds it against the
 *  viewer's OS mode before pushing), and `"random"` means the whole catalogue. */
export const NewTerminalPolicySchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("inherit") }),
  Schema.Struct({
    kind: Schema.Literal("shuffle"),
    mode: Schema.Literals(["random", "dark", "light", "colourful"]),
  }),
]);

export type NewTerminalPolicy = typeof NewTerminalPolicySchema.Type;

/** The value padi resolves against in the window between its boot and the
 *  binder's first push, so a create in that window behaves as a create on a
 *  default install does. */
export const DEFAULT_NEW_TERMINAL_POLICY: NewTerminalPolicy = {
  kind: "shuffle",
  mode: "dark",
};

/** Structural equality of two policies. */
export function newTerminalPolicyEqual(
  a: NewTerminalPolicy,
  b: NewTerminalPolicy,
): boolean {
  return a.kind === "shuffle" && b.kind === "shuffle"
    ? a.mode === b.mode
    : a.kind === b.kind;
}
