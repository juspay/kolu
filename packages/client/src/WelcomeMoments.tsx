/** Prioritized, state-aware welcome moments for new users — Pin it · Reach it
 *  anywhere · Run agents · Search everything · Add a host · Shortcuts.
 *  Rendered inline by `EmptyState` (zero terminals) and inside
 *  `WelcomeDialog` (the palette "Tutorial" command).
 *
 *  Done moments collapse into a muted header; the card paints the first three
 *  still-undone rows (selection is pure — see `welcomeMomentsSelect.ts`).
 *  Rows act through existing seams (create-terminal action, command palette,
 *  shortcuts help disclosure, PWA install prompt); every moment carries a
 *  `DocLink`. */

import { installInstructions, type PwaInstall } from "@kolu/solid-pwa-install";
import { useSurfaceApp } from "@kolu/surface-app/solid";
import {
  type Component,
  createMemo,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from "solid-js";
import { useHostMembers } from "./host/useHostMembers";
import { ACTIONS, advertisedNewTerminalKey } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import { shortcutsHelp } from "./ShortcutsHelp";
import DocLink, { type DocSlug } from "./ui/DocLink";
import Kbd from "./ui/Kbd";
import { useActionContext } from "./useActionContext";
import { useCommandPalette } from "./useCommandPalette";
import {
  selectWelcomeMoments,
  type WelcomeMomentId,
} from "./welcomeMomentsSelect";

const DONE_LABEL: Record<"pin" | "reach" | "host", string> = {
  pin: "📌 Pinned ✓",
  reach: "🌐 Reachable ✓",
  host: "🖥️ Host added ✓",
};

const MomentShell: Component<{
  emoji: string;
  title: string;
  body: JSX.Element;
  docSlug: DocSlug;
  trailing?: JSX.Element;
  testId?: string;
}> = (props) => (
  <div class="flex items-start gap-3" data-testid={props.testId}>
    <span class="text-base leading-5" aria-hidden="true">
      {props.emoji}
    </span>
    <div class="min-w-0 flex-1">
      <div class="text-sm font-medium text-fg">{props.title}</div>
      <div class="text-xs text-fg-3">{props.body}</div>
      <div class="mt-0.5 text-xs">
        <DocLink slug={props.docSlug}>Learn more →</DocLink>
      </div>
    </div>
    {props.trailing}
  </div>
);

const PinMoment: Component<{
  pinState: "one-click" | "manual-secure" | "manual-insecure";
  instr: ReturnType<typeof installInstructions>;
  onInstall: () => void;
}> = (props) => (
  <div class="flex items-start gap-3" data-testid="welcome-moment-pin">
    <span class="text-base leading-5" aria-hidden="true">
      📌
    </span>
    <div class="min-w-0 flex-1">
      <div class="text-sm font-medium text-fg">Pin it</div>
      <Switch>
        <Match when={props.pinState === "one-click"}>
          <div class="text-xs text-fg-3">
            Its own window, dock icon, and a live badge for finished agents.
          </div>
        </Match>
        <Match when={true}>
          <div data-testid="welcome-install-manual">
            <div class="text-xs text-fg-3">
              Add kolu as an app — its own window, dock icon, and a live agent
              badge.
            </div>
            <details class="mt-1 text-xs text-fg-3">
              <summary class="cursor-pointer text-accent hover:underline">
                {props.instr.title} →
              </summary>
              <ol class="mt-1 ml-4 list-decimal space-y-0.5">
                <For each={props.instr.steps}>{(s) => <li>{s}</li>}</For>
              </ol>
            </details>
            <Show when={props.pinState === "manual-insecure"}>
              <div class="mt-1 text-xs text-fg-3">
                Want one-click install + the live badge? Serve over HTTPS —{" "}
                <DocLink slug="remote-access">Tailscale →</DocLink>
              </div>
            </Show>
          </div>
        </Match>
      </Switch>
      <div class="mt-0.5 text-xs">
        <DocLink slug="install-pwa">Learn more →</DocLink>
      </div>
    </div>
    <Show when={props.pinState === "one-click"}>
      <button
        type="button"
        data-testid="welcome-install"
        class="shrink-0 self-center px-3 py-1.5 text-xs rounded-lg bg-accent text-surface-1 font-medium hover:brightness-110 transition-all"
        onClick={() => props.onInstall()}
      >
        Install
      </button>
    </Show>
  </div>
);

const WelcomeMoments: Component<{ install: PwaInstall }> = (props) => {
  const app = useSurfaceApp();
  const hosts = useHostMembers();
  const actions = useActionContext();
  const commandPalette = useCommandPalette();
  // Auto-detected, per-browser install steps — used when no one-click prompt is
  // available (Safari/Firefox/iOS, or any plain-http origin). Manual install
  // works over http; only the one-click prompt + app badge need a secure context.
  const instr = () => installInstructions(props.install.platform());

  // The Pin-it card is a four-state machine, not four overlapping booleans.
  // One discriminant names the reachable states (mutually exclusive, evaluated
  // top-down) so each renders in exactly one branch:
  //   installed       — already a PWA (collapses into the done header)
  //   one-click       — a real install prompt exists (Chromium, secure origin)
  //   manual-secure   — no prompt, but secure context (Safari/Firefox/iOS)
  //   manual-insecure — plain-http origin: manual install works, badge needs HTTPS
  const pinState = createMemo(() =>
    app.isInstalled()
      ? "installed"
      : props.install.canPrompt()
        ? "one-click"
        : app.canInstallPwa()
          ? "manual-secure"
          : "manual-insecure",
  );

  const selection = createMemo(() =>
    selectWelcomeMoments({
      pinDone: pinState() === "installed",
      reachDone: location.protocol === "https:",
      hostsDone: hosts().length > 1,
    }),
  );

  const runCreateTerminal = () => {
    // Same path the advertised ⌘Enter chord fires (`ACTIONS.createTerminal`).
    actions.handleCreate(actions.activeMeta()?.cwd ?? undefined);
  };

  const renderRow = (id: WelcomeMomentId): JSX.Element => {
    switch (id) {
      case "pin": {
        const state = pinState();
        // `installed` is filtered out by selection; pin only paints while undone.
        if (state === "installed") return null;
        return (
          <PinMoment
            pinState={state}
            instr={instr()}
            onInstall={() => props.install.prompt()}
          />
        );
      }
      case "reach":
        return (
          <MomentShell
            testId="welcome-moment-reach"
            emoji="🌐"
            title="Reach it anywhere"
            body="One Tailscale command and kolu follows you to your phone, over real HTTPS."
            docSlug="remote-access"
            trailing={
              <DocLink
                slug="remote-access"
                class="shrink-0 self-center text-xs text-accent hover:underline"
              >
                Guide →
              </DocLink>
            }
          />
        );
      case "agents":
        return (
          <MomentShell
            testId="welcome-moment-agents"
            emoji="🤖"
            title="Run agents"
            body="Open a repo, drop a tile, launch Claude / Codex / OpenCode."
            docSlug="agent-detection"
            trailing={
              <button
                type="button"
                data-testid="welcome-run-agents"
                class="shrink-0 self-center cursor-pointer"
                title="New terminal"
                onClick={runCreateTerminal}
              >
                <Kbd>{formatKeybind(advertisedNewTerminalKey)}</Kbd>
              </button>
            }
          />
        );
      case "search":
        return (
          <MomentShell
            testId="welcome-moment-search"
            emoji="⌕"
            title="Search everything"
            body="One box finds workspaces, hosts, and commands — type a branch or machine name, no separate switcher."
            docSlug="keyboard-shortcuts"
            trailing={
              <button
                type="button"
                data-testid="welcome-open-palette"
                class="shrink-0 self-center cursor-pointer"
                title="Open search"
                onClick={() => commandPalette.openDialog()}
              >
                <Kbd>{formatKeybind(ACTIONS.commandPalette.keybind)}</Kbd>
              </button>
            }
          />
        );
      case "host":
        return (
          <MomentShell
            testId="welcome-moment-host"
            emoji="🖥️"
            title="Add a host"
            body="Point kolu at another machine over ssh — the whole canvas becomes that host."
            docSlug="remote-hosts"
            trailing={
              <DocLink
                slug="remote-hosts"
                class="shrink-0 self-center text-xs text-accent hover:underline"
              >
                Guide →
              </DocLink>
            }
          />
        );
      case "shortcuts":
        return (
          <MomentShell
            testId="welcome-moment-shortcuts"
            emoji="⌨️"
            title="Shortcuts"
            body="Cmd+/ (or Ctrl+/) opens the full keyboard-shortcuts overlay."
            docSlug="keyboard-shortcuts"
            trailing={
              <button
                type="button"
                data-testid="welcome-open-shortcuts"
                class="shrink-0 self-center text-xs text-accent hover:underline cursor-pointer"
                onClick={() => shortcutsHelp.openDialog()}
              >
                Open →
              </button>
            }
          />
        );
    }
  };

  const doneLine = (): string =>
    selection()
      .done.filter(
        (id): id is "pin" | "reach" | "host" =>
          id === "pin" || id === "reach" || id === "host",
      )
      .map((id) => DONE_LABEL[id])
      .join(" · ");

  return (
    <div class="space-y-3" data-testid="welcome-moments">
      <Show when={selection().done.length > 0}>
        <div data-testid="welcome-moments-done" class="text-xs text-fg-3">
          {doneLine()}
        </div>
      </Show>

      <For each={[...selection().rows]}>{(id) => renderRow(id)}</For>

      <div class="pt-1 text-xs">
        <DocLink slug="first-five-minutes" data-testid="welcome-full-guide">
          Full guide → first five minutes
        </DocLink>
      </div>
    </div>
  );
};

export default WelcomeMoments;
