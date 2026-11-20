function placementRequiredMessage(command: string): string {
  return `${command} must state WHERE the terminal goes — pass exactly one of --toplevel (a tile of its own) or --parent <id> (a split inside that terminal). There is no default: the canvas and the Dock read a terminal's parent as who-works-for-whom, so a guessed placement silently flattens the hierarchy. A script that used to say \`${command}\` means \`${command} --toplevel\`.`;
}

const PLACEMENT_FLAGS_EXCLUSIVE =
  "--toplevel and --parent are mutually exclusive: a terminal is either a tile of its own or a split inside exactly one parent, never both. Pass exactly one.";

const PLACEMENT_PARENT_BLANK =
  "--parent was passed with an empty value — an unset shell variable, most likely. It names the terminal to split, and an empty string is not an id: pass the parent's id (any unique prefix), or use --toplevel if you meant a tile of its own.";

/** A flag the user SPELLED but left EMPTY — `--parent "$ID"` with `$ID` unset.
 *  Different from a flag not passed at all. */
export const isBlank = (value: string): boolean => value.trim() === "";

/** WHERE ON THE CANVAS a create lands, as the CLI flags spell it. */
export type StatedPlacementFlags =
  | { readonly kind: "toplevel" }
  | { readonly kind: "child-of"; readonly parentQuery: string };

/** …and the third arm: what the parse returns when the pair is not a
 *  statement, carrying the message the face prints verbatim. */
export type PlacementFlagsRead =
  | StatedPlacementFlags
  | { readonly kind: "refused"; readonly message: string };

/** Read the `--toplevel` / `--parent` pair down to the one thing it means.
 *  Exactly one must be stated: there is no default placement, and the same
 *  refusal wording is owed to every face that spells these flags. */
export function parsePlacementFlags(
  command: string,
  flags: { readonly toplevel: boolean; readonly parent: string | undefined },
): PlacementFlagsRead {
  const { toplevel, parent } = flags;
  if (toplevel && parent !== undefined)
    return { kind: "refused", message: PLACEMENT_FLAGS_EXCLUSIVE };
  if (toplevel) return { kind: "toplevel" };
  if (parent !== undefined) {
    return isBlank(parent)
      ? { kind: "refused", message: PLACEMENT_PARENT_BLANK }
      : { kind: "child-of", parentQuery: parent };
  }
  return { kind: "refused", message: placementRequiredMessage(command) };
}
