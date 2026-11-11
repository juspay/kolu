/** The THIRD view axis: is the workspace showing the orchestrator?
 *
 *  Not an arm of `CanvasMode` — that is a connection/health partition, and
 *  whether a conversation is on screen has nothing to do with whether the host
 *  is reachable. Not an arm of `ViewPostureMode` either, though it borrows it:
 *  the posture (tiled vs maximized) stays exactly where the user left it
 *  underneath, which is what makes `Esc` a RETURN rather than a second choice to
 *  make. Orchestrator mode is its own boolean, layered over both.
 *
 *  PER DEVICE, not per host. The two per-host prefs beside it (`canvasMaximized`,
 *  the dock arrangement) describe a view OF a host's tiles; this one describes
 *  which of kolu's three faces this screen is showing, and a person who works in
 *  the chat does so on every host. It is a device-global `boolPref` — the
 *  `showIgnoredFiles` / `dockCardsWidth` idiom — so it costs no `Preferences`
 *  schema rung, which is the right weight for a view toggle nothing server-side
 *  reads. */

import { boolPref } from "../persistedPref";

const [orchestratorMode, setOrchestratorMode] = boolPref({
  name: "kolu-orchestrator-mode",
  fallback: false,
});

export { orchestratorMode };

export function enterOrchestratorMode(): void {
  setOrchestratorMode(true);
}

/** Leave the orchestrator — `Esc`, and the `canvas`/`maximized` segments. The
 *  posture underneath is untouched, so this lands on whichever of the two the
 *  user was in before. */
export function exitOrchestratorMode(): void {
  setOrchestratorMode(false);
}

export function toggleOrchestratorMode(): void {
  setOrchestratorMode((on) => !on);
}
