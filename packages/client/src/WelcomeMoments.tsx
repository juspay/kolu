/** The three bird's-eye "moments" for new users — Pin it · Reach it anywhere ·
 *  Run agents. Rendered inline by `EmptyState` (zero terminals) and inside
 *  `WelcomeDialog` (the palette "Tutorial" command).
 *
 *  The Pin-it card adapts to the browser: a one-click Install button where a real
 *  prompt exists (Chromium on a secure origin), else auto-detected inline install
 *  steps (Safari / Firefox / iOS, or any plain-`http://` origin — manual install
 *  works there). On an insecure origin it also offers the HTTPS/Tailscale upgrade
 *  for one-click install + the live agent badge. */

import { installInstructions, type PwaInstall } from "@kolu/solid-pwa-install";
import { useSurfaceApp } from "@kolu/surface-app/solid";
import { type Component, For, Match, Show, Switch } from "solid-js";
import { advertisedNewTerminalKey } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import Kbd from "./ui/Kbd";

/** The full external guide. The in-app cards stay bird's-eye; depth lives here. */
const GUIDE_URL = "https://kolu.dev/welcome";

const WelcomeMoments: Component<{ install: PwaInstall }> = (props) => {
  const app = useSurfaceApp();
  // Auto-detected, per-browser install steps — used when no one-click prompt is
  // available (Safari/Firefox/iOS, or any plain-http origin). Manual install
  // works over http; only the one-click prompt + app badge need a secure context.
  const instr = () => installInstructions(props.install.platform());

  // The Pin-it card is a four-state machine, not four overlapping booleans.
  // One discriminant names the reachable states (mutually exclusive, evaluated
  // top-down) so each renders in exactly one branch:
  //   installed       — already a PWA
  //   one-click       — a real install prompt exists (Chromium, secure origin)
  //   manual-secure   — no prompt, but secure context (Safari/Firefox/iOS)
  //   manual-insecure — plain-http origin: manual install works, badge needs HTTPS
  const pinState = () =>
    app.isInstalled()
      ? "installed"
      : props.install.canPrompt()
        ? "one-click"
        : app.canInstallPwa()
          ? "manual-secure"
          : "manual-insecure";

  return (
    <div class="space-y-3" data-testid="welcome-moments">
      {/* Pin it — one-click where a real prompt exists, else inline per-browser
          steps (manual install works over http; one-click + badge want HTTPS). */}
      <div class="flex items-start gap-3">
        <span class="text-base leading-5" aria-hidden="true">
          📌
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-fg">Pin it</div>
          <Switch>
            <Match when={pinState() === "installed"}>
              <div class="text-xs text-fg-3">Installed as an app ✓</div>
            </Match>
            <Match when={pinState() === "one-click"}>
              <div class="text-xs text-fg-3">
                Its own window, dock icon, and a live badge for finished agents.
              </div>
            </Match>
            <Match
              when={
                pinState() === "manual-secure" ||
                pinState() === "manual-insecure"
              }
            >
              <div data-testid="welcome-install-manual">
                <div class="text-xs text-fg-3">
                  Add kolu as an app — its own window, dock icon, and a live
                  agent badge.
                </div>
                <details class="mt-1 text-xs text-fg-3">
                  <summary class="cursor-pointer text-accent hover:underline">
                    {instr().title} →
                  </summary>
                  <ol class="mt-1 ml-4 list-decimal space-y-0.5">
                    <For each={instr().steps}>{(s) => <li>{s}</li>}</For>
                  </ol>
                </details>
                <Show when={pinState() === "manual-insecure"}>
                  <div class="mt-1 text-xs text-fg-3">
                    Want one-click install + the live badge? Serve over HTTPS —{" "}
                    <a
                      href={`${GUIDE_URL}#remote`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-accent hover:underline"
                    >
                      Tailscale →
                    </a>
                  </div>
                </Show>
              </div>
            </Match>
          </Switch>
        </div>
        <Show when={pinState() === "one-click"}>
          <button
            type="button"
            data-testid="welcome-install"
            class="shrink-0 self-center px-3 py-1.5 text-xs rounded-lg bg-accent text-surface-1 font-medium hover:brightness-110 transition-all"
            onClick={() => props.install.prompt()}
          >
            Install
          </button>
        </Show>
      </div>

      {/* Reach it anywhere */}
      <div class="flex items-start gap-3">
        <span class="text-base leading-5" aria-hidden="true">
          🌐
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-fg">Reach it anywhere</div>
          <div class="text-xs text-fg-3">
            One Tailscale command and kolu follows you to your phone, over real
            HTTPS.
          </div>
        </div>
        <a
          href={`${GUIDE_URL}#remote`}
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 self-center text-xs text-accent hover:underline"
        >
          Guide →
        </a>
      </div>

      {/* Run agents */}
      <div class="flex items-start gap-3">
        <span class="text-base leading-5" aria-hidden="true">
          🤖
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-fg">Run agents</div>
          <div class="text-xs text-fg-3">
            Open a repo, drop a tile, launch Claude / Codex / OpenCode.
          </div>
        </div>
        <span class="shrink-0 self-center">
          <Kbd>{formatKeybind(advertisedNewTerminalKey)}</Kbd>
        </span>
      </div>

      <div class="pt-1 text-xs">
        <a
          href={GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          class="text-accent hover:underline"
        >
          Full guide → kolu.dev/welcome
        </a>
      </div>
    </div>
  );
};

export default WelcomeMoments;
