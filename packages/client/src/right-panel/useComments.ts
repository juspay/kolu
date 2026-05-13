/** Per-worktree comment buckets, persisted to localStorage. The
 *  module-level Map caches one signal per repoRoot so concurrent
 *  consumers share writes instead of racing through duplicate
 *  `makePersisted` instances at the same key. */

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

/** Versioned wrapper so future field renames bump `v` with an explicit
 *  migration step instead of silently corrupting existing buckets. */
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
  // No-op when no repoRoot is bound — the persisted bucket is keyed
  // by worktree, so writes outside a worktree have no target.
  const withBucket = (fn: (b: Bucket) => void): void => {
    const r = repoRoot();
    if (r) fn(bucket(r));
  };
  return {
    comments: list,
    addComment: (input) =>
      withBucket((b) =>
        b.setComments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), createdAt: Date.now(), ...input },
        ]),
      ),
    removeComment: (id) =>
      withBucket((b) =>
        b.setComments((prev) => prev.filter((c) => c.id !== id)),
      ),
    clear: () => withBucket((b) => b.setComments([])),
  };
}
