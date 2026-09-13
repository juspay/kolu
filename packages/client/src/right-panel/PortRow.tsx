/** One row of the Inspector's ports section — a listener (this terminal's, or
 *  elsewhere on its host), or a door on this host with no listener behind it.
 *
 *  Hierarchy is deliberate and is the whole of the "look nicer" ask: the NUMBER
 *  and the program name are the subject and carry the weight; everything else —
 *  the door it answers on, copy, cancel — is quiet until the row is hovered or
 *  focused, and reachable by keyboard regardless. An orphan row is dimmer still,
 *  because it is a footnote about the host rather than an answer about this
 *  terminal.
 *
 *  It holds the one piece of state in this feature — "a forward is being opened
 *  right now" — and a component per row is how that stays per row rather than
 *  becoming a map keyed by port number.
 *
 *  Open flow is {@link claimBlankTab} · {@link openThroughDoor} — the shared
 *  fourth layer over {@link urlForPort} and `ensureDoor` — composed with this
 *  row's own busy signal; the printed-URL card composes the same two
 *  functions for its "forward & open".
 */

import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { type Component, createSignal, Show } from "solid-js";
import { DetachedBadge } from "../forwards/DetachedBadge";
import { ForwardControls, ForwardPill } from "../forwards/ForwardPill";
import type { PortAction } from "../forwards/portAction";
import {
  listenerLabel,
  type PortRow as PortRowData,
  rowGroup,
} from "../forwards/portRows";
import {
  claimBlankTab,
  openThroughDoor,
  urlForPort,
} from "../forwards/openPort";
import { ServingTerminalLink } from "../forwards/ServingTerminalLink";
import { runAction, type UiAction } from "../runAction";
import { OpenIcon } from "../ui/Icons";

