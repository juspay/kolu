/**
 * The OpenTUI/Solid view for arivu-tui — arivu P3 PR2a.
 *
 * PR2a MILESTONE (this commit): prove the whole render pipeline — Bun →
 * OpenTUI (its native Zig core, loaded via `Bun.dlopen`) → Solid's fine-grained
 * reactive reconciler — end to end, behind the smallest possible UI. The real
 * awareness list + `--json` land next; this is the smoke that the pipeline is
 * alive at all (the native lib resolves under bun2nix/Nix, JSX is reactive).
 *
 * The liveness proof is a CLOCK that ticks once a second. It is deliberately the
 * ONLY moving part: if it advances, OpenTUI is repainting through Solid's
 * reactivity, not frozen. It is written the SolidJS-canonical way and no other —
 * a `createSignal` updated by an interval started in `onMount` and torn down in
 * `onCleanup`, READ in JSX so the reconciler repaints only that one cell. No
 * `requestRender`, no fps cap, no externally-driven timer, no imperative redraw.
 *
 * This module is `.tsx` and only ever loaded under Bun (the `arivu` daemon and
 * the rest of kolu stay Node); bin.ts imports it dynamically ONLY when stdout is
 * a TTY, so a piped run never drags the native renderer in.
 */

import type { CliRenderer } from "@opentui/core";
import { render, useKeyboard, useRenderer } from "@opentui/solid";
import { createSignal, onCleanup, onMount } from "solid-js";

const GREEN = "#7ec699";
const CYAN = "#56b6c2";
const MUTED = "#5b6678";

/** The live clock — the canonical Solid live value. `now()` is read in JSX, so
 *  when the interval advances the signal, the reconciler repaints just this
 *  text. The interval is owned by the component: started in onMount, cleared in
 *  onCleanup, never leaked. */
function Clock() {
  const [now, setNow] = createSignal(new Date());
  onMount(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    onCleanup(() => clearInterval(id));
  });
  return <text fg={CYAN}>{`clock · ${now().toLocaleTimeString()}`}</text>;
}

/** The smoke view: a greeting, the live clock, and the quit hint. Exported for
 *  the headless Bun render test. */
export function HelloView() {
  return (
    <box flexDirection="column" padding={1}>
      <text fg={GREEN}>hello world — arivu-tui on OpenTUI (Bun)</text>
      <Clock />
      <text fg={MUTED}>q (or Ctrl-C) to quit</text>
    </box>
  );
}

/** Run the smoke TUI in the alt-screen until the user quits (`q`, Ctrl-C, or a
 *  kill signal). Resolves once the renderer has torn down. A render-time error
 *  is surfaced, never swallowed into a frozen screen. */
export async function runHelloTui(): Promise<void> {
  let renderer: CliRenderer | undefined;
  let quitting = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((res) => {
    resolveDone = res;
  });
  const quit = (): void => {
    if (quitting) return;
    quitting = true;
    try {
      renderer?.destroy();
    } catch {
      // best-effort — we're exiting anyway.
    }
    resolveDone();
  };

  function App() {
    renderer = useRenderer();
    useKeyboard((key) => {
      if (key.name === "q") quit();
    });
    return <HelloView />;
  }

  let renderErr: unknown;
  // Ctrl-C / a kill signal tear the renderer down through OpenTUI's own exit
  // path; `onDestroy` finishes the same teardown (release the awaiter).
  render(() => <App />, {
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
