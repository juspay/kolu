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
import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import AgentsChooser from "./agents/AgentsChooser";
import {
  agentDistroListing,
  agentDistroSetting,
  agentDistroStored,
  agentProfilesNow,
  hostAgentStatusOf,
} from "./agents/useAgentDistro";
import { hostKeys } from "./wire";
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

const [agentsStepDismissed, setAgentsStepDismissed] = createSignal(false);

const doneText = (id: WelcomeMomentId): string | undefined => {
  switch (id) {
    case "chooseAgents":
      return agentsChosenLabel(
        agentDistroSetting(),
        agentDistroListing(),
        agentProfilesNow(),
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

const DoneEntry: Component<{ id: WelcomeMomentId; text: string }> = (props) =>
  props.id === "chooseAgents" ? (
    <span class="inline-flex items-center gap-1 align-bottom">
      <AgentDistroLogo size={12} />
      {props.text}
    </span>
  ) : (
    props.text
  );

const MOMENT_VOICE = {
  leading: "leading-snug",
  muted: "text-fg-3",
} as const;

const MomentShell: Component<{
  icon: JSX.Element;
  title: string;
  body: JSX.Element;
  details?: JSX.Element;
  docSlug: DocSlug;
  trailing?: JSX.Element;
  testId?: string;
}> = (props) => (
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

const ChooseAgentsMoment: Component<{ onNotNow: () => void }> = (props) => (
  <AgentsChooser deferred>
    {(parts) => {
      let step: HTMLDivElement | undefined;
      const [owned, setOwned] = createSignal(false);
      makeEventListener(document, "focusin", (e: FocusEvent) => {
        setOwned(e.target instanceof Node && step?.contains(e.target) === true);
      });
      makeEventListener(document, "focusout", (e: FocusEvent) => {
        if (
          e.target instanceof Node &&
          step?.contains(e.target) === true &&
          step.checkVisibility() !== true
        )
          setOwned(false);
      });
      const pageEnterArmed = () =>
        owned() &&
        step?.checkVisibility() === true &&
        !agentsChosen(agentDistroStored());
      makeEventListener(document, "keydown", (e: KeyboardEvent) => {
        if (
          e.key !== "Enter" ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          e.shiftKey ||
          !parts.canTurnOn()
        )
          return;
        const target = e.target;
        const inStep = target instanceof Node && step?.contains(target);
        const loose = target === document.body && pageEnterArmed();
        if (!inStep && !loose) return;
        if (
          target instanceof Element &&
          target.closest("button, input, textarea, select, a")
        )
          return;
        e.preventDefault();
        parts.turnOn();
      });
      return (
        <MomentShell
          testId="welcome-moment-choose-agents"
          icon={<AgentDistroLogo size={16} />}
          title={AGENTS_FIRST_RUN_TITLE}
          body={parts.stepHint()}
          details={
            <div ref={step}>
              {parts.profiles}
              <div class="mt-2.5 flex items-center gap-3.5">
                <Show when={parts.canTurnOn()}>
                  <button
                    ref={(el) => {
                      if (!agentsChosen(agentDistroStored()))
                        queueMicrotask(() => el.focus());
                    }}
                    type="button"
                    data-testid="welcome-agents-turn-on"
                    class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-surface-1 transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1"
                    onClick={() => parts.turnOn()}
                  >
                    Turn on
                    <Show when={pageEnterArmed()}>
                      <Kbd>⏎</Kbd>
                    </Show>
                  </button>
                </Show>
                <button
                  type="button"
                  data-testid="welcome-agents-not-now"
                  class="cursor-pointer text-xs text-fg-3 hover:text-fg-2 hover:underline"
                  onClick={() => props.onNotNow()}
                >
                  Not now — plain terminals, ask again later
                </button>
              </div>
            </div>
          }
          docSlug="agents"
        />
      );
    }}
  </AgentsChooser>
);

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
  onBeforeOpenPalette?: () => void;
}> = (props) => {
  const app = useSurfaceApp();
  const actions = useActionContext();
  const commandPalette = useCommandPalette();
  // Auto-detected, per-browser install steps — used when no one-click prompt is
  // available (Safari/Firefox/iOS, or any plain-http origin). Manual install
  // works over http; only the one-click prompt + app badge need a secure context.
  const instr = () => installInstructions(props.install.platform());

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
    return state === "installed" ? null : state;
  };

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
      chooseAgentsDismissed: agentsStepDismissed(),
      pinDone: pinState() === "installed",
      reachDone: location.protocol === "https:",
      hostsDone: hostKeys().length > 1,
    }),
  );

  const runCreateTerminal = () => {
    actions.handleCreate(actions.activeMeta()?.cwd ?? undefined);
  };

  const renderRow = (id: WelcomeMomentId): JSX.Element => {
    switch (id) {
      case "chooseAgents":
        return (
          <ChooseAgentsMoment onNotNow={() => setAgentsStepDismissed(true)} />
        );
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
