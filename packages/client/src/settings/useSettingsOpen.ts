import { createSignal } from "solid-js";
import { isDesktop } from "../useMobile";
import { setChromeDrawerOpen } from "../useChromeDrawer";

export const [settingsOpen, setSettingsOpen] = createSignal(false);

export function openSettings(): void {
  if (!isDesktop()) setChromeDrawerOpen(true);
  setSettingsOpen(true);
}
