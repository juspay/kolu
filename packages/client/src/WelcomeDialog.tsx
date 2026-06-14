/** The welcome, on demand. `EmptyState` shows the moments inline at zero
 *  terminals; this dialog re-summons the same content anytime via the palette
 *  "Tutorial" command — so the welcome is never lost once you're working. There
 *  is no "seen" state: zero terminals always shows it, opening a terminal is the
 *  dismissal, and this command is the explicit re-entry. */

import Dialog from "@corvu/dialog";
import type { PwaInstall } from "@kolu/solid-pwa-install";
import type { Component } from "solid-js";
import { createDisclosure } from "./ui/createDisclosure";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import WelcomeMoments from "./WelcomeMoments";

const chrome = surface({ portalled: true });

/** Welcome-dialog open-state — the component owns it. Re-summoned by the
 *  "Tutorial" palette command; zero terminals shows the same moments inline. */
export const welcomeDialog = createDisclosure();

const WelcomeDialog: Component<{
  install: PwaInstall;
}> = (props) => (
  <ModalDialog
    open={welcomeDialog.open()}
    onOpenChange={welcomeDialog.onOpenChange}
    refocusOnClose
    size="md"
  >
    <Dialog.Content class={`${chrome.class} p-6`} style={chrome.style}>
      <div class="flex items-center gap-2 mb-1">
        <img src="/favicon.svg" alt="kolu" class="w-6 h-6" />
        <Dialog.Label class="text-base font-semibold text-fg">
          Welcome to kolu
        </Dialog.Label>
      </div>
      <p class="text-xs text-fg-3 mb-4">Three things worth doing first.</p>
      <WelcomeMoments install={props.install} />
    </Dialog.Content>
  </ModalDialog>
);

export default WelcomeDialog;
