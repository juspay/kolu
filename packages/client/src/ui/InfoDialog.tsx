/** Shared chrome for the identity info dialogs (Kolu + Kaval). Both are compact
 *  panels a rail chip opens: a portalled surface with a top-right close, a
 *  logo/name/version header, and a body of {@link DetailRow}s. The two dialogs
 *  differ only in logo, name, version chip, description, size, and body — so the
 *  scaffold lives here once and each dialog supplies only its body. */

import Dialog from "@corvu/dialog";
import type { Component, JSX } from "solid-js";
import { CloseIcon } from "./Icons";
import ModalDialog from "./ModalDialog";
import { surface } from "./Surface";

const chrome = surface({ portalled: true, radius: "xl" });

/** A label/value row — fixed-width label column, truncating value. */
export const DetailRow: Component<{ label: string; children: JSX.Element }> = (
  props,
) => (
  <div class="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3 text-[11px] leading-5">
    <span class="text-fg-3">{props.label}</span>
    <span class="min-w-0 truncate text-fg-2">{props.children}</span>
  </div>
);

/** The bordered version pill shown next to a dialog's name. */
export const VersionChip: Component<{ children: JSX.Element }> = (props) => (
  <span class="rounded-md border border-edge bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium text-fg-2">
    {props.children}
  </span>
);

const InfoDialogShell: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size: "sm" | "md";
  logoSrc: string;
  name: string;
  /** The header version pill (a {@link VersionChip}), or nothing before it lands. */
  version?: JSX.Element;
  description: string;
  children: JSX.Element;
}> = (props) => (
  <ModalDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    refocusOnClose
    size={props.size}
  >
    <Dialog.Content
      class={`${chrome.class} relative overflow-hidden p-0`}
      style={chrome.style}
    >
      <button
        type="button"
        onClick={() => props.onOpenChange(false)}
        class="absolute right-3 top-3 rounded-md p-1 text-fg-3 transition-colors hover:bg-surface-3/60 hover:text-fg"
        aria-label="Close"
      >
        <CloseIcon class="h-4 w-4" />
      </button>

      <div class="border-b border-edge/70 px-5 py-4 pr-10">
        <Dialog.Label class="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
          <img src={props.logoSrc} alt="" class="h-6 w-6" />
          <span>{props.name}</span>
          {props.version}
        </Dialog.Label>
        <Dialog.Description class="mt-1 text-xs text-fg-3">
          {props.description}
        </Dialog.Description>
      </div>

      <div class="space-y-4 px-5 py-4">{props.children}</div>
    </Dialog.Content>
  </ModalDialog>
);

export default InfoDialogShell;
