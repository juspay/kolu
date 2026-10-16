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

/** "Not now" on the agents step, for THIS session: the row goes and the
 *  preference stays unchosen, so the next load asks again. A module signal, so
 *  the dismissal holds across the two places the card renders (the empty
 *  canvas and the Tutorial dialog) and dies with the page — "ask again later"
 *  is exactly its lifetime. */
const [agentsStepDismissed, setAgentsStepDismissed] = createSignal(false);

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
 *  as a welcome row with agent-distro's logo — the profile list (always empty
 *  to start with, the agents as they ship) opening with a one-click
 *  "+ Juspay" row, "Turn on" to take it, and "Not now" to go on with plain
 *  terminals.
 *
 *  Nothing is written until "Turn on": the list is held by the step, and "Not
 *  now" must leave the preference UNchosen — it hides the row for this session
 *  and the card asks again next time. The row stays at the top while agents
 *  are off (nothing chosen, or switched off). Only while NOTHING is chosen does
 *  "Turn on" take focus on mount, so **Enter** turns agents on. Someone who
 *  switched agents off sees the row at every empty canvas, but an Enter out of
 *  habit must not switch them back on, so nothing is focused then. ⌘⏎ still
 *  creates a terminal from anywhere.
 *
 *  **Enter belongs to the STEP**, not to "Turn on": whatever in the step has
 *  the focus, Enter turns agents on — except on a control of its own (a
 *  button, the add field, the list's arrows), which keeps its Enter. Editing
 *  the list can take the focused control away ("+ Juspay" goes once it is
 *  added, a removed row's ✕ with its row), and
 *  focus then falls to the page, so while nothing is chosen an Enter there is
 *  the step's too — the same rule as the mount focus above — claimed by the
 *  one copy of the step that had the focus last, never by every copy
 *  mounted. The ⏎ on "Turn on" is painted only while that holds. */
const ChooseAgentsMoment: Component<{ onNotNow: () => void }> = (props) => (
  <AgentsChooser deferred>
    {(parts) => {
      let step: HTMLDivElement | undefined;
      // Which copy of the step the page's Enter belongs to: the one whose
      // subtree had the focus last. The welcome card can be mounted twice (the
      // empty canvas's, and the Tutorial's over it), and focus that falls to
      // the page — the "+ Juspay" row going away under it — names neither.
      const [owned, setOwned] = createSignal(false);
      makeEventListener(document, "focusin", (e: FocusEvent) => {
        setOwned(e.target instanceof Node && step?.contains(e.target) === true);
      });
      // A copy hidden while it held the focus (the Tutorial's, force-mounted
      // and hidden on Escape) moves no focus anywhere: it gives the latch up
      // as its subtree loses the focus.
      makeEventListener(document, "focusout", (e: FocusEvent) => {
        if (
          e.target instanceof Node &&
          step?.contains(e.target) === true &&
          step.checkVisibility() !== true
        )
          setOwned(false);
      });
      /** An Enter on the page itself turns agents on: only while nothing is
       *  chosen (an Enter out of habit never re-enables agents someone
       *  switched off), only for the copy that had the focus, and only while
       *  that copy can be seen. The ⏎ on "Turn on" is painted exactly then. */
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
                    {/* Painted only while the page's Enter does it. */}
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

  // The step's last KNOWN reading: a choice leaves this machine's status behind
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
      chooseAgentsDismissed: agentsStepDismissed(),
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
