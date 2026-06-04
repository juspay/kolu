/** Domain types for the comments feature. The `Locator` shape is owned
 *  by `@kolu/artifact-sdk` (same on the wire iframe ↔ parent and at rest
 *  in localStorage) — re-exported here so consumers import one place. */

import type { Locator } from "@kolu/artifact-sdk/client";

export type { Locator };

export type Comment = {
  id: string;
  /** Repo-relative path. The path is what the agent receiving the
   *  clipboard payload uses to locate the file; combined with the
   *  locator's quote, it's enough to re-anchor on the agent side. */
  path: string;
  locator: Locator;
  /** Line range captured at selection time — display hint for the tray
   *  and the destination of "jump to anchor" via `openInCodeTab`. The
   *  quote in `locator` is the durable anchor; this is the optimistic
   *  read of where the selection lived when it was made. Absent for
   *  HTML iframe comments and for older persisted entries. */
  lineRange?: { start: number; end: number };
  /** Which browse surface the comment was made on, when the file offers more
   *  than one. `"prose"` = the rendered Markdown preview (light DOM, no source
   *  line); `"source"` = Pierre's source view. Drives the tray jump to flip
   *  the Source ⇄ Rendered toggle back to the surface the quote lives in:
   *  a prose quote ("Hello Doc") needn't exist verbatim in source ("# Hello
   *  Doc"), so landing on the wrong surface would fail to re-find it. Absent
   *  for single-surface files (plain source, diff), HTML-iframe comments, and
   *  older persisted entries — the jump leaves the toggle untouched then. */
  surface?: "source" | "prose";
  body: string;
  createdAt: number;
};

/** Versioned persistence envelope — version lives on the storage shape
 *  (NOT on the clipboard payload, which is plain Markdown). Future schema
 *  changes bump `v` and ship a migration in `useComments.ts`. */
export type PersistedShape = { v: 1; comments: Comment[] };
