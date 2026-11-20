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
  forwardReason: string | undefined;
  host: HostKey;
  serving?: { name: string; jump: () => void };
}> = (props) => {
  const [opening, setOpening] = createSignal(false);
  const forward = () => props.row.forward;

  const label = (): string => {
    const row = props.row;
    return row.kind === "orphan"
      ? "also forwarded on this host"
      : listenerLabel(row);
  };

  const detached = () =>
    props.row.kind === "port" && props.row.origin === "printed";

  const readyHref = (): string | undefined => {
    const decided = urlForPort({
      action: props.action,
      remotePort: props.row.port,
      doorPort: forward()?.localPort,
      pageHost: window.location.hostname,
    });
    return decided.kind === "ready" ? decided.url : undefined;
  };

  const openThroughForward = (): UiAction =>
    Effect.suspend(() => {
      if (opening()) return Effect.void;
      setOpening(true);
      const tab = claimBlankTab();
      return openThroughDoor({
        host: props.host,
        port: props.row.port,
        tab,
      }).pipe(Effect.ensuring(Effect.sync(() => setOpening(false))));
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
      <span
        class="shrink-0 rounded px-1.5 font-mono text-[11px] font-semibold tabular-nums"
        classList={{
          "bg-accent/10 text-fg": forward() !== undefined,
          "bg-surface-2/70 text-fg": forward() === undefined,
        }}
      >
        {props.row.port}
      </span>
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
