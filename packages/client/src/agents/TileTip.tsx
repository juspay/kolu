/** The tip in a tile's title bar: what to do next in THIS terminal — `cd` into
 *  a repo, launch an agent, try a skill at the agent's first prompt. The choice
 *  is `terminalTip`'s; this component feeds it the terminal's facts and where
 *  the tip would show, and renders its answer. Nothing is remembered: the tip
 *  is there while its state holds and it can be seen, and gone otherwise. Only
 *  a live terminal has one, and only where the ambient tips show at all
 *  (`showsAmbientTips`). */

import { activeArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import type { TitleTipSlot } from "../canvas/CanvasTile";
import { showsAmbientTips } from "../capabilities";
import { useTerminalStore } from "../terminal/useTerminalStore";
import Tip from "../ui/Tip";
import { PLUGIN_SKILLS } from "./pluginSkills";
import { quiet, type TerminalTip, terminalTip } from "./terminalTip";
import { agentDistroListing } from "./useAgentDistro";

/** Same answer: same tip, same words (the sentence and the pill are built from
 *  the same facts, so the sentence stands for both). Any two quiets are the
 *  same: nothing renders. */
function sameTip(a: TerminalTip, b: TerminalTip): boolean {
  switch (a.kind) {
    case "tip":
      return (
        b.kind === "tip" && a.id === b.id && a.copy.sentence === b.copy.sentence
      );
    case "quiet":
      return b.kind === "quiet";
    default:
      throw new Error(`sameTip: unhandled kind ${a satisfies never}`);
  }
}

const TileTip: Component<{
  id: TerminalId;
  /** Where the tip would sit (see `CanvasTile`'s `renderTitleTip`). */
  slot: TitleTipSlot;
}> = (props) => {
  const store = useTerminalStore();

  const answer = createMemo(
    (): TerminalTip => {
      if (!showsAmbientTips()) return quiet("tips are not shown here");
      const m = activeArm(store.getMetadata(props.id));
      if (m === undefined) return quiet("not a live terminal");
      return terminalTip({
        place: {
          active: store.activeId() === props.id,
          onScreen: props.slot.onScreen(),
          slotPx: props.slot.px(),
        },
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
    { equals: sameTip },
  );

  const shown = () => {
    const a = answer();
    return a.kind === "tip" ? a : undefined;
  };

  // The title bar drags (pointerdown) and maximizes (double-click); the tip is
  // neither a drag handle nor a maximize target.
  const stop = (e: Event) => e.stopPropagation();

  return (
    <Show when={shown()}>
      {(tip) => (
        <Tip label={tip().copy.sentence} class="ml-2 flex min-w-0">
          <div
            data-testid="tile-tip"
            data-tip-id={tip().id}
            role="status"
            aria-label={tip().copy.sentence}
            class="flex h-7 min-w-0 items-center rounded-lg border border-accent/50 bg-accent/10 px-2 text-xs cursor-default"
            style={{ color: "var(--color-fg-2, currentColor)" }}
            onPointerDown={stop}
            onDblClick={stop}
          >
            <span class="min-w-0 truncate">
              <For each={tip().copy.parts}>
                {(part) =>
                  typeof part === "string" ? (
                    part
                  ) : (
                    <code
                      class="font-mono"
                      style={{ color: "var(--color-fg, currentColor)" }}
                    >
                      {part.code}
                    </code>
                  )
                }
              </For>
            </span>
          </div>
        </Tip>
      )}
    </Show>
  );
};

export default TileTip;
