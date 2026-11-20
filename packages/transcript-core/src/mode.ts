/** Canonical list of export modes. `chat` is the lightweight conversation
 *  document; `full` adds collapsed tool/reasoning audit details. */
export const TRANSCRIPT_HTML_MODES = ["chat", "full"] as const;

export type TranscriptHtmlMode = (typeof TRANSCRIPT_HTML_MODES)[number];

export const MODE_LABEL: Record<TranscriptHtmlMode, string> = {
  chat: "Chat log",
  full: "Full transcript",
};
