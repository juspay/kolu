/** Comment-tray state — singleton, keyed by worktree repoRoot, persisted via
 *  `makePersisted` (localStorage) so an accidental reload doesn't lose
 *  in-progress feedback. Each repoRoot gets its own bucket: switching the
 *  active terminal to a different worktree shows that worktree's tray, not
 *  a global pile.
 *
 *  Module-singleton cache mirrors `useRightPanel` shape — first call per
 *  repoRoot creates the persisted signal; later calls reuse it. Without
 *  the cache, each consumer would mint a fresh signal with the same
 *  localStorage key and their writes would race.
 *
 *  The global comment-mode toggle lives in `./useCommentMode.ts` — that's
 *  a session-wide UI preference, not per-worktree content. */

import { makePersisted } from "@solid-primitives/storage";
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  type Setter,
} from "solid-js";
import { toast } from "solid-sonner";
import type { Comment } from "./commentSerialize";

type Bucket = {
  comments: Accessor<readonly Comment[]>;
  setComments: Setter<readonly Comment[]>;
};

const buckets = new Map<string, Bucket>();

/** Persisted envelope for a per-worktree bucket. Wrapping the raw
 *  `Comment[]` in `{ v: 1, comments }` lets future field renames bump
 *  the version with an explicit migration step instead of silently
 *  corrupting existing buckets. The clipboard payload in
 *  `commentSerialize.ts` already carries a `[kolu comments v1]`
 *  header — this mirrors that discipline at the persistence layer. */
type PersistedBucketV1 = { v: 1; comments: Comment[] };

function serializeBucket(comments: readonly Comment[]): string {
  const envelope: PersistedBucketV1 = { v: 1, comments: [...comments] };
  return JSON.stringify(envelope);
}

function deserializeBucket(raw: string, repoRoot: string): Comment[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const env = parsed as { v?: unknown; comments?: unknown };
      if (env.v === 1 && Array.isArray(env.comments)) {
        return env.comments as Comment[];
      }
    }
    // Legacy bare-array shape from earlier local builds before the
    // envelope landed. Tolerated on read so existing users don't lose
    // their queue on the upgrade; writes always emit the envelope.
    if (Array.isArray(parsed)) return parsed as Comment[];
    // Shape we don't recognize — surface so the user can tell "fresh
    // worktree" apart from "the bucket on disk got into a state we
    // can't read", and decide whether to clear it manually.
    toast.error(
      `Comments bucket for ${repoRoot} has an unrecognized shape — starting empty. Inspect localStorage key "kolu-comments:${repoRoot}" if this is unexpected.`,
    );
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(
      `Could not parse persisted comments for ${repoRoot}: ${message}. Starting with an empty tray.`,
    );
    return [];
  }
}

function bucket(repoRoot: string): Bucket {
  const cached = buckets.get(repoRoot);
  if (cached) return cached;
  const [comments, setComments] = makePersisted(
    createSignal<readonly Comment[]>([]),
    {
      name: `kolu-comments:${repoRoot}`,
      serialize: serializeBucket,
      deserialize: (raw) => deserializeBucket(raw, repoRoot),
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

/** Sweep the in-memory bucket for `repoRoot` if (a) it carries no
 *  queued comments and (b) it differs from the currently-active one.
 *  The persisted localStorage entry stays put — a future visit to the
 *  same repoRoot will rehydrate from there. We're only freeing the
 *  process-resident `Map` entry so a long-running session that touches
 *  many distinct worktrees doesn't grow unbounded. */
function sweepIfEmpty(repoRoot: string, current: string | null): void {
  if (repoRoot === current) return;
  const b = buckets.get(repoRoot);
  if (b && b.comments().length === 0) buckets.delete(repoRoot);
}

export function useComments(repoRoot: Accessor<string | null>): CommentsApi {
  // Reactive bucket selection — when the active terminal moves to a
  // different worktree, the accessors below transparently switch. We
  // additionally sweep the previous bucket's in-memory entry if empty,
  // so a session that walks N worktrees doesn't leave N entries behind
  // in the singleton Map.
  let prev: string | null = null;
  createEffect(() => {
    const r = repoRoot();
    if (prev !== null && prev !== r) sweepIfEmpty(prev, r);
    prev = r;
  });
  onCleanup(() => {
    if (prev !== null) sweepIfEmpty(prev, null);
    prev = null;
  });

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
