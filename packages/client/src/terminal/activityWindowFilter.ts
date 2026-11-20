import { activeScope } from "../hostScope/hostScopes";
import {
  type ActivityWindow,
  DEFAULT_ACTIVITY_WINDOW,
  windowOption,
} from "./activityWindow";

export function activityWindow(): ActivityWindow {
  return activeScope()?.prefs.activityWindow() ?? DEFAULT_ACTIVITY_WINDOW;
}

export function setActivityWindow(next: ActivityWindow): void {
  activeScope()?.prefs.setActivityWindow(next);
}

export function activityWindowThresholdMs(): number | null {
  return windowOption(activityWindow()).thresholdMs;
}
