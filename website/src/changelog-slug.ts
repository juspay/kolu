/**
 * The anchor a changelog entry answers to.
 *
 * One rule, shared by the entry that mints the id (`<Change>`) and the
 * highlights block that links to it — a second, hand-rolled rule beside this
 * one would drift on an em dash or a backtick and link to nothing.
 */
export const changelogEntrySlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
