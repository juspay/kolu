import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { type Component, createEffect, createSignal, Show } from "solid-js";
import Tip from "../ui/Tip";
import { isDesktop } from "../useMobile";
import ConductorMenu from "./ConductorMenu";
import ConductorSettings from "./ConductorSettings";
import { useShown } from "../ui/shown";

function tokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  const millions = count / 1_000_000;
  return `${millions >= 10 || Number.isInteger(millions) ? Math.round(millions) : millions.toFixed(1)}M`;
}

const ConductorHeader: Component<{
  state: ConductorState;
  /** The transcript as it is drawn, for the menu's `Copy transcript`. */
  rows: readonly ConductorRow[];
  /** Opens the sign-in row from the menu's `Sign in…` / `Sign in again…`. */
  onSignIn: () => void;
}> = (props) => {
  let modelRef!: HTMLButtonElement;
  let menuRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const shown = useShown();
  createEffect(() => {
    if (shown()) return;
    setSettingsOpen(false);
    setMenuOpen(false);
  });
  const usage = () => props.state.usage;
  const identity = () => props.state.identity;
  const signedIn = () => {
    const who = identity();
    return who !== null && who.kind !== "none";
  };

  return (
    <header class="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-edge font-mono text-[0.65rem] leading-4">
      <Show when={isDesktop()}>
        <span
          data-testid="conductor-header-name"
          class="flex items-center gap-2.5"
        >
          <span class="text-busy text-sm/4">◆</span>
          <span class="font-extrabold tracking-[0.14em] text-fg-2">
            CONDUCTOR
          </span>
        </span>
      </Show>
      <Tip
        class="flex items-center"
        label="Alpha: the shape can still change, and a conversation can be lost across a version"
      >
        <span
          data-testid="conductor-alpha"
          class="rounded-sm bg-fg-3/15 px-1 py-px font-semibold uppercase tracking-[0.08em] text-fg-3"
        >
          alpha
        </span>
      </Tip>
      <Show when={identity()}>
        {(who) => (
          <Tip
            class="flex items-center"
            label={who().account?.email ?? who().detail ?? who().label}
          >
            <span
              data-testid="conductor-identity"
              data-identity-kind={who().kind ?? undefined}
              class="text-fg-3 rounded-full border border-edge px-2 py-px truncate max-w-[12rem]"
            >
              {who().kind === "none" ? "not signed in" : who().label}
            </span>
          </Tip>
        )}
      </Show>
      <button
        type="button"
        ref={modelRef}
        data-testid="conductor-model"
        class="text-fg-3 hover:text-fg underline decoration-dashed decoration-edge-bright underline-offset-[3px] cursor-pointer truncate max-w-[14rem]"
        onClick={() => setSettingsOpen(!settingsOpen())}
      >
        {props.state.model?.name ?? props.state.agentName}
      </button>
      <div class="flex-1" />
      <Show when={usage()}>
        {(u) => (
          <Tip
            class="flex items-center"
            label="Context used — tokens in the window, and how many fit"
          >
            <span
              data-testid="conductor-usage"
              class="flex items-center gap-1.5"
            >
              <span class="block h-1 w-16 rounded-full bg-surface-3 overflow-hidden">
                <span
                  class="block h-full bg-accent"
                  style={{
                    width: `${Math.min(100, Math.round((u().used / u().size) * 100))}%`,
                  }}
                />
              </span>
              <span class="text-fg-3">
                {tokens(u().used)}/{tokens(u().size)}
              </span>
            </span>
          </Tip>
        )}
      </Show>
      <Tip class="flex items-center" label="Conversation menu">
        <button
          type="button"
          ref={menuRef}
          data-testid="conductor-menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen()}
          class="text-fg-3 hover:text-fg cursor-pointer px-1 text-base/4"
          onClick={() => setMenuOpen(!menuOpen())}
        >
          ⋯
        </button>
      </Tip>
      <ConductorSettings
        options={props.state.options}
        triggerRef={modelRef}
        open={settingsOpen()}
        onOpenChange={setSettingsOpen}
      />
      <ConductorMenu
        rows={props.rows}
        triggerRef={menuRef}
        open={menuOpen()}
        onOpenChange={setMenuOpen}
        working={props.state.phase === "working"}
        signedIn={signedIn()}
        onSignIn={props.onSignIn}
        servers={props.state.servers}
      />
    </header>
  );
};

export default ConductorHeader;
