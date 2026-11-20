import Dialog from "@corvu/dialog";
import type { PwaInstall } from "@kolu/solid-pwa-install";
import type { Component } from "solid-js";
import { createDisclosure } from "./ui/createDisclosure";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import WelcomeMoments from "./WelcomeMoments";

const chrome = surface({ portalled: true });

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
    <Dialog.Content
      data-testid="welcome-dialog"
      class={`${chrome.class} p-6`}
      style={chrome.style}
    >
      <div class="flex items-center gap-2 mb-1">
        <img src="/favicon.svg" alt="kolu" class="w-6 h-6" />
        <Dialog.Label class="text-base font-semibold text-fg">
          Welcome to kolu
        </Dialog.Label>
      </div>
      <p class="text-xs text-fg-3 mb-4">Three things worth doing first.</p>
      <WelcomeMoments
        install={props.install}
        onBeforeOpenPalette={() => welcomeDialog.onOpenChange(false)}
      />
    </Dialog.Content>
  </ModalDialog>
);

export default WelcomeDialog;
