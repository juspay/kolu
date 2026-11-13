/** The conversation's one-line readout: who it is signed in as, what it is
 *  running on, how full its context is — and the `⋯` that opens everything
 *  else it can be asked. What it is DOING is not here; it is the status line
 *  above the composer.
 *
 *  The context meter draws a FRACTION — `148k/1M` — never a percentage. A
 *  window is not a constant (200k and 1M are both ordinary, and a session moves
 *  between them when the model does), so "80%" would read the same either way
 *  while meaning quite different amounts of work left. The denominator is the
 *  half you act on.
 *
 *  TWO POPOVERS, two triggers, two subjects: the model name opens the
 *  ADAPTER'S settings (every row there is an option the agent advertised),
 *  and the `⋯` opens what kolu can do to the conversation itself. Neither
 *  acts on its own press. */

import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { type Component, createSignal, Show } from "solid-js";
import Tip from "../ui/Tip";
import { isDesktop } from "../useMobile";
import ConductorMenu from "./ConductorMenu";
import ConductorSettings from "./ConductorSettings";

/** Tokens at the scale a context window is discussed in. Not bytes — these are
 *  the agent's own units, and `148k` is how a person says the number. */
function tokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  const millions = count / 1_000_000;
  return `${millions >= 10 || Number.isInteger(millions) ? Math.round(millions) : millions.toFixed(1)}M`;
}

/** NO PHASE CHIP HERE. What the conversation is doing moved to the ONE status
 *  line directly above the composer (`ConductorStatus`), where a person is
 *  looking when they are about to speak to it — and where there is room to say
 *  what it is doing and for how long, not only one word. Two readouts of one
 *  fact, a column apart, is how a header chip comes to say `working` over a
 *  conversation that finished. */

const ConductorHeader: Component<{
  state: ConductorState;
  /** The transcript as it is drawn, for the menu's `Copy transcript`. */
  rows: readonly ConductorRow[];
  /** Opens the sign-in row from the menu's `Sign in…`. */
  onSignIn: () => void;
}> = (props) => {
  let modelRef!: HTMLButtonElement;
  let menuRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const usage = () => props.state.usage;
  const identity = () => props.state.identity;
  /** KNOWN signed in. The cell's rule is that silence is not logged out, so
   *  `null` leaves `Sign in…` on the menu — an agent that never said is an
   *  agent a person may still have to sign in. */
  const signedIn = () => {
    const who = identity();
    return who !== null && who.kind !== "none";
  };

  return (
    /* ONE TYPE SIZE AND ONE LINE-HEIGHT FOR THE WHOLE ROW, set here and
       inherited by every child (`leading-4` is a LENGTH, so it does not
       re-scale per font-size the way an inherited unitless 1.5 does).

       This row read as five different heights because each child carried its
       own size and its own leading, and two of them sit inside a `Tip`
       wrapper whose line box was struck at the row's old 16px/24px: a 10px
       pill baseline-aligned inside a 16px strut sits ~3px BELOW the centre of
       everything beside it. One inherited line-height removes the strut
       mismatch; `items-center` then centres every box on one line. A child
       that needs its own size (the mark) may still set one — what it must
       never set is its own line-height. */
    <header class="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-edge font-mono text-[0.65rem] leading-4">
      {/* The mark and the name, on a desktop only: on a phone the pull handle
          right above already reads `◆ Conductor`, and a screen that says the
          same name twice reads as two things. */}
      <Show when={isDesktop()}>
        <span
          data-testid="conductor-header-name"
          class="flex items-center gap-2.5"
        >
          {/* Its own SIZE (a mark reads small at the row's 10px), never its own
              leading — `/4` holds the row's 16px line box, which is what keeps
              its box the same height as the words beside it. A bare `text-sm`
              would ship Tailwind's own 20px leading and quietly make this one
              child a taller line than the row. */}
          <span class="text-busy text-sm/4">◆</span>
          <span class="font-extrabold tracking-[0.14em] text-fg-2">
            CONDUCTOR
          </span>
        </span>
      </Show>
      {/* Said once here, beside the name: the surface you are IN has to say it
          too, or a reader who arrived by ⌘⇧O never passed the chrome-bar tag.
          Not a phase chip — what it is alpha about does not change while the
          conversation runs. */}
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
      {/* The phase chip stood here — see the note above this component. */}
      {/* ABSENT when the agent said nothing. Silence is not "logged out" — a
          known logged-out state arrives as its own payload and says so here. */}
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
      {/* The agent's name stands in until it has said which model it is on —
          the control is the session's settings door either way, and a door
          that appears only once a model is known is a door you cannot find
          when the model is the thing you wanted to set.

          Its dashed line is an UNDERLINE, not a bottom border: a border is
          part of the box, so it pushed the words half a pixel up off the row's
          centre line. The affordance has to be free of the layout. */}
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
      {/* A MENU AFFORDANCE, and nothing else. This button used to start a
          new session on the press — a `⋯` that acted, which is the one thing
          a `⋯` may never do.

          Its own size, like the mark — a `⋯` at the row's 10px is a speck; the
          row's `leading-4` keeps its box the same height as the rest. */}
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
      />
    </header>
  );
};

export default ConductorHeader;
