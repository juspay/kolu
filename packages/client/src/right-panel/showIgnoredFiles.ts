/** Device-local "show gitignored files" toggle for the Code tab's browse tree.
 *
 *  A DISPLAY preference, not workspace state — same category as the persisted
 *  tree/split sizes — so it lives in `localStorage` via `boolPref` rather than
 *  the server-persisted per-terminal right-panel record. Module-level because
 *  two parallel owners read it: `hostCodeTab`'s retained `fs.listAll` query
 *  input (the flag participates in the query's value key, so a flip re-queries
 *  and the ignored overlay appears/disappears atomically with the file list)
 *  and the Code-tab toolbar button that flips it. */

import { boolPref } from "../persistedPref";

export const [showIgnoredFiles, setShowIgnoredFiles] = boolPref({
  name: "kolu-code-tab-show-ignored",
  fallback: false,
});
