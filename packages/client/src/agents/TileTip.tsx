/** The tile tip: a bar of kolu's own chrome between a tile's title bar and its
 *  terminal, suggesting the next move in THIS terminal — launch an agent, then
 *  try a skill once it has started. The choice is
 *  `terminalTip`'s; this component feeds it the terminal's facts and paints the
 *  answer: a bold lead, the chips, the rest of the sentence, and where the
 *  suggestion comes from.
 *
 *  The chips are the only click targets, and they type for you: each launch
 *  chip types its harness and presses Enter; the skill chip inserts the skill
 *  into the agent's input with no Enter. Chips never wrap or get cut: those
 *  that do not fit go behind a `+N` chip, whose menu launches the rest.
 *  The tip has two sizes, one preference for every tile (`tipBarCollapsed`): the full
 *  bar, which the terminal below gives up its height to, or a small tab with
 *  just the lead, hanging from the title bar's bottom-right edge over the
 *  terminal. The bar's chevron folds it to the tab; the tab opens the bar.
 *  Which tip shows is never remembered: the bar or tab appears while its
 *  state holds and goes otherwise. Only where the ambient tips show at all
 *  (`showsAmbientTips`). */

import AgentDistroLogo from "@kolu/agent-distro/solid";
import { activeArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { createResizeObserver } from "@solid-primitives/resize-observer";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { showsAmbientTips } from "../capabilities";
import { runAction } from "../runAction";
import { useTerminalCrud } from "../terminal/useTerminalCrud";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { ChevronDownIcon, ChevronUpIcon } from "../ui/Icons";
import { OptionMenu } from "../ui/OptionMenu";
import Tooltip from "../ui/Tip";
import { chipsThatFit } from "./chipFit";
import { PLUGIN_SKILLS } from "./pluginSkills";
import {
  quiet,
  type TerminalTip,
  type Tip,
  type TipAction,
  type TipChip,
  terminalTip,
  tileTipSentence,
} from "./terminalTip";
import { agentDistroListing } from "./useAgentDistro";
import { preferences, updatePreferences } from "../wire";

/** One string per distinct tip, so an unchanged answer does not repaint. */
function tipKey(t: TerminalTip): string {
  switch (t.kind) {
    case "tip":
      return JSON.stringify(t);
    case "quiet":
      return "quiet";
    default:
      throw new Error(`TileTip: unhandled kind ${t satisfies never}`);
  }
}

/** What the chip says it does, for its `aria-label`. */
function chipLabel(action: TipAction): string {
  switch (action.kind) {
    case "launch":
      return `Launch ${action.harness}`;
    case "insert":
      return `Type “${action.text.trim()}” into the input`;
    default:
      throw new Error(`TileTip: unhandled action ${action satisfies never}`);
  }
}

/** A chip's box. The measuring copies share it, so they measure true. */
const CHIP =
  "shrink-0 rounded-[6px] px-[10px] py-[6px] font-mono text-[13px] font-semibold whitespace-nowrap";
/** The chip is the button, so it is the brightest thing on the tip: solid
 *  accent. In light mode the plain accent holds no label at 4.5:1 (white on
 *  it is 4.3:1), so there it is deepened a little toward the type. */
const CHIP_BUTTON = `${CHIP} cursor-pointer bg-accent [:root:not(.dark)_&]:bg-[color-mix(in_oklch,var(--color-accent)_85%,var(--color-fg))] text-surface-0 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-1 focus-visible:ring-offset-surface-0`;
/** The space between two chips, px. */
const CHIP_GAP = 6;

/** The bar's open and folded motion: 220ms, ease-out, off under reduced
 *  motion. */
const POP =
  "duration-[220ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none";

/** Tone "Tint": the chrome's dark surface washed with the accent, the app's
 *  type on it, and a 4px accent edge on the left. The bar and the tab share
 *  it. */
const TINT =
  "bg-[color-mix(in_oklch,var(--color-accent)_22%,var(--color-surface-0))] text-fg border-l-4 border-accent";

/** The lead in the accent. In light mode the accent on the tint is 3.3:1, so
 *  there it is mixed toward the type to clear 4.5:1. */
const LEAD =
  "text-accent [:root:not(.dark)_&]:text-[color-mix(in_oklch,var(--color-accent)_70%,var(--color-fg))]";

const TileTip: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const crud = useTerminalCrud();

  const answer = createMemo(
    (): TerminalTip => {
      if (!showsAmbientTips()) return quiet("tips are not shown here");
      const m = activeArm(store.getMetadata(props.id));
      if (m === undefined) return quiet("not a live terminal");
      return terminalTip({
        active: store.activeId() === props.id,
        git: m.git,
        foreground: m.foreground,
        agent: m.agent,
        promptedAt: m.promptedAt,
        agents: m.agents,
        listing: agentDistroListing(),
        skill: PLUGIN_SKILLS[0],
      });
    },
    quiet("not computed yet"),
    { equals: (a, b) => tipKey(a) === tipKey(b) },
  );

  /** A tip to show, at either size. */
  const open = () => answer().kind === "tip";
  /** The size, one preference for every tile: the bar, or folded to a tab. */
  const collapsed = () => preferences().tipBarCollapsed;
  const setCollapsed = (tipBarCollapsed: boolean) =>
    updatePreferences({ tipBarCollapsed });
  const barOpen = () => open() && !collapsed();
  const tabOpen = () => open() && collapsed();
  // The last tip shown, kept while the bar or tab folds away so it leaves with
  // its words rather than going blank first.
  const shown = createMemo<Tip | undefined>((prev) => {
    const a = answer();
    return a.kind === "tip" ? a : prev;
  });

  const sentence = () => {
    const t = shown();
    return open() && t !== undefined ? tileTipSentence(t) : undefined;
  };

  const act = (action: TipAction) => {
    switch (action.kind) {
      case "launch":
        runAction(
          "launch an agent",
          crud.handleTypeInto(props.id, action.harness, true),
        );
        return;
      case "insert":
        runAction(
          "insert the tile tip",
          crud.handleTypeInto(props.id, action.text, false),
        );
        return;
      default:
        throw new Error(`TileTip: unhandled action ${action satisfies never}`);
    }
  };

  return (
    <div
      data-testid="tile-tip-slot"
      data-tip-id={open() ? shown()?.id : undefined}
      data-size={collapsed() ? "tab" : "bar"}
      role="status"
      aria-label={sentence()}
      // Above the terminal (the tab hangs over its top edge), below the find
      // bar (`z-10` in the body).
      class="relative z-[5] shrink-0 select-none"
      // The tip is chrome: a press on it neither selects nor drags the tile,
      // and does not take focus from the terminal (the chip types into it).
      // Native listeners, so the press stops here — Solid's delegated
      // handlers run at the document, after the tile's own listeners.
      on:pointerdown={(e) => e.stopPropagation()}
      on:mousedown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        data-testid="tile-tip"
        data-open={barOpen() ? "" : undefined}
        inert={!barOpen()}
        class={`overflow-hidden ${TINT} transition-[height] ${POP}`}
        style={{ height: barOpen() ? "36px" : "0px" }}
      >
        <Show when={shown()}>
          {(t) => (
            <div
              class={`flex h-9 items-center gap-[10px] pl-[10px] pr-[6px] text-[14px] leading-none origin-top transition-[transform,opacity] ${POP}`}
              style={{
                opacity: barOpen() ? 1 : 0,
                transform: barOpen() ? "none" : "translateY(-60%) scaleY(.7)",
              }}
            >
              <span class={`shrink-0 font-bold ${LEAD}`}>{t().lead}</span>
              <ChipRow chips={t().chips} fill={t().rest === ""} onAct={act} />
              <Show when={t().rest !== ""}>
                <span
                  data-testid="tile-tip-rest"
                  class="min-w-0 flex-1 truncate"
                >
                  {t().rest}
                </span>
              </Show>
              <TipSourceMark source={t().source} />
              <button
                type="button"
                data-testid="tile-tip-collapse"
                aria-label="Fold the tip to a tab"
                class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-fg-2 hover:bg-[color-mix(in_srgb,currentColor_16%,transparent)] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed(true);
                }}
              >
                <ChevronUpIcon class="size-4" />
              </button>
            </div>
          )}
        </Show>
      </div>
      {/* The tab hangs from the title bar's bottom edge, over the terminal:
       *  it slides down from under the title bar, inside a 22px clip. */}
      <div
        class="pointer-events-none absolute right-[14px] top-full h-[22px] overflow-hidden"
        inert={!tabOpen()}
      >
        <Show when={shown()}>
          {(t) => (
            <Tooltip
              // The clip around it takes no pointer; the trigger must, or the
              // tooltip never hears the hover.
              class="pointer-events-auto"
              label={tileTipSentence(t())}
            >
              <button
                type="button"
                data-testid="tile-tip-tab"
                data-open={tabOpen() ? "" : undefined}
                aria-label={`Open the tip: ${t().lead}`}
                class={`flex h-[22px] cursor-pointer items-center gap-1 rounded-b-[6px] pl-2 pr-1.5 text-[12px] font-bold leading-none ${TINT} transition-[transform,opacity] ${POP} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`}
                style={{
                  opacity: tabOpen() ? 1 : 0,
                  transform: tabOpen() ? "none" : "translateY(-100%)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed(false);
                }}
              >
                <span class={LEAD}>{t().lead}</span>
                <ChevronDownIcon class="size-3.5 text-fg-2" />
              </button>
            </Tooltip>
          )}
        </Show>
      </div>
    </div>
  );
};

