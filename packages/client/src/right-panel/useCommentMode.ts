/** Comment-mode toggle — session-wide persisted boolean. Separate from
 *  `useComments` because the toggle is global while comment buckets are
 *  per-worktree. */

import { makePersisted } from "@solid-primitives/storage";
import { type Accessor, createSignal } from "solid-js";

const [commentMode, setCommentMode] = makePersisted(createSignal(false), {
  name: "kolu-comment-mode",
  serialize: (v) => (v ? "1" : "0"),
  deserialize: (raw) => raw === "1",
});

export const commentModeEnabled: Accessor<boolean> = commentMode;

export function disableCommentMode(): void {
  setCommentMode(false);
}

export function toggleCommentMode(): void {
  setCommentMode((v) => !v);
}
