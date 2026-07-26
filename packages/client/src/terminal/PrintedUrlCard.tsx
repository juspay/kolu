/**
 * The PRT4 join card — a small Solid popover at the click coordinates.
 *
 * Same species as the host diagnostics popover (Portal + surface chrome +
 * outside-click / Escape dismiss). LIVE: the join is a reactive derivation over
 * the ports and forwards stores, evaluated only while the card is open, so it
 * upgrades when a listener appears and degrades when auto-cancel closes a door.
 */

import { activeArm } from "@kolu/padi/surface";
import { parseLoopbackUrl } from "@kolu/url-shape";
import { portReach } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "solid-sonner";
import { FORWARD_PILL } from "../forwards/forwardTone";
import {
  joinPrintedUrl,
  tilePortsObservation,
} from "../forwards/joinPrintedUrl";
import { ensureDoor, urlForPort } from "../forwards/openPort";
import { portAction } from "../forwards/portAction";
import { forwardsForHost, viewerHost } from "../forwards/useForwards";
import { hostDisplayName, sameHost } from "../host/hostChipTone";
import { isActiveHostLocal } from "../kaval/useDaemonStatus";
import { writeTextToClipboard } from "../ui/clipboard";
import { surface } from "../ui/Surface";
import { useServerIdentity } from "../useServerIdentity";
import { activeHost } from "../wire";
import { openRawUrl } from "./handleWebLink";
import {
  closePrintedUrlCard,
  type PrintedUrlCardTarget,
} from "./printedUrlCardState";
import { useTerminalStore } from "./useTerminalStore";

const CARD_WIDTH = 320;
const CARD_GAP = 8;

const cardChrome = surface({
  radius: "lg",
  shadow: "light",
  portalled: true,
});

function clampPos(
  x: number,
  y: number,
  w: number,
  h: number,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  let top = y + CARD_GAP;
  if (left + w + 8 > vw) left = Math.max(8, vw - w - 8);
  if (top + h + 8 > vh) top = Math.max(8, y - h - CARD_GAP);
  return { top, left };
}

