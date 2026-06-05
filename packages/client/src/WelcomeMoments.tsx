/** The three bird's-eye "moments" for new users — Pin it · Reach it anywhere ·
 *  Run agents. Rendered inline by `EmptyState` (zero terminals) and inside
 *  `WelcomeDialog` (the palette "Tutorial" command).
 *
 *  The Pin-it card is context-aware: it never offers an install action where it
 *  can't work. Install requires a secure context, so over plain `http://` on a
 *  LAN/Tailscale IP (`canInstallPwa()` false) it pivots to the Tailscale fix
 *  rather than dangling a dead button. */

import type { PwaInstall } from "@kolu/solid-pwa-install";
import { useSurfaceApp } from "@kolu/surface-app/solid";
import { type Component, Show } from "solid-js";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import Kbd from "./ui/Kbd";

/** The full external guide. The in-app cards stay bird's-eye; depth lives here. */
const GUIDE_URL = "https://kolu.dev/welcome";

// Cmd+Enter, not Cmd+T: Cmd+T is intercepted by browsers outside PWA-installed
// mode, so the alt chord is the universally-functional advert (matches EmptyState).
const newTerminalKey =
  ACTIONS.createTerminal.altKeybind ?? ACTIONS.createTerminal.keybind;

const WelcomeMoments: Component<{ install: PwaInstall }> = (props) => {
  const app = useSurfaceApp();
  const installLabel = () =>
    props.install.canPrompt() ? "Install" : "How to install";

  return (
    <div class="space-y-3" data-testid="welcome-moments">
      {/* Pin it — context-aware install affordance */}
      <div class="flex items-start gap-3">
        <span class="text-base leading-5" aria-hidden="true">
          📌
        </span>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-fg">Pin it</div>
          <Show
            when={!app.isInstalled()}
            fallback={
              <div class="text-xs text-fg-3">Installed as an app ✓</div>
            }
          >
            <Show
              when={app.canInstallPwa()}
              fallback={
                <div
                  class="text-xs text-fg-3"
                  data-testid="welcome-install-insecure"
                >
                  Installing needs HTTPS.{" "}
                  <a
                    href={`${GUIDE_URL}#remote`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-accent hover:underline"
                  >
                    Set up Tailscale →
                  </a>
                </div>
              }
            >
              <div class="text-xs text-fg-3">
                Its own window, dock icon, and a live badge for finished agents.
              </div>
            </Show>
          </Show>
        </div>
        <Show when={!app.isInstalled() && app.canInstallPwa()}>
          <button
            type="button"
            data-testid="welcome-install"
            class="shrink-0 self-center px-3 py-1.5 text-xs rounded-lg bg-accent text-surface-1 font-medium hover:brightness-110 transition-all"
            onClick={() => props.install.prompt()}
          >
            {installLabel()}
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
          <Kbd>{formatKeybind(newTerminalKey)}</Kbd>
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
