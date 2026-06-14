/** The "About kolu" modal — server identity, repo link, shell commit, and the
 *  live server process id. Opened from the "About kolu" palette command; owns
 *  its open-state so App.tsx only mounts it. */

import Dialog from "@corvu/dialog";
import { shellCommit } from "@kolu/surface-app/lifecycle";
import type { Component } from "solid-js";
import { serverProcessId } from "./rpc/rpc";
import Commit from "./ui/Commit";
import { createDisclosure } from "./ui/createDisclosure";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import { useServerIdentity } from "./useServerIdentity";

/** About-dialog open-state — the component owns it. */
export const aboutDialog = createDisclosure();

const chrome = surface({ portalled: true });

const AboutDialog: Component = () => {
  const { appTitle } = useServerIdentity();
  return (
    <ModalDialog
      open={aboutDialog.open()}
      onOpenChange={aboutDialog.onOpenChange}
      refocusOnClose
      size="sm"
    >
      <Dialog.Content
        class={`${chrome.class} p-6 text-sm`}
        style={chrome.style}
      >
        <div class="flex items-center gap-2 mb-3">
          <img src="/favicon.svg" alt="kolu" class="w-6 h-6" />
          <span class="font-semibold text-fg">{appTitle()}</span>
        </div>
        <div class="space-y-1 text-fg-3">
          <p>
            <a
              href="https://github.com/juspay/kolu"
              target="_blank"
              rel="noopener noreferrer"
              class="text-accent hover:underline"
            >
              github.com/juspay/kolu
            </a>
          </p>
          <p>
            Commit:{" "}
            <Commit sha={shellCommit()} class="text-accent hover:underline" />
          </p>
          <p>
            Server:{" "}
            <span class="font-mono text-fg-2">{serverProcessId() ?? "—"}</span>
          </p>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default AboutDialog;
