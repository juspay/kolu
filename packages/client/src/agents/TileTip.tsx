/** The tile tip: a bar of kolu's own chrome between a tile's title bar and its
 *  terminal, suggesting the next move in THIS terminal — `cd` into a repo,
 *  launch an agent, try a skill at the agent's first prompt. The choice is
 *  `terminalTip`'s; this component feeds it the terminal's facts and paints the
 *  answer: a bold lead, the chips, the rest of the sentence, and where the
 *  suggestion comes from.
 *
 *  The chips are the only click targets, and they type for you: rung 1's opens
 *  the recent repos (picking one types the `cd`), each of rung 2's types its
 *  harness and presses Enter, rung 3's inserts the skill into the agent's input
 *  with no Enter. Chips never wrap or get cut: those that do not fit go behind a
 *  `+N` chip, whose menu launches the rest. Nothing is remembered: the bar opens while its state holds and folds
 *  away otherwise, and the terminal below gives up the bar's height meanwhile.
 *  Only where the ambient tips show at all (`showsAmbientTips`). */

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
import { CD_REPO_GROUP } from "../palette/cdRepoGroup";
import { runAction } from "../runAction";
import { tileTipSentence } from "../settings/tips";
import { useTerminalCrud } from "../terminal/useTerminalCrud";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { OptionMenu } from "../ui/OptionMenu";
import { useCommandPalette } from "../useCommandPalette";
import { chipsThatFit } from "./chipFit";
import { PLUGIN_SKILLS } from "./pluginSkills";
import {
  quiet,
  type TerminalTip,
  type Tip,
  type TipAction,
  type TipChip,
  terminalTip,
} from "./terminalTip";
import { agentDistroListing } from "./useAgentDistro";

/** One string per distinct tip, so an unchanged answer does not repaint. */
function tipKey(t: TerminalTip): string {
  switch (t.kind) {
    case "tip":
      return JSON.stringify([t.id, t.copy, t.chips, t.source]);
    case "quiet":
      return "quiet";
    default:
      throw new Error(`TileTip: unhandled kind ${t satisfies never}`);
  }
}

/** What the chip says it does, for its `aria-label`. */
function chipLabel(action: TipAction): string {
  switch (action.kind) {
    case "pick-repo":
      return "Pick a recent repo to cd into";
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
const CHIP_BUTTON = `${CHIP} cursor-pointer bg-[color-mix(in_srgb,currentColor_16%,transparent)] hover:bg-[color-mix(in_srgb,currentColor_24%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current`;
/** The space between two chips, px. */
const CHIP_GAP = 6;

/** The bar's open and folded motion: 220ms, ease-out, off under reduced
 *  motion. */
const POP =
  "duration-[220ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none";

const TileTip: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const palette = useCommandPalette();

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
        skills: PLUGIN_SKILLS,
      });
    },
    quiet("not computed yet"),
    { equals: (a, b) => tipKey(a) === tipKey(b) },
  );

  const open = () => answer().kind === "tip";
  // The last tip shown, kept while the bar folds away so it leaves with its
  // words rather than going blank first.
  const shown = createMemo<Tip | undefined>((prev) => {
    const a = answer();
    return a.kind === "tip" ? a : prev;
  });

  const sentence = () => {
    const t = shown();
    return open() && t !== undefined ? tileTipSentence(t.copy) : undefined;
  };

  const act = (action: TipAction) => {
    switch (action.kind) {
      case "pick-repo":
        palette.openGroup(CD_REPO_GROUP);
        return;
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
      data-testid="tile-tip"
      data-open={open() ? "" : undefined}
      data-tip-id={open() ? shown()?.id : undefined}
      role="status"
      aria-label={sentence()}
      inert={!open()}
      class={`shrink-0 overflow-hidden select-none bg-accent text-surface-0 transition-[height] ${POP}`}
      style={{ height: open() ? "36px" : "0px" }}
      // The bar is chrome: a press on it neither selects nor drags the tile,
      // and does not take focus from the terminal (the chip types into it).
      // Native listeners, so the press stops here — Solid's delegated
      // handlers run at the document, after the tile's own listeners.
      on:pointerdown={(e) => e.stopPropagation()}
      on:mousedown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Show when={shown()}>
        {(t) => (
          <div
            class={`flex h-9 items-center gap-[10px] px-[14px] text-[14px] leading-none origin-top transition-[transform,opacity] ${POP}`}
            style={{
              opacity: open() ? 1 : 0,
              transform: open() ? "none" : "translateY(-60%) scaleY(.7)",
            }}
          >
            <span class="shrink-0 font-bold">{t().copy.lead}</span>
            <ChipRow
              chips={t().chips}
              fill={t().copy.rest === ""}
              onAct={act}
            />
            <Show when={t().copy.rest !== ""}>
              <span data-testid="tile-tip-rest" class="min-w-0 flex-1 truncate">
                {t().copy.rest}
              </span>
            </Show>
            <TipSourceMark source={t().source} />
          </div>
        )}
      </Show>
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
      props.chips.length <= 1
        ? props.chips.length
        : chipsThatFit(
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
  const label = (): string | null => {
    const s = props.source;
    switch (s.kind) {
      case "none":
        return null;
      case "agent-distro":
        return `agent-distro · ${s.profile}`;
      case "kolu-plugin":
        return "kolu plugin";
      default:
        throw new Error(`TileTip: unhandled source ${s satisfies never}`);
    }
  };
  return (
    <Show when={label()}>
      {(text) => (
        <span
          data-testid="tile-tip-source"
          class="flex shrink-0 items-center gap-1.5 text-[12px] opacity-80"
        >
          <AgentDistroLogo size={14} />
          {text()}
        </span>
      )}
    </Show>
  );
};

export default TileTip;
