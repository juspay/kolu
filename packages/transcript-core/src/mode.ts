/** Canonical list of export modes. `chat` is the lightweight conversation
 *  document; `full` adds collapsed tool/reasoning audit details. */
export const TRANSCRIPT_HTML_MODES = ["chat", "full"] as const;

export type TranscriptHtmlMode = (typeof TRANSCRIPT_HTML_MODES)[number];

/** The one place "what we call each mode" lives. Read it everywhere a mode
 *  needs a human label — the renderer's meta line and document title, and the
 *  export success toast — so the strings can't drift across sites. */
export const MODE_LABEL: Record<TranscriptHtmlMode, string> = {
  chat: "Chat log",
  full: "Full transcript",
};
