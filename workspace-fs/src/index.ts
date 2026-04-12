// workspace-fs: file indexing, search, and watching for git workspaces.
// Schemas are re-exported from kolu-common for client consumption.

export {
  FileGitStatusSchema,
  FileEntrySchema,
  FsSearchResultSchema,
  FsSearchInputSchema,
  FsListDirInputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  FsWatchInputSchema,
  FsChangeEventSchema,
  FsFileDiffInputSchema,
  FsFileDiffOutputSchema,
  DiffLineSchema,
  DiffHunkSchema,
} from "./schemas.ts";

export type {
  FileGitStatus,
  FileEntry,
  FsSearchResult,
  FsSearchInput,
  FsListDirInput,
  FsReadFileInput,
  FsReadFileOutput,
  FsChangeEvent,
  FsFileDiffInput,
  FsFileDiffOutput,
  DiffLine,
  DiffHunk,
} from "./schemas.ts";

export { fuzzyScore, type FuzzyResult } from "./scorer.ts";
export { WorkspaceFsService } from "./service.ts";
