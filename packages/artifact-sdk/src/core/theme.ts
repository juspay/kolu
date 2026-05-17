/** Shared style tokens for the comments-on-files highlight. Imported by
 *  both the in-iframe SDK (`packages/artifact-sdk/src/iframe/index.ts`)
 *  and the parent-side overlay (`packages/client/src/comments/highlightOverlay.ts`).
 *
 *  The CSS Custom Highlight names differ across runtimes (different
 *  documents register their own highlight registries — the iframe is
 *  opaque-origin and shares nothing with the parent), but the colors
 *  must stay identical so a comment looks the same regardless of
 *  surface. Without this shared module the values silently drift. */

export const COMMENT_HIGHLIGHT_BACKGROUND = "#fff5e4";
export const COMMENT_HIGHLIGHT_UNDERLINE = "#b8431e";

/** CSS body for `::highlight(<name>) { ... }` — caller composes the
 *  `::highlight(<name>) { ${COMMENT_HIGHLIGHT_STYLE} }` rule with
 *  whatever local name the runtime uses. */
export const COMMENT_HIGHLIGHT_STYLE = `background: ${COMMENT_HIGHLIGHT_BACKGROUND}; box-shadow: 0 1px 0 ${COMMENT_HIGHLIGHT_UNDERLINE};`;
