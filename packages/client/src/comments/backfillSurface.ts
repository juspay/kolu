import { isMarkdown } from "kolu-common/preview";
import type { Comment } from "./types";

export function backfillSurface(comments: Comment[]): Comment[] {
  return comments.map((c) =>
    c.surface === undefined && isMarkdown(c.path)
      ? { ...c, surface: "source" as const }
      : c,
  );
}
