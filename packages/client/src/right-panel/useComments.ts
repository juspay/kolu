/** Comment-tray state — singleton, keyed by worktree repoRoot, persisted via
 *  `makePersisted` (localStorage) so an accidental reload doesn't lose
 *  in-progress feedback. Each repoRoot gets its own bucket: switching the
 *  active terminal to a different worktree shows that worktree's tray, not
 *  a global pile.
 *
 *  Module-singleton cache mirrors `useRightPanel` shape — first call per
 *  repoRoot creates the persisted signal; later calls reuse it. Without
 *  the cache, each consumer would mint a fresh signal with the same
 *  localStorage key and their writes would race. */

import { makePersisted } from "@solid-primitives/storage";
import { type Accessor, createSignal, type Setter } from "solid-js";
import type { Comment } from "./commentSerialize";

// Comment-mode toggle — module-level singleton so it survives CodeTab
// remounts (right-panel collapse → expand). Persisted across reloads so a
// user who reloads mid-review doesn't have to re-toggle just to keep
// adding to their existing tray.
const [commentMode, setCommentMode] = makePersisted(createSignal(false), {
  name: "kolu-comment-mode",
  serialize: (v) => (v ? "1" : "0"),
  deserialize: (raw) => raw === "1",
});

export const commentModeEnabled: Accessor<boolean> = commentMode;
export function setCommentMode_(value: boolean): void {
  setCommentMode(value);
}
export function toggleCommentMode(): void {
  setCommentMode((v) => !v);
}

type Bucket = {
  comments: Accessor<readonly Comment[]>;
  setComments: Setter<readonly Comment[]>;
};

const buckets = new Map<string, Bucket>();

function bucket(repoRoot: string): Bucket {
  const cached = buckets.get(repoRoot);
  if (cached) return cached;
  const [comments, setComments] = makePersisted(
    createSignal<readonly Comment[]>([]),
    {
      name: `kolu-comments:${repoRoot}`,
      serialize: (v) => JSON.stringify(v),
      deserialize: (raw) => {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? (parsed as Comment[]) : [];
        } catch {
          return [];
        }
      },
    },
  );
  const b = { comments, setComments } satisfies Bucket;
  buckets.set(repoRoot, b);
  return b;
}

let counter = 0;
function mintId(): string {
  counter += 1;
  return `c${Date.now().toString(36)}-${counter.toString(36)}`;
}

export type CommentInput = {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
};

export type CommentsApi = {
  comments: Accessor<readonly Comment[]>;
  addComment: (input: CommentInput) => void;
  removeComment: (id: string) => void;
  clear: () => void;
};

export function useComments(repoRoot: Accessor<string | null>): CommentsApi {
  // Reactive bucket selection — when the active terminal moves to a
  // different worktree, the accessors below transparently switch.
  const empty: readonly Comment[] = [];
  const list: Accessor<readonly Comment[]> = () => {
    const r = repoRoot();
    return r ? bucket(r).comments() : empty;
  };
  return {
    comments: list,
    addComment: (input) => {
      const r = repoRoot();
      if (!r) return;
      const b = bucket(r);
      b.setComments((prev) => [
        ...prev,
        { id: mintId(), createdAt: Date.now(), ...input },
      ]);
    },
    removeComment: (id) => {
      const r = repoRoot();
      if (!r) return;
      const b = bucket(r);
      b.setComments((prev) => prev.filter((c) => c.id !== id));
    },
    clear: () => {
      const r = repoRoot();
      if (!r) return;
      bucket(r).setComments([]);
    },
  };
}
