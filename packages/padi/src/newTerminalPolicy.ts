/**
 * `NewTerminalPolicy` — the RESOLVED answer to "what theme does a new terminal
 * get", pushed to padi by whichever kolu-server binds it.
 *
 * Only resolved facts cross the wire: the user's preferences (`newTerminalTheme`,
 * `shuffleBehavior`, `colorScheme`) plus the viewer's OS light/dark reading are
 * kolu-server's to hold and to fold, and `"auto"` is collapsed to a concrete
 * light/dark/colourful mode BEFORE it is sent. padi then owns the part only padi
 * can answer — which of ITS terminals is active, which tints are taken — so every
 * face that creates a terminal (browser, MCP, CLI) gets the same policy applied.
 *
 * ── Why this DATA-only vocabulary lives in `@kolu/padi`, not `kolu-common` ────
 * The cell it types is declared on `padiSurface`, IN `packages/padi/src/surface.ts`,
 * and the package seal forbids `@kolu/padi` importing `kolu-common` (the arrow
 * points `kolu-common → @kolu/padi`, never back). So the union that member
 * references must live in a module `@kolu/padi` can import — here, its own
 * browser-safe surface vocab, exactly as `./clientPolicy.ts` does.
 * `kolu-common/surface` RE-EXPORTS it so `koluSurface` and the kolu client reach
 * it through their usual door.
 *
 * The cell this types is MEMORY-ONLY by design: kolu-server re-derives and
 * re-pushes on every bind/reconnect, so padi persisting a copy would recreate
 * exactly the stale-preferences drift this change exists to kill (the same ruling
 * `stateStore.ts` makes when it says preferences never move here).
 */

import { z } from "zod";

/** `inherit` — copy the host's active terminal's theme; `shuffle` — auto-pick a
 *  distinct tint from the given family. `mode` is already resolved: the
 *  preference's `"auto"` never appears here (kolu-server folds it against the
 *  viewer's OS mode before pushing), and `"random"` means the whole catalogue. */
export const NewTerminalPolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inherit") }),
  z.object({
    kind: z.literal("shuffle"),
    mode: z.enum(["random", "dark", "light", "colourful"]),
  }),
]);

export type NewTerminalPolicy = z.infer<typeof NewTerminalPolicySchema>;

/** The value padi resolves against in the window between its boot and the
 *  binder's first push. It is the RESOLUTION of kolu's `DEFAULT_PREFERENCES`
 *  (`newTerminalTheme: "shuffle"` + `shuffleBehavior: "auto"` against the default
 *  `colorScheme: "dark"`), so a create in that window behaves as a create on a
 *  default install does. A kolu-common test pins that equality — it cannot live
 *  here, because the seal keeps `DEFAULT_PREFERENCES` out of this package. */
export const DEFAULT_NEW_TERMINAL_POLICY: NewTerminalPolicy = {
  kind: "shuffle",
  mode: "dark",
};

/** Structural equality — the ONE definition, shared by the cell's spec `equals`
 *  (padi's wire/bus dedup point) and by kolu-server's pusher, which skips a push
 *  that would rewrite a byte-identical fact (an ssh round trip per remote host,
 *  for every unrelated preferences write). Two tiny variants, so the comparison
 *  is spelled out rather than stringified. */
export function newTerminalPolicyEqual(
  a: NewTerminalPolicy,
  b: NewTerminalPolicy,
): boolean {
  return a.kind === "shuffle" && b.kind === "shuffle"
    ? a.mode === b.mode
    : a.kind === b.kind;
}
