/** One row of the Inspector's ports section — a port this terminal serves, or a
 *  door on this host with no scanned port behind it.
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
 *  Open flow is the three-layer composition ({@link urlForPort} ·
 *  {@link ensureDoor} · `window.open` at this edge) — the same pieces the
 *  printed-URL card and "copy door URL" use.
 */

import type { HostKey } from "kolu-common/hostKey";
import { type Component, createSignal, Show } from "solid-js";
import { toast } from "solid-sonner";
import { ForwardControls, ForwardPill } from "../forwards/ForwardPill";
import type { PortAction } from "../forwards/portAction";
import type { PortRow as PortRowData } from "../forwards/portRows";
import { ensureDoor, urlForPort } from "../forwards/openPort";
import { ServingTerminalLink } from "../forwards/ServingTerminalLink";
import { OpenIcon } from "../ui/Icons";

export const PortRow: Component<{
  row: PortRowData;
  action: PortAction;
  /** Why this port is not open-as-is, when it is not. */
  forwardReason: string | undefined;
  /** Host this row's door would open on — the active host of the section. */
  host: HostKey;
  /** WHICH terminal serves this port, and how to get to it — the trailing
   *  group's affordance. Absent for a main port row (you are already there) and
   *  for a forward no terminal serves. */
  serving?: { name: string; jump: () => void };
}> = (props) => {
  const [opening, setOpening] = createSignal(false);
  const forward = () => props.row.forward;

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

  /** Open the door, then the page. The window is opened SYNCHRONOUSLY inside the
   *  click — before the await — because a popup blocker judges a `window.open`
   *  by whether it descends from a user gesture, and one issued after an await
   *  does not. So the tab is claimed first and pointed at the URL once the door
   *  is up; a failure closes it again rather than leaving a blank tab behind.
   *
   *  Deliberately NOT `"noopener"` in the feature string, and the `opener = null`
   *  below is why: `window.open` with `noopener` returns **null** by spec, so
   *  there would be no handle to navigate once the forward is up — the flag and
   *  this flow are mutually exclusive. Severing `opener` on the blank tab (while
   *  it is still same-origin `about:blank`, the one moment this is possible)
   *  reaches the same posture the anchor path gets from `rel="noopener"`. */
  const openThroughForward = async (): Promise<void> => {
    if (opening()) return;
    setOpening(true);
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    try {
      const localPort = await ensureDoor({
        host: props.host,
        port: props.row.port,
        origin: "auto",
      });
      const decided = urlForPort({
        action: { kind: "forward" },
        remotePort: props.row.port,
        doorPort: localPort,
        pageHost: window.location.hostname,
      });
      if (decided.kind !== "ready") {
        tab?.close();
        return;
      }
      if (tab === null) {
        toast.info(`Forward open on port ${localPort}`, {
          description: "Your browser blocked the new tab.",
        });
        return;
      }
      tab.location.replace(decided.url);
    } catch (err) {
      tab?.close();
      toast.error(
        `Could not forward port ${props.row.port}: ${(err as Error).message}`,
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <div
      class="group/fwd group/port flex items-baseline gap-2 rounded px-1 py-0.5 -mx-1 text-[11px] leading-snug transition-colors hover:bg-surface-2/60"
      classList={{ "opacity-70": props.row.kind === "orphan" }}
      data-testid="inspector-port-row"
      data-port={props.row.port}
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
      <Show
        when={props.serving}
        fallback={
          <span class="min-w-0 flex-1 truncate font-mono text-fg-3/80">
            {props.row.kind === "port"
              ? props.row.info.name
              : "also forwarded on this host"}
          </span>
        }
      >
        {(s) => (
          <span class="min-w-0 flex-1 truncate">
            <ServingTerminalLink name={s().name} onJump={s().jump} />
          </span>
        )}
      </Show>

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
                onClick={() => void openThroughForward()}
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
