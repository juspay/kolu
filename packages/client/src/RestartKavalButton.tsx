/**
 * RestartKavalButton — the one styled "Restart kaval" action.
 *
 * Both surfaces that offer the supervised recycle (the DegradedCanvas and the
 * KavalInfoDialog) render the SAME accent button calling `restartKaval()`; the
 * label + classes live here so a restyle touches one file. Each surface still
 * imports and owns the button — `restartKaval()` is called directly, no
 * prop-threading. The dialog passes `beforeRestart` to close itself first; the
 * canvas passes its e2e `testId`; either may override spacing via `class`.
 */

import type { Component } from "solid-js";
import { restartKaval } from "./useDaemonStatus";

const RestartKavalButton: Component<{
  /** Run before the restart fires — e.g. the dialog closing itself. */
  beforeRestart?: () => void;
  /** Spacing/override classes appended to the shared accent button styles. */
  class?: string;
  /** e2e hook (the degraded canvas resolves `degraded-restart`). */
  testId?: string;
}> = (props) => (
  <button
    type="button"
    data-testid={props.testId}
    onClick={() => {
      props.beforeRestart?.();
      void restartKaval();
    }}
    class={`rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-surface-1 transition-colors hover:bg-accent/90 ${props.class ?? ""}`}
  >
    Restart kaval
  </button>
);

export default RestartKavalButton;
