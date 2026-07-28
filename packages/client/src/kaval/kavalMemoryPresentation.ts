/** The one user-facing explanation for a surviving kaval whose pid gate
 * predates this build. The state is a refusal, not a compatibility parser: a
 * restart replaces the daemon and restores a current-format identity. */
export const KAVAL_GATE_FORMAT_UNSUPPORTED_MESSAGE =
  "running kaval predates this build — restart kaval to restore memory readout";
