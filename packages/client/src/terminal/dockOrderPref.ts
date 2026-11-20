import { activeScope } from "../hostScope/hostScopes";
import type { DockOrder } from "./dockOrder";

export function dockOrder(): DockOrder {
  return activeScope()?.prefs.dockOrder() ?? [];
}

export function setDockOrder(next: DockOrder): void {
  activeScope()?.prefs.setDockOrder(next);
}