export const PortRow: Component<{
  row: PortRowData;
  action: PortAction;
  /** Why this port is not open-as-is, when it is not. */
  forwardReason: string | undefined;
  /** Host this row's door would open on — the active host of the section. */
  host: HostKey;
  /** WHICH terminal serves this port, and how to get to it. Absent for this
   *  tile's own subtree ports (you are already there) and for a listener no
   *  terminal's subtree holds — a detached server, another user's socket. */
  serving?: { name: string; jump: () => void };
}> = (props) => {
  const [opening, setOpening] = createSignal(false);
  const forward = () => props.row.forward;

  /** What is behind the number, in words: who holds a listener
   *  ({@link listenerLabel}), and the door sentence for an orphan. */
  const label = (): string => {
    const row = props.row;
    return row.kind === "orphan"
      ? "also forwarded on this host"
      : listenerLabel(row);
  };

  /** A server this tile printed that NO terminal's subtree holds — the join only
   *  files a claimed listener as `printed` on that positive fact. */
  const detached = () =>
    props.row.kind === "port" && props.row.origin === "printed";

  /** Ready URL when no door is needed, or when one is already open. */
  const readyHref = (): string | undefined => {
    const decided = urlForPort({
      action: props.action,
      remotePort: props.row.port,
      doorPort: forward()?.localPort,
      pageHost: window.location.hostname,
    });
    return decided.kind === "ready" ? decided.url : undefined;
  };

  /** Open the door, then the page — {@link claimBlankTab} · {@link openThroughDoor}
   *  composed at this edge with the row's own busy signal; the printed-URL
   *  card composes the same two functions for its own "forward & open". */
  const openThroughForward = (): UiAction =>
    Effect.suspend(() => {
      if (opening()) return Effect.void;
      setOpening(true);
      // `runAction` forks synchronously up to the first suspension, and
      // `Effect.suspend`'s body runs there, so the popup blocker still sees
      // this claim as descending from the click.
      const tab = claimBlankTab();
      return openThroughDoor({
        host: props.host,
        port: props.row.port,
        tab,
      }).pipe(
        // The `finally` of the old shape, and now total: a finalizer runs on
        // interruption too, so a row unmounted mid-open does not stay "opening".
        Effect.ensuring(Effect.sync(() => setOpening(false))),
      );
    });

  return (
    <div
      class="group/fwd group/port flex items-baseline gap-2 rounded px-1 py-0.5 -mx-1 text-[11px] leading-snug transition-colors hover:bg-surface-2/60"
      classList={{ "opacity-70": props.row.kind === "orphan" }}
      data-testid="inspector-port-row"
      data-port={props.row.port}
      data-kind={props.row.kind}
      data-group={rowGroup(props.row)}
      data-forwarded={forward() ? "yes" : undefined}
      data-origin={forward()?.origin}
      data-orphan={props.row.kind === "orphan" ? "" : undefined}
    >
      {/* The subject wears a chip: the number carries the weight, and an open
       *  door tints it accent so "already reachable" reads before the text. */}
      <span
        class="shrink-0 rounded px-1.5 font-mono text-[11px] font-semibold tabular-nums"
        classList={{
          "bg-accent/10 text-fg": forward() !== undefined,
          "bg-surface-2/70 text-fg": forward() === undefined,
        }}
      >
        {props.row.port}
      </span>
      {/* What is behind the number — and, in the trailing group, the way to it.
       *  That group is where the question is sharpest: a port in it is by
       *  definition served by some terminal OTHER than the one on screen, so the
       *  row NAMES that terminal instead of saying "this host" and leaving the
       *  user to guess which of its terminals. When the join finds nothing the
       *  old sentence stands, unlinked: honest copy about a door whose server
       *  kolu cannot point at. */}
      <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
        <Show when={detached()}>
          <DetachedBadge testid="inspector-port-detached" />
        </Show>
        <Show
          when={props.serving}
          fallback={
            <span
              class="min-w-0 truncate font-mono text-fg-3/80"
              classList={{ italic: props.row.kind === "unclaimed" }}
              title={label()}
              data-testid="inspector-port-label"
            >
              {label()}
            </span>
          }
        >
          {(s) => (
            <span class="min-w-0 truncate" title={label()}>
              <ServingTerminalLink name={s().name} onJump={s().jump} />
            </span>
          )}
        </Show>
      </span>

      {/* The door — the same pill the host dropdown shows, not a link here
       *  because this row already carries its own open affordance below. */}
      <Show when={forward()}>
        {(f) => (
          <ForwardPill forward={f()} testid="inspector-port-forward-badge" />
        )}
      </Show>

      <span class="ml-auto flex shrink-0 items-baseline gap-1.5">
        <Show
          when={props.action.kind !== "none"}
          fallback={
            <span
              class="text-[10px] italic text-fg-3/50"
              data-testid="inspector-port-no-mechanism"
              data-port={props.row.port}
              title={props.forwardReason}
            >
              not reachable
            </span>
          }
        >
          <Show
            when={readyHref()}
            fallback={
              <button
                type="button"
                class="inline-flex items-center gap-1 text-fg-3/70 transition-colors hover:text-accent hover:underline focus-visible:text-accent disabled:opacity-50 motion-reduce:transition-none"
                data-testid="inspector-port-forward-open"
                data-port={props.row.port}
                disabled={opening()}
                title={props.forwardReason}
                onClick={() =>
                  runAction("open through forward", openThroughForward())
                }
              >
                <OpenIcon class="h-3 w-3" />
                {opening() ? "opening…" : "forward & open"}
              </button>
            }
          >
            {(href) => (
              <a
                href={href()}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-accent hover:underline"
                data-testid="inspector-port-open"
                data-port={props.row.port}
              >
                <OpenIcon class="h-3 w-3" />
                open
              </a>
            )}
          </Show>
        </Show>

        <Show when={forward()}>{(f) => <ForwardControls forward={f()} />}</Show>
      </span>
    </div>
  );
};
