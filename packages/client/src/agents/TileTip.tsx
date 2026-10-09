/** The tile tip: a bar of kolu's own chrome between a tile's title bar and its
 *  terminal, suggesting the next move in THIS terminal — `cd` into a repo,
 *  launch an agent, try a skill at the agent's first prompt. The choice is
 *  `terminalTip`'s; this component feeds it the terminal's facts and paints the
 *  answer: a bold lead, the chip, the rest of the sentence, and where the
 *  suggestion comes from.
 *
 *  The chip is the one click target, and it types for you: rung 1 opens the
 *  recent repos (picking one types the `cd`), rung 2 types the harness and
 *  presses Enter, rung 3 inserts the skill into the agent's input with no
 *  Enter. Nothing is remembered: the bar opens while its state holds and folds
 *  away otherwise, and the terminal below gives up the bar's height meanwhile.
 *  Only where the ambient tips show at all (`showsAmbientTips`). */

import AgentDistroLogo from "@kolu/agent-distro/solid";
import { activeArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import { showsAmbientTips } from "../capabilities";
import { CD_REPO_GROUP } from "../palette/cdRepoGroup";
import { runAction } from "../runAction";
import { tileTipSentence } from "../settings/tips";
import { useTerminalCrud } from "../terminal/useTerminalCrud";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useCommandPalette } from "../useCommandPalette";
import { PLUGIN_SKILLS } from "./pluginSkills";
import {
  quiet,
  type TerminalTip,
  type Tip,
  type TipAction,
  terminalTip,
} from "./terminalTip";
import { agentDistroListing } from "./useAgentDistro";

/** One string per distinct tip, so an unchanged answer does not repaint. */
function tipKey(t: TerminalTip): string {
  switch (t.kind) {
    case "tip":
      return JSON.stringify([t.id, t.copy, t.action, t.source]);
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
    case "type":
      return action.enter
        ? `Type ${action.text} and press Enter`
        : `Type ${action.text.trim()} into the input`;
    default:
      throw new Error(`TileTip: unhandled action ${action satisfies never}`);
  }
}

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
      case "type":
        runAction(
          "type the tile tip",
          crud.handleTypeInto(props.id, action.text, action.enter),
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
            <button
              type="button"
              data-testid="tile-tip-chip"
              aria-label={chipLabel(t().action)}
              class="shrink-0 cursor-pointer rounded-[6px] px-[10px] py-[6px] font-mono text-[13px] font-semibold bg-[color-mix(in_srgb,currentColor_16%,transparent)] hover:bg-[color-mix(in_srgb,currentColor_24%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              onClick={(e) => {
                e.stopPropagation();
                act(t().action);
              }}
            >
              {t().copy.chip}
            </button>
            <span data-testid="tile-tip-rest" class="min-w-0 flex-1 truncate">
              {t().copy.rest}
            </span>
            <TipSourceMark source={t().source} />
          </div>
        )}
      </Show>
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
