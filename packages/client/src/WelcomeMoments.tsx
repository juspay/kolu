/** Prioritized, state-aware welcome moments for new users — Choose your coding
 *  agents · Pin it · From another device · Run agents · Search everything · Add
 *  another machine · Shortcuts.
 *  Rendered inline by `EmptyState` (zero terminals) and inside
 *  `WelcomeDialog` (the palette "Tutorial" command).
 *
 *  Done moments collapse into a muted header; the card paints the first three
 *  still-undone rows (selection is pure — see `welcomeMomentsSelect.ts`).
 *  Rows act through existing seams (create-terminal action, command palette,
 *  shortcuts help disclosure, PWA install prompt); every moment carries a
 *  `DocLink`. */

import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  AGENTS_FIRST_RUN_TITLE,
  agentsChosen,
  agentsChosenLabel,
  firstRunAgentsDone,
} from "@kolu/agent-distro/status";
import { installInstructions, type PwaInstall } from "@kolu/solid-pwa-install";
import { LOCAL_HOST } from "kolu-common/hostKey";
import { useSurfaceApp } from "@kolu/surface-app/solid";
import { type Component, createMemo, For, type JSX, Show } from "solid-js";
import AgentsChooser from "./agents/AgentsChooser";
import {
  agentDistroListing,
  agentDistroSetting,
  agentDistroStored,
  hostAgentStatusOf,
  localAgentResolved,
} from "./agents/useAgentDistro";
import { useHostMembers } from "./host/useHostMembers";
import { ACTIONS, advertisedNewTerminalKey } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import { shortcutsHelp } from "./ShortcutsHelp";
import DocLink, { type DocSlug } from "./ui/DocLink";
import Kbd from "./ui/Kbd";
import { useActionContext } from "./useActionContext";
import { useCommandPalette } from "./useCommandPalette";
import { preferencesArrived } from "./wire";
import {
  latchKnown,
  selectWelcomeMoments,
  type WelcomeMomentId,
} from "./welcomeMomentsSelect";

/** The done header's words per moment — `undefined` for a moment with no
 *  entry. THE decision of which done moments the header shows; `chooseAgents`
 *  names the choice in `@kolu/agent-distro/status`'s words, and has none in a
 *  kolu built without agents (nobody chose anything there). */
const doneText = (id: WelcomeMomentId): string | undefined => {
  switch (id) {
    case "chooseAgents":
      return agentsChosenLabel(
        agentDistroSetting(),
        agentDistroListing(),
        localAgentResolved(),
      );
    case "pin":
      return "📌 Pinned ✓";
    case "reach":
      return "🌐 Reachable ✓";
    case "host":
      return "🖥️ Host added ✓";
    case "agents":
    case "search":
    case "shortcuts":
      return undefined;
    default:
      return id satisfies never;
  }
};

/** A done entry as drawn: the agents choice behind agent-distro's logo (kolu
 *  shows the logo wherever it names agent-distro); the others keep their
 *  emoji, which their words carry. */
const DoneEntry: Component<{ id: WelcomeMomentId; text: string }> = (props) =>
  props.id === "chooseAgents" ? (
    <span class="inline-flex items-center gap-1 align-bottom">
      <AgentDistroLogo size={12} />
      {props.text}
    </span>
  ) : (
    props.text
  );

/** A welcome row's body voice — its line height and grey. */
const MOMENT_VOICE = {
  leading: "leading-snug",
  muted: "text-fg-3",
} as const;

const MomentShell: Component<{
  /** The row's mark: an emoji, or a logo (the agents step's). */
  icon: JSX.Element;
  title: string;
  body: JSX.Element;
  /** Optional block under the body — the agents step's control, choice line
   *  and status lines; the Pin row's manual-install steps. */
  details?: JSX.Element;
  docSlug: DocSlug;
  trailing?: JSX.Element;
  testId?: string;
}> = (props) => (
  // Title row owns the trailing CTA so multi-line body/learn-more never
  // vertically centers the action mid-block (the shimmer of misaligned ⌘K /
  // Open → next to a two-line description).
  <div class="flex items-start gap-3" data-testid={props.testId}>
    <span
      class="shrink-0 w-5 h-5 flex items-center justify-center text-base leading-5 pt-px text-fg"
      aria-hidden="true"
    >
      {props.icon}
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-3 min-h-5">
        <div class="min-w-0 flex-1 text-sm font-medium leading-5 text-fg">
          {props.title}
        </div>
        <Show when={props.trailing}>
          <div class="shrink-0 flex items-center">{props.trailing}</div>
        </Show>
      </div>
      <div
        class={`text-xs mt-0.5 ${MOMENT_VOICE.leading} ${MOMENT_VOICE.muted}`}
      >
        {props.body}
      </div>
      {props.details}
      <div class="mt-0.5 text-xs">
        <DocLink slug={props.docSlug}>Learn more →</DocLink>
      </div>
    </div>
  </div>
);

/** The agents choice: the same `AgentsChooser` as Settings → Agents, laid out
 *  as a welcome row with agent-distro's logo — its switch only (turning it on
 *  with nothing chosen starts on Juspay's profile; the profile field lives in
 *  Settings), and the status lines. It stays at the top while agents are off —
 *  nothing chosen, or switched off. Only while NOTHING is chosen does the
 *  switch take focus on mount, so Enter turns agents on: someone who switched
 *  them off sees the row at every empty canvas, but an Enter out of habit must
 *  not switch them back on. ⌘⏎ still creates a terminal from anywhere. */
