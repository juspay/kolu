/** The set of export modes a transcript can render in — the single
 *  receptacle every consumer plugs into.
 *
 *  This lives in the low transcript-core layer (not the renderer or
 *  kolu-common) because both the renderer (`kolu-transcript-html`) and the
 *  RPC contract (`kolu-common`) depend on it and must agree on one value
 *  set. kolu-common derives its zod schema via `z.enum(TRANSCRIPT_HTML_MODES)`
 *  and the renderer imports `TranscriptHtmlMode` from here; adding a mode is
 *  one edit that forces a compile error at every consumer. */

/** Canonical list of export modes. `chat` is the lightweight conversation
 *  document; `full` adds collapsed tool/reasoning audit details. */
export const TRANSCRIPT_HTML_MODES = ["chat", "full"] as const;

export type TranscriptHtmlMode = (typeof TRANSCRIPT_HTML_MODES)[number];