/** The join card for one printed URL — mounted by the owning Terminal. */
export const PrintedUrlCard: Component<{ target: PrintedUrlCardTarget }> = (
  props,
) => {
  const store = useTerminalStore();
  const { hostname } = useServerIdentity();
  const [busy, setBusy] = createSignal(false);
  let panelEl: HTMLElement | undefined;

  const host = () => activeHost();
  const hostName = () => hostDisplayName(host(), hostname());

  /** LIVE tile observation — re-reads the store every tick the card is open. */
  const observation = createMemo(() =>
    tilePortsObservation(
      store.getTilePaneIds(props.target.terminalId).flatMap((id) => {
        const arm = activeArm(store.getMetadata(id));
        return arm === undefined ? [] : [arm.ports];
      }),
    ),
  );

  const join = createMemo(() =>
    joinPrintedUrl({
      uri: props.target.uri,
      observation: observation(),
      forwards: forwardsForHost(host()),
    }),
  );

  const viewerOnHost = createMemo(() => {
    const v = viewerHost();
    return v !== null && sameHost(v, host());
  });

  const remainder = () => ({
    pathname: props.target.pathname,
    search: props.target.search,
    hash: props.target.hash,
  });

  const actionForJoined = () => {
    const j = join();
    if (j.kind !== "joined") return undefined;
    const reach = portReach({
      scope: j.info.scope,
      onKoluHost: isActiveHostLocal(),
    });
    return portAction({ reach, viewerOnHost: viewerOnHost() });
  };

  const pos = () => clampPos(props.target.x, props.target.y, CARD_WIDTH, 160);

  // Outside click + Escape — same discipline as useAnchoredPopover, but the
  // "trigger" is a coordinate rather than an element.
  createEffect(() => {
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node;
      if (panelEl?.contains(node)) return;
      closePrintedUrlCard();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePrintedUrlCard();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    });
  });

  /** Compose decide · act · effect for a joined open. */
  const forwardAndOpen = async (): Promise<void> => {
    const action = actionForJoined();
    if (action === undefined || action.kind === "none") return;
    if (busy()) return;
    setBusy(true);
    const j = join();
    const doorPort = j.kind === "joined" ? j.forward?.localPort : undefined;
    const first = urlForPort({
      action,
      remotePort: props.target.port,
      doorPort,
      pageHost: window.location.hostname,
      remainder: remainder(),
    });
    if (first.kind === "ready") {
      openRawUrl(first.url);
      setBusy(false);
      return;
    }
    if (first.kind === "none") {
      setBusy(false);
      return;
    }
    // needs-door — claim the tab before the await (popup-blocker rule).
    const tab = window.open("", "_blank");
    if (tab !== null) tab.opener = null;
    try {
      const localPort = await ensureDoor({
        host: host(),
        port: props.target.port,
        origin: "auto",
      });
      const ready = urlForPort({
        action: { kind: "forward" },
        remotePort: props.target.port,
        doorPort: localPort,
        pageHost: window.location.hostname,
        remainder: remainder(),
      });
      if (ready.kind !== "ready") {
        tab?.close();
        return;
      }
      if (tab === null) {
        toast.info(`Forward open on port ${localPort}`, {
          description: "Your browser blocked the new tab.",
        });
        return;
      }
      tab.location.replace(ready.url);
    } catch (err) {
      tab?.close();
      toast.error(
        `Could not forward port ${props.target.port}: ${(err as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  /** Copy door URL = decision + act, no effect. */
  const copyDoorUrl = async (): Promise<void> => {
    const action = actionForJoined();
    if (action === undefined || action.kind === "none") return;
    if (busy()) return;
    setBusy(true);
    try {
      const j = join();
      let doorPort = j.kind === "joined" ? j.forward?.localPort : undefined;
      let decided = urlForPort({
        action,
        remotePort: props.target.port,
        doorPort,
        pageHost: window.location.hostname,
        remainder: remainder(),
      });
      if (decided.kind === "needs-door") {
        doorPort = await ensureDoor({
          host: host(),
          port: props.target.port,
          origin: "auto",
        });
        decided = urlForPort({
          action: { kind: "forward" },
          remotePort: props.target.port,
          doorPort,
          pageHost: window.location.hostname,
          remainder: remainder(),
        });
      }
      if (decided.kind !== "ready") return;
      await writeTextToClipboard(decided.url);
      toast.success("Door URL copied");
    } catch (err) {
      toast.error(`Could not copy: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // External should never open the card — but if the target drifts, dismiss.
  createEffect(() => {
    if (parseLoopbackUrl(props.target.uri) === null) closePrintedUrlCard();
  });

  return (
    <Portal>
      <div
        ref={(el) => {
          panelEl = el;
        }}
        role="dialog"
        aria-label="Printed URL"
        data-testid="printed-url-card"
        data-join={join().kind}
        data-port={props.target.port}
        class={`${cardChrome.class} z-50 fixed p-3 font-sans text-[12px] leading-snug`}
        style={{
          ...cardChrome.style,
          top: `${pos().top}px`,
          left: `${pos().left}px`,
          width: `${CARD_WIDTH}px`,
          "pointer-events": "auto",
        }}
      >
        <Switch>
          <Match when={join().kind === "joined" ? join() : undefined}>
            {(j) => {
              const joined = () => {
                const v = j();
                if (v.kind !== "joined") throw new Error("unreachable");
                return v;
              };
              const action = () => actionForJoined();
              const primaryLabel = () => {
                const a = action();
                if (a === undefined || a.kind === "none") return null;
                if (a.kind === "viewer" || a.kind === "here") return "↗ open";
                if (joined().forward !== undefined) return "↗ open";
                return "⇄ forward & open ↗";
              };
              return (
                <>
                  <div class="flex items-center gap-2 mb-1">
                    <span
                      class={`${FORWARD_PILL} text-[11px]`}
                      data-testid="printed-url-pill"
                    >
                      ⇄ {joined().port}
                    </span>
                    <span class="min-w-0 truncate text-fg font-medium">
                      {joined().forward !== undefined
                        ? "door already open"
                        : "this terminal serves it"}
                      <span class="text-fg-3 font-normal font-mono">
                        {" "}
                        · {joined().info.name}
                      </span>
                    </span>
                  </div>
                  <p class="text-fg-3 text-[11px] mb-2">
                    {action()?.kind === "viewer" ? (
                      <>
                        You are on this host —{" "}
                        <span class="font-mono">localhost</span> is correct
                        here.
                      </>
                    ) : joined().forward !== undefined ? (
                      <>
                        Already forwarded — the click opens through the door on{" "}
                        <span class="font-mono">{hostName()}</span>, path
                        included.
                      </>
                    ) : (
                      <>
                        &quot;localhost&quot; here means{" "}
                        <span class="font-mono font-medium text-fg">
                          {hostName()}
                        </span>{" "}
                        — opens via a door on the kolu host, path included.
                      </>
                    )}
                  </p>
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Show when={primaryLabel()}>
                      {(label) => (
                        <button
                          type="button"
                          class="font-semibold text-teal-700 dark:text-teal-300 hover:underline disabled:opacity-50"
                          data-testid="printed-url-forward-open"
                          disabled={busy()}
                          onClick={() => void forwardAndOpen()}
                        >
                          {label()}
                        </button>
                      )}
                    </Show>
                    <button
                      type="button"
                      class="text-fg-3 hover:text-fg disabled:opacity-50"
                      data-testid="printed-url-copy-door"
                      disabled={busy() || action()?.kind === "none"}
                      onClick={() => void copyDoorUrl()}
                    >
                      ⧉ copy door URL
                    </button>
                  </div>
                </>
              );
            }}
          </Match>

          <Match when={join().kind === "unbacked"}>
            <div class="flex items-center gap-2 mb-1">
              <span
                class="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-800 dark:text-amber-300"
                data-testid="printed-url-pill"
              >
                {props.target.port}?
              </span>
              <span class="text-fg font-medium">nothing is listening yet</span>
            </div>
            <p class="text-fg-3 text-[11px] mb-2">
              The scan doesn&apos;t see port{" "}
              <span class="font-mono">{props.target.port}</span> on this
              terminal — the server may still be starting, or it printed a
              promise it hasn&apos;t kept.
            </p>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                class="font-semibold text-fg hover:underline"
                data-testid="printed-url-open-raw"
                onClick={() => openRawUrl(props.target.uri)}
              >
                ↗ open raw URL
              </button>
              <button
                type="button"
                class="text-fg-3 hover:text-fg"
                data-testid="printed-url-copy-raw"
                onClick={() =>
                  void writeTextToClipboard(props.target.uri).then(
                    () => toast.success("URL copied"),
                    (err: Error) =>
                      toast.error(`Could not copy: ${err.message}`),
                  )
                }
              >
                ⧉ copy
              </button>
            </div>
            <p class="text-fg-3/70 text-[10px] mt-2">
              the chip appears in Ports the moment the listener is real
            </p>
          </Match>

          <Match when={join().kind === "blind"}>
            <div class="flex items-center gap-2 mb-1">
              <span
                class="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-800 dark:text-amber-300"
                data-testid="printed-url-pill"
              >
                {props.target.port}?
              </span>
              <span class="text-fg font-medium">can&apos;t tell right now</span>
            </div>
            <p class="text-fg-3 text-[11px] mb-2">
              The scan couldn&apos;t look at this terminal&apos;s ports —
              &quot;unknown&quot; is never &quot;no&quot;.
            </p>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                class="font-semibold text-fg hover:underline"
                data-testid="printed-url-open-raw"
                onClick={() => openRawUrl(props.target.uri)}
              >
                ↗ open raw URL
              </button>
            </div>
          </Match>
        </Switch>

        <p class="text-fg-3/60 text-[10px] mt-2">
          <kbd class="rounded border border-edge px-1 font-mono text-[9px]">
            ⌘
          </kbd>
          -click: open the raw URL anyway
        </p>
      </div>
    </Portal>
  );
};