/** The tip's chips, as many as fit whole; the rest behind a `+N` chip and its
 *  menu. With no sentence after them (`fill`) they take the bar's free width;
 *  otherwise the row hugs its chip. */
const ChipRow: Component<{
  chips: readonly TipChip[];
  fill: boolean;
  onAct: (action: TipAction) => void;
}> = (props) => {
  let row: HTMLDivElement | undefined;
  let measure: HTMLDivElement | undefined;
  let more: HTMLButtonElement | undefined;
  const [count, setCount] = createSignal(props.chips.length);
  const [menuOpen, setMenuOpen] = createSignal(false);

  // Measure every chip (and a `+N`) off-screen in the same box, and keep the
  // leading ones that fit the row's width.
  const fit = () => {
    // A row with no width has not been laid out yet: nothing to decide.
    if (row === undefined || measure === undefined || row.clientWidth === 0)
      return;
    const boxes = Array.from(measure.children) as HTMLElement[];
    const plus = boxes.pop();
    if (plus === undefined)
      throw new Error("TileTip: the measuring row has no +N chip");
    setCount(
      chipsThatFit(
        boxes.map((b) => b.offsetWidth),
        plus.offsetWidth,
        CHIP_GAP,
        row.clientWidth,
      ),
    );
  };
  // The row's width moves with the tile; the measured chips' with the font.
  createResizeObserver(() => [row, measure], fit);
  createEffect(on(() => props.chips, fit));

  const visible = () => props.chips.slice(0, count());
  const hidden = () => props.chips.slice(count());

  return (
    <div
      ref={row}
      data-testid="tile-tip-chips"
      class="relative flex items-center gap-[6px]"
      classList={{ "min-w-0 flex-1": props.fill, "shrink-0": !props.fill }}
    >
      <For each={visible()}>
        {(chip) => (
          <button
            type="button"
            data-testid="tile-tip-chip"
            aria-label={chipLabel(chip.action)}
            class={CHIP_BUTTON}
            onClick={(e) => {
              e.stopPropagation();
              props.onAct(chip.action);
            }}
          >
            {chip.label}
          </button>
        )}
      </For>
      <Show when={hidden().length > 0}>
        <button
          ref={more}
          type="button"
          data-testid="tile-tip-more"
          aria-label={`${hidden().length} more`}
          aria-haspopup="menu"
          aria-expanded={menuOpen()}
          class={CHIP_BUTTON}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
        >
          +{hidden().length}
        </button>
        <OptionMenu
          triggerRef={() => more}
          open={menuOpen}
          onDismiss={() => setMenuOpen(false)}
          anchor="bottom-end"
          options={hidden().map((c) => ({ value: c.label, label: c.label }))}
          value=""
          onSelect={(label) => {
            const chip = hidden().find((c) => c.label === label);
            if (chip === undefined)
              throw new Error(`TileTip: no hidden chip ${label}`);
            props.onAct(chip.action);
          }}
          testIdPrefix="tile-tip-more"
          flip
        />
      </Show>
      <div
        ref={measure}
        aria-hidden="true"
        class="invisible pointer-events-none absolute left-0 top-0 flex w-max"
      >
        <For each={props.chips}>
          {(chip) => <span class={CHIP}>{chip.label}</span>}
        </For>
        <span class={CHIP}>+{props.chips.length}</span>
      </div>
    </div>
  );
};

/** Where the suggestion comes from, at the bar's right end. */
const TipSourceMark: Component<{ source: Tip["source"] }> = (props) => {
  const label = (): string => {
    const s = props.source;
    switch (s.kind) {
      case "agent-distro":
        return `agent-distro · ${s.profile}`;
      case "kolu-plugin":
        return "kolu plugin";
      default:
        throw new Error(`TileTip: unhandled source ${s satisfies never}`);
    }
  };
  return (
    <span
      data-testid="tile-tip-source"
      class="flex shrink-0 items-center gap-1.5 text-[12px] text-fg-2"
    >
      {/* The logo marks agent-distro only, never the kolu plugin. */}
      <Show when={props.source.kind === "agent-distro"}>
        <AgentDistroLogo size={14} />
      </Show>
      {label()}
    </span>
  );
};

export default TileTip;