const ChooseAgentsMoment: Component = () => (
  <AgentsChooser autofocus={!agentsChosen(agentDistroStored())}>
    {(parts) => (
      <MomentShell
        testId="welcome-moment-choose-agents"
        icon={<AgentDistroLogo size={16} />}
        title={AGENTS_FIRST_RUN_TITLE}
        body={parts.stepHint()}
        details={
          <>
            <div class="mt-1.5 flex">{parts.control}</div>
            {parts.status}
          </>
        }
        docSlug="agents"
      />
    )}
  </AgentsChooser>
);

/** The pin-it states that actually paint a row — the four-state machine below
 *  minus `installed`, which the selection filters out. */
type PinRowState = "one-click" | "manual-secure" | "manual-insecure";

const PinMoment: Component<{
  pinState: PinRowState;
  instr: ReturnType<typeof installInstructions>;
  onInstall: () => void;
}> = (props) => (
  <MomentShell
    testId="welcome-moment-pin"
    icon="📌"
    title="Pin it"
    trailing={
      // Only the one-click state has an action: the others pass none, so the
      // shell draws no empty trailing box beside the title.
      props.pinState === "one-click" ? (
        <button
          type="button"
          data-testid="welcome-install"
          class="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-accent text-surface-1 font-medium hover:brightness-110 transition-all"
          onClick={() => props.onInstall()}
        >
          Install
        </button>
      ) : undefined
    }
    body={
      props.pinState === "one-click"
        ? "Its own window, dock icon, and a live badge for finished agents."
        : "Add kolu as an app — its own window, dock icon, and a live agent badge."
    }
    details={
      <Show when={props.pinState !== "one-click"}>
        <div data-testid="welcome-install-manual">
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
      </Show>
    }
    docSlug="install-pwa"
  />
);

const WelcomeMoments: Component<{
  install: PwaInstall;
  /** When moments render inside WelcomeDialog, close that overlay before
   *  opening the palette so the two force-mounted dialogs don't stack. */
  onBeforeOpenPalette?: () => void;
}> = (props) => {
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

  // The pin ROW's state: the same machine minus the state that never paints.
  // Kept as an accessor (not a value snapshotted in `renderRow`) because
  // `renderRow` runs once per row id inside `<For>`, while `canPrompt()` flips
  // later — Chrome fires `beforeinstallprompt` well after this card mounts.
  const pinRowState = (): PinRowState | null => {
    const state = pinState();
    // `installed` is filtered out by selection; pin only paints while undone.
    return state === "installed" ? null : state;
  };

  // The step's last KNOWN reading: a pick leaves this machine's status behind
  // the choice for a moment, and the row stays through it (`latchKnown`).
  const chooseAgentsDone = latchKnown(() =>
    preferencesArrived()
      ? firstRunAgentsDone({
          stored: agentDistroStored(),
          listing: agentDistroListing(),
          local: hostAgentStatusOf(LOCAL_HOST),
        })
      : undefined,
  );
  const selection = createMemo(() =>
    selectWelcomeMoments({
      chooseAgentsDone: chooseAgentsDone(),
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
      case "chooseAgents":
        return <ChooseAgentsMoment />;
      case "pin":
        return (
          <Show when={pinRowState()}>
            {(state) => (
              <PinMoment
                pinState={state()}
                instr={instr()}
                onInstall={() => props.install.prompt()}
              />
            )}
          </Show>
        );
      case "reach":
        return (
          <MomentShell
            testId="welcome-moment-reach"
            icon="🌐"
            title="From another device"
            body="Serve it over HTTPS with Tailscale, then pin it as an app on your laptop or phone."
            docSlug="remote-access"
            trailing={
              <DocLink
                slug="remote-access"
                class="text-xs text-accent hover:underline"
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
            icon="🤖"
            title="Run agents"
            body="Open a repo, drop a tile, launch Claude / Codex / OpenCode."
            docSlug="agent-detection"
            trailing={
              <button
                type="button"
                data-testid="welcome-run-agents"
                class="cursor-pointer"
                title={ACTIONS.createTerminal.label}
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
            icon="⌕"
            title={ACTIONS.commandPalette.label}
            body="One box finds terminals, hosts, and commands — type a branch or machine name, no separate switcher."
            docSlug="switcher"
            trailing={
              <button
                type="button"
                data-testid="welcome-open-palette"
                class="cursor-pointer"
                title="Open search"
                onClick={() => {
                  props.onBeforeOpenPalette?.();
                  commandPalette.openDialog();
                }}
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
            icon="🖥️"
            title="Add another machine"
            body="Point kolu at another machine over ssh — the whole canvas becomes that host."
            docSlug="remote-hosts"
            trailing={
              <DocLink
                slug="remote-hosts"
                class="text-xs text-accent hover:underline"
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
            icon="⌨️"
            title="Shortcuts"
            body="Cmd+/ (or Ctrl+/) opens the full keyboard-shortcuts overlay."
            docSlug="keyboard-shortcuts"
            trailing={
              <button
                type="button"
                data-testid="welcome-open-shortcuts"
                class="text-xs text-accent hover:underline cursor-pointer"
                onClick={() => shortcutsHelp.openDialog()}
              >
                Open →
              </button>
            }
          />
        );
    }
  };

  // The done moments that have a header entry (the never-done ones have none).
  const doneEntries = createMemo(() =>
    selection().done.flatMap((id) => {
      const text = doneText(id);
      return text === undefined ? [] : [{ id, text }];
    }),
  );

  return (
    <div class="space-y-3" data-testid="welcome-moments">
      <Show when={doneEntries().length > 0}>
        <div data-testid="welcome-moments-done" class="text-xs text-fg-3">
          <For each={doneEntries()}>
            {(entry, i) => (
              <>
                {i() > 0 ? " · " : ""}
                <DoneEntry id={entry.id} text={entry.text} />
              </>
            )}
          </For>
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
