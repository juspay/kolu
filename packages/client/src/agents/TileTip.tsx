/** The tip in a tile's title bar: what to do next in THIS terminal — `cd` into
 *  a repo, launch an agent, try a skill at the agent's first prompt. The choice
 *  is `terminalTip`'s; this component feeds it the terminal's facts and where
 *  the tip would show, and owns the one piece of state the fold cannot: which
 *  tip this tile is showing.
 *
 *  A tip is marked seen in the effect that first renders it, so it never shows
 *  again. It stays until its STATE moves on (the fold says `quiet`, or names a
 *  different tip) or × is pressed. While nobody could see it — another tile
 *  active, off-screen, too narrow, a command in front — the fold says `hidden`:
 *  the slot is empty, the tip is kept, and it comes back when it can be seen.
 *  A tip that was never shown is never marked. Only a live terminal has one,
 *  and only where the ambient tips show at all (`showsAmbientTips`). */

import { activeArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import type { TitleTipSlot } from "../canvas/CanvasTile";
import { showsAmbientTips } from "../capabilities";
import { type TipId, tileTipText } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { useTerminalStore } from "../terminal/useTerminalStore";
import Tip from "../ui/Tip";
import { PLUGIN_SKILLS } from "./pluginSkills";
import { type TerminalTip, terminalTip } from "./terminalTip";
import { agentDistroListing } from "./useAgentDistro";

/** Same answer: same kind, same tip, same words. */
function sameTip(a: TerminalTip, b: TerminalTip): boolean {
  switch (a.kind) {
    case "tip":
      return (
        b.kind === "tip" &&
        a.id === b.id &&
        a.copy.sentence === b.copy.sentence &&
        tileTipText(a.copy.parts) === tileTipText(b.copy.parts)
      );
    case "hidden":
      return b.kind === "hidden" && a.id === b.id;
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
  const { hasSeen, markSeen, seenTipsLoaded } = useTips();
  const [showing, setShowing] = createSignal<TipId | null>(null);

  const answer = createMemo(
    (): TerminalTip => {
      // Neither says anything about the terminal's state, so a shown tip is
      // kept through them (`id: null` — which tip is not known here).
      if (!showsAmbientTips())
        return { kind: "hidden", id: null, why: "tips are not shown here" };
      const m = activeArm(store.getMetadata(props.id));
      if (m === undefined)
        return { kind: "hidden", id: null, why: "not a live terminal" };
      return terminalTip(
        {
          place: {
            seenTipsLoaded: seenTipsLoaded(),
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
        },
        { has: hasSeen },
        showing(),
      );
    },
    { kind: "quiet", why: "not computed yet" },
    { equals: sameTip },
  );

  createEffect(
    on(answer, (a) => {
      switch (a.kind) {
        case "tip":
          if (a.id === showing()) return;
          // A different tip (or none yet): the old one's fact changed, so it
          // leaves; the new one renders now and is marked seen as it does.
          setShowing(a.id);
          markSeen(a.id);
          return;
        case "hidden":
          // Out of sight: the shown tip is kept — unless the state now calls
          // for a different tip, which means the shown one's fact moved on.
          if (a.id !== null && a.id !== showing()) setShowing(null);
          return;
        case "quiet":
          setShowing(null);
          return;
        default:
          throw new Error(`TileTip: unhandled answer ${a satisfies never}`);
      }
    }),
  );

  const shown = () => {
    const a = answer();
    return a.kind === "tip" && a.id === showing() ? a : undefined;
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
            class="flex h-7 min-w-0 items-center gap-1 rounded-lg border border-accent/50 bg-accent/10 pl-2 pr-0.5 text-xs cursor-default"
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
            <button
              type="button"
              data-testid="tile-tip-dismiss"
              aria-label="Dismiss tip"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-sm leading-none text-accent hover:bg-accent/20 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onPointerDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                setShowing(null);
              }}
            >
              ×
            </button>
          </div>
        </Tip>
      )}
    </Show>
  );
};

export default TileTip;
