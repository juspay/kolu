// workspace-fs: file indexing, search, and watching for git workspaces.
// Schemas are re-exported from kolu-common for client consumption.

export {
  FileGitStatusSchema,
  FileStagingSchema,
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
  BlameLineSchema,
  FsBlameInputSchema,
  FsBlameOutputSchema,
  FsStageInputSchema,
} from "./schemas.ts";

export type {
  FileGitStatus,
  FileStaging,
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
  BlameLine,
  FsBlameInput,
  FsBlameOutput,
  FsStageInput,
} from "./schemas.ts";

export { fuzzyScore, type FuzzyResult } from "./scorer.ts";
export { WorkspaceFsService } from "./service.ts";
