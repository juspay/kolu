/**
 * Zod schemas for workspace filesystem types.
 * Consumed by kolu-common for re-export and contract definition.
 */

import { z } from "zod";

/** Git status of a tracked or untracked file. */
export const FileGitStatusSchema = z.enum([
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
]);

/** A single file or directory entry with optional git status. */
export const FileEntrySchema = z.object({
  /** Path relative to the workspace root. */
  path: z.string(),
  /** Basename of the file or directory. */
  name: z.string(),
  kind: z.enum(["file", "directory"]),
  /** Git status, or null if clean/untracked-directory. */
  gitStatus: FileGitStatusSchema.nullable(),
});

/** A ranked search result with match positions for highlighting. */
export const FsSearchResultSchema = z.object({
  path: z.string(),
  name: z.string(),
  gitStatus: FileGitStatusSchema.nullable(),
  /** Fuzzy match score — higher is better. */
  score: z.number(),
  /** Character indices in `path` that matched the query. */
  matches: z.array(z.number()),
});

/** Input for file search. */
export const FsSearchInputSchema = z.object({
  root: z.string(),
  query: z.string(),
  limit: z.number().int().positive().optional(),
});

/** Input for directory listing. */
export const FsListDirInputSchema = z.object({
  root: z.string(),
  /** Directory path relative to root. Empty string = root itself. */
  dirPath: z.string(),
});

/** Input for reading file contents. */
export const FsReadFileInputSchema = z.object({
  root: z.string(),
  /** File path relative to root. */
  filePath: z.string(),
});

/** Output for file read — content + metadata. */
export const FsReadFileOutputSchema = z.object({
  content: z.string(),
  /** Number of lines in the file. */
  lineCount: z.number(),
  /** File size in bytes. */
  byteLength: z.number(),
  /** Whether the content was truncated (file > 1MB). */
  truncated: z.boolean(),
});

/** Input for file diff. */
export const FsFileDiffInputSchema = z.object({
  root: z.string(),
  filePath: z.string(),
});

/** A single line in a diff hunk. */
export const DiffLineSchema = z.object({
  kind: z.enum(["context", "add", "remove"]),
  content: z.string(),
  /** Line number in the new file (null for removed lines). */
  newLine: z.number().nullable(),
  /** Line number in the old file (null for added lines). */
  oldLine: z.number().nullable(),
});

/** A diff hunk with header and lines. */
export const DiffHunkSchema = z.object({
  oldStart: z.number(),
  oldCount: z.number(),
  newStart: z.number(),
  newCount: z.number(),
  lines: z.array(DiffLineSchema),
});

/** Output for file diff — parsed unified diff. */
export const FsFileDiffOutputSchema = z.object({
  hunks: z.array(DiffHunkSchema),
  /** Set of new-file line numbers that are additions. */
  addedLines: z.array(z.number()),
  /** Set of new-file line numbers that have modifications (changed from old). */
  modifiedLines: z.array(z.number()),
  /** Line numbers in new file right after a deletion (gutter marker position). */
  deletedAfterLines: z.array(z.number()),
});

/** Input for watching a workspace root. */
export const FsWatchInputSchema = z.object({
  root: z.string(),
});

/** Lightweight change notification — client re-fetches on demand. */
export const FsChangeEventSchema = z.object({
  /** Timestamp of the change batch. */
  updatedAt: z.number(),
});

// Derived types
export type FileGitStatus = z.infer<typeof FileGitStatusSchema>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
export type FsSearchResult = z.infer<typeof FsSearchResultSchema>;
export type FsSearchInput = z.infer<typeof FsSearchInputSchema>;
export type FsListDirInput = z.infer<typeof FsListDirInputSchema>;
export type FsReadFileInput = z.infer<typeof FsReadFileInputSchema>;
export type FsReadFileOutput = z.infer<typeof FsReadFileOutputSchema>;
export type FsChangeEvent = z.infer<typeof FsChangeEventSchema>;
export type FsFileDiffInput = z.infer<typeof FsFileDiffInputSchema>;
export type FsFileDiffOutput = z.infer<typeof FsFileDiffOutputSchema>;
export type DiffLine = z.infer<typeof DiffLineSchema>;
export type DiffHunk = z.infer<typeof DiffHunkSchema>;
