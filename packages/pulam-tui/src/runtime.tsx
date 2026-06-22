/**
 * The shared OpenTUI run loop for pulam-tui's two views — the single-host
 * dashboard (`tui.tsx`) and the fleet board (`fleet.tsx`). OpenTUI owns the
 * terminal and its teardown (`exitOnCtrlC` / `exitSignals` / `onDestroy`);
 * `render()` resolves at MOUNT, not teardown, so this bridges that to a
 * quit-time resolution and surfaces a render error instead of swallowing it
 * into a frozen screen. Ctrl-C is the one quit — no `q` handler.
 *
 * `.tsx`, loaded only under Bun (the daemon + the rest of kolu stay Node).
 */

import { render } from "@opentui/solid";
import type { JSX } from "solid-js";

/** Mount `root` in the alt-screen and resolve once the renderer tears down
 *  (Ctrl-C, a kill signal, or a render error — which is re-thrown). */
export async function runTui(root: () => JSX.Element): Promise<void> {
  let quitting = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((res) => {
    resolveDone = res;
  });
  const quit = (): void => {
    if (quitting) return;
    quitting = true;
    resolveDone();
  };

  let renderErr: unknown;
  render(root, {
    screenMode: "alternate-screen",
    exitOnCtrlC: true,
    exitSignals: ["SIGINT", "SIGTERM"],
    clearOnShutdown: true,
    useMouse: false,
    onDestroy: () => quit(),
  }).catch((err) => {
    renderErr = err;
    quit();
  });

  await done;
  if (renderErr) throw renderErr;
}
