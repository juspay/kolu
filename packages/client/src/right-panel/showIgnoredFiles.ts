/** Device-local "show gitignored files" toggle for the Code tab's browse tree.
 *
 *  A DISPLAY preference, not workspace state — same category as the persisted
 *  tree/split sizes — so it lives in `localStorage` via `boolPref` rather than
 *  the server-persisted per-terminal right-panel record. Module-level because
 *  two parallel owners read it: `hostCodeTab`'s SEPARATE `fs.listIgnored`
 *  query input (idle while this is off) and the Code-tab toolbar button that
 *  flips it.
 *
 *  Deliberately NOT a field on `fs.listAll`'s input: a display preference in
 *  the main file-list query's value key blanks that query on every flip, which
 *  unmounts `<FileTree>` and remounts it collapsed — losing every hand-expanded
 *  folder and the scroll position. Pinned by `hostCodeTab.test.ts`. */

import { boolPref } from "../persistedPref";

export const [showIgnoredFiles, setShowIgnoredFiles] = boolPref({
  name: "kolu-code-tab-show-ignored",
  fallback: false,
});
