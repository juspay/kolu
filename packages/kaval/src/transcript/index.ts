/** The kaval transcript leaf — a per-PTY lossless on-disk history over
 *  `node:sqlite` (WAL) with checkpoint-replay reads. See `transcript.ts`. */

export type {
  ExportSegment,
  HistoryResult,
  SearchMatch,
  SearchResult,
  TranscriptStatus,
} from "./transcript.ts";
export { Transcript } from "./transcript.ts";
export {
  DEFAULT_RETENTION_BYTES,
  type HistoryPolicy,
  type MirrorView,
  type Row,
  type Seq,
} from "./types.ts";
