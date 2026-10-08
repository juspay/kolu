/** The tip in a tile's title bar: what to do next in THIS terminal — `cd` into
 *  a repo, launch an agent, try a skill at the agent's first prompt. The choice
 *  is `terminalTip`'s; this component feeds it the terminal's facts and where
 *  the tip would show, and owns the one piece of state the fold cannot: which
 *  tip this tile is showing.
 *
 *  A tip is marked seen in the effect that first renders it, so it never shows
 *  again, and it stays until its fact changes or × is pressed. Every fact that
 *  decides "would anyone see it" is the fold's — the active tile, a title bar
 *  wide enough, the saved seen-list loaded — so a tip the user cannot see is
 *  quiet, and a quiet tip is never marked. Only a live terminal has one, and only
 *  where the ambient tips show at all (`showsAmbientTips`). */

import { activeArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { showsAmbientTips } from "../capabilities";
import { type TipId, tileTipText } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { useTerminalStore } from "../terminal/useTerminalStore";
import Tip from "../ui/Tip";
import { PLUGIN_SKILLS } from "./pluginSkills";
import { type TerminalTip, terminalTip } from "./terminalTip";
import { agentDistroListing } from "./useAgentDistro";

const QUIET: TerminalTip = { kind: "quiet", why: "tips are not shown here" };

/** Same answer: same kind, same tip, same words. */
function sameTip(a: TerminalTip, b: TerminalTip): boolean {
  if (a.kind !== "tip" || b.kind !== "tip") return a.kind === b.kind;
  return a.id === b.id && tileTipText(a.parts) === tileTipText(b.parts);
}

const TileTip: Component<{
  id: TerminalId;
  /** The title bar's measured width (`null` until measured). */
  titleBarPx: Accessor<number | null>;
}> = (props) => {
  const store = useTerminalStore();
  const { hasSeen, markSeen, seenTipsLoaded } = useTips();
  const [showing, setShowing] = createSignal<TipId | null>(null);

  const answer = createMemo(
    (): TerminalTip => {
      if (!showsAmbientTips()) return QUIET;
      const m = activeArm(store.getMetadata(props.id));
      if (m === undefined) return { kind: "quiet", why: "not a live terminal" };
      return terminalTip(
        {
          place: {
            seenTipsLoaded: seenTipsLoaded(),
            active: store.activeId() === props.id,
            titleBarPx: props.titleBarPx(),
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
    QUIET,
    { equals: sameTip },
  );

  createEffect(
    on(answer, (a) => {
      if (a.kind !== "tip") {
        setShowing(null);
        return;
      }
      if (a.id === showing()) return;
      // A different tip (or none yet): the old one's fact changed, so it leaves;
      // the new one renders now and is marked seen as it does.
      setShowing(a.id);
      markSeen(a.id);
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
        <Tip
          label={tileTipText(tip().parts)}
          class="ml-2 flex min-w-0 max-w-[45cqw]"
        >
          <div
            data-testid="tile-tip"
            data-tip-id={tip().id}
            role="status"
            class="flex h-7 min-w-0 items-center gap-1 rounded-lg border border-accent/50 bg-accent/10 pl-2 pr-0.5 text-xs cursor-default"
            style={{ color: "var(--color-fg-2, currentColor)" }}
            onPointerDown={stop}
            onDblClick={stop}
          >
            <span class="min-w-0 truncate">
              <For each={tip().parts}>
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
