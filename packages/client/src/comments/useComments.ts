/** Comments store — singleton, persisted to localStorage, keyed by
 *  {@link CommentQueue}: a terminal's own queue, or a piece of work's.
 *
 *  INVARIANT: keyed by WHOSE comments they are (NOT by git repoRoot). A
 *  terminal's Code tab files in that terminal's queue; a work's reader and
 *  Code view file in the work's. Two terminals in the same repo do NOT share
 *  comments — they're typically working on different feature branches with
 *  different review contexts, and merging their queues would conflate
 *  unrelated drafts — and a work's comments do not depend on which member
 *  terminal stands in its folder, or on any being up at all.
 *
 *  Stored shape: `{v: 1, comments: Comment[]}`. The `v` bump path lets
 *  future schema changes ship a migration without breaking existing
 *  installs; today we just read/write v1.
 *
 *  No flush logic lives here. `formatMarkdown` is a separate pure
 *  function; the tray's "Copy to clipboard" calls it directly. */

import { type Accessor, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { persistedPref } from "../persistedPref";
import { backfillSurface } from "./backfillSurface";
import type { Comment, CommentQueue, PersistedShape } from "./types";

/** The localStorage name of a queue. A terminal's is the name it always had,
 *  so every comment already written stays where it is. */
export function commentStorageName(queue: CommentQueue): string {
  switch (queue.kind) {
    case "terminal":
      return `kolu:comments-by-terminal:${queue.id}`;
    case "work":
      return `kolu:comments-by-work:${queue.id}`;
    default:
      return queue satisfies never;
  }
}

type StoresByKey = Map<
  string,
  {
    comments: () => Comment[];
    setComments: (next: Comment[] | ((prev: Comment[]) => Comment[])) => void;
  }
>;

const storesByKey: StoresByKey = new Map();

/** Get or lazily create the persisted store for a queue. The store is a
 *  singleton per queue so multiple call sites share one reactive source. */
function storeFor(queue: CommentQueue) {
  const name = commentStorageName(queue);
  const existing = storesByKey.get(name);
  if (existing) return existing;
  const [signal, setSignal] = persistedPref<PersistedShape>({
    name,
    fallback: { v: 1, comments: [] },
    serialize: (v) => JSON.stringify(v),
    parse: (raw): PersistedShape => {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.comments)) {
        return { v: 1, comments: backfillSurface(parsed.comments) };
      }
      throw new Error("unexpected comments shape");
    },
    // Surface the loss either way — a wiped queue must not be silently
    // indistinguishable from a fresh install.
    onInvalid: (err) => {
      if (err instanceof SyntaxError) {
        console.error(
          `[comments] Failed to parse stored data for ${name}:`,
          err,
        );
        toast.error(
          `Failed to load comments: ${err.message ?? "parse error"}. Queue reset.`,
        );
      } else {
        console.error(
          `[comments] Stored data for ${name} has unexpected shape; resetting queue`,
          err,
        );
        toast.error(
          `Comments for this repo had an unexpected shape and were reset. Check the console.`,
        );
      }
    },
  });
  const wrapped = {
    comments: () => signal().comments,
    setComments: (next: Comment[] | ((prev: Comment[]) => Comment[])): void => {
      setSignal((prev) => ({
        v: 1,
        comments: typeof next === "function" ? next(prev.comments) : next,
      }));
    },
  };
  storesByKey.set(name, wrapped);
  return wrapped;
}

/** API the rest of the client uses. Pass the queue at the consumer site —
 *  there's no global ambient context. */
export function useComments(queue: CommentQueue) {
  const store = storeFor(queue);
  return {
    comments: store.comments,
    commentsForPath: (path: string): Comment[] =>
      store.comments().filter((c) => c.path === path),
    add: (c: Omit<Comment, "id" | "createdAt">): Comment => {
      const full: Comment = {
        ...c,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      };
      store.setComments((prev) => [...prev, full]);
      return full;
    },
    remove: (id: string): void => {
      store.setComments((prev) => prev.filter((c) => c.id !== id));
    },
    clear: (): void => {
      store.setComments([]);
    },
  };
}

type Comments = ReturnType<typeof useComments>;

/** A queue's comments API as a DERIVATION of the queue: the store is created
 *  (or re-used from the module map) by `useComments` for whatever queue is
 *  current, and the memo owns that creation — its persisted signal's cleanup
 *  binds to this scope and is released when the queue changes or the caller
 *  is disposed. A queue that may be none (a kept file has nothing to anchor a
 *  comment to) reads as none. */
export function commentsFor(queue: Accessor<CommentQueue>): () => Comments;
export function commentsFor(
  queue: Accessor<CommentQueue | null>,
): () => Comments | null;
export function commentsFor(
  queue: Accessor<CommentQueue | null>,
): () => Comments | null {
  return createMemo(
    () => {
      const one = queue();
      return one === null ? null : useComments(one);
    },
    { name: "commentsFor" },
  );
}
