/** One framework policy for diagnostic progress retained in memory and surfaced
 * after a failed remote operation. A bounded tail keeps a noisy Nix subprocess
 * from growing the long-lived server heap without hiding its latest evidence. */
export const MAX_PROGRESS_LINES = 20;
