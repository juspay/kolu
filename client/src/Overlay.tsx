/** Shared overlay container with backdrop and entrance/exit transitions. */

import { type Component, type JSX, createEffect, on } from "solid-js";

const Overlay: Component<{
  open: boolean;
  onClose: () => void;
  children: JSX.Element;
}> = (props) => {
  // Refocus the active terminal when overlay closes — the always-mounted
  // overlay doesn't naturally return focus like a <Show>-based unmount would.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open) return;
        const el = document.querySelector<HTMLElement>(
          "[data-visible][data-terminal-id]",
        );
        el?.click();
      },
      { defer: true },
    ),
  );

  return (
    <div
      class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] transition-[opacity] duration-150 ease-out"
      classList={{
        "visible opacity-100 pointer-events-auto": props.open,
        // visibility:hidden ensures Playwright treats closed overlays as hidden
        "invisible opacity-0 pointer-events-none": !props.open,
      }}
    >
      {/* Backdrop */}
      <div
        class="fixed inset-0 bg-black/50 transition-opacity duration-150"
        classList={{
          "opacity-100": props.open,
          "opacity-0": !props.open,
        }}
        onClick={() => props.onClose()}
      />
      {/* Panel — slides down slightly on enter */}
      <div
        class="relative z-10 transition-transform duration-150 ease-out"
        classList={{
          "translate-y-0": props.open,
          "-translate-y-2": !props.open,
        }}
      >
        {props.children}
      </div>
    </div>
  );
};

export default Overlay;
