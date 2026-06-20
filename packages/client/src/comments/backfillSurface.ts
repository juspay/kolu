/** One-time load migration for the comments queue: backfill `surface` on
 *  surface-less comments that belong to a multi-surface file.
 *
 *  Kept a pure leaf (no Solid/DOM deps) so the store can run it on parse and
 *  a unit test can exercise it in isolation — mirrors `formatMarkdown.ts`.
 *
 *  `surface` arrived with #1162 (the rendered-Markdown comment surface). A
 *  Markdown comment persisted BEFORE that PR carries no `surface`, but the
 *  only commentable Markdown surface back then was the source view, so it was
 *  made there. The overlay now keeps both Source ⇄ Rendered surfaces mounted
 *  and filters each by EXACT surface match (`CommentTextSurface`) — so a
 *  surface-less entry on a Markdown path would match neither overlay and
 *  silently lose its highlight and its tray jump. Pin those legacy entries to
 *  `"source"` at load so they keep an owning overlay.
 *
 *  Non-Markdown surface-less comments (plain source, diff, HTML-iframe) are
 *  single-surface and intentionally stay undefined — their lone overlay
 *  matches `undefined === undefined`, so we must not touch them. */

import { isMarkdown } from "kolu-common/preview";
import type { Comment } from "./types";

export function backfillSurface(comments: Comment[]): Comment[] {
  return comments.map((c) =>
    c.surface === undefined && isMarkdown(c.path)
      ? { ...c, surface: "source" as const }
      : c,
  );
}
