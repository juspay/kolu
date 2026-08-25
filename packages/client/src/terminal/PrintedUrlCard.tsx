/**
 * The PRT4 join card — a small Solid popover at the click coordinates.
 *
 * Same species as the host diagnostics popover (Portal + surface chrome +
 * outside-click / Escape dismiss). LIVE: the join is a reactive derivation over
 * the ports and forwards stores, evaluated only while the card is open, so it
 * upgrades when a listener appears and degrades when auto-cancel closes a door.
 */

import { activeArm } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { parseLoopbackUrl } from "@kolu/url-shape";
import { Effect } from "effect";
import { hostKeysEqual as sameHost } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
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
import { match } from "ts-pattern";
import { FORWARD_PILL } from "../forwards/forwardTone";
import {
  joinPrintedUrl,
  tilePortsObservation,
} from "../forwards/joinPrintedUrl";
import { ensureDoor, urlForPort } from "../forwards/openPort";
import { portAction } from "../forwards/portAction";
import { forwardsForHost, viewerHost } from "../forwards/useForwards";
import { hostDisplayName } from "../host/hostChipTone";
import { isActiveHostLocal } from "../kaval/useDaemonStatus";
import { runAction, type UiAction } from "../runAction";
import { writeTextToClipboard } from "../ui/clipboard";
import { surface } from "../ui/Surface";
import { useServerIdentity } from "../useServerIdentity";
import { activeHost } from "../wire";
import { openRawUrl } from "./handleWebLink";
import {
  closePrintedUrlCard,
  type PrintedUrlCardTarget,
  printedUrlCardTarget,
} from "./printedUrlCardState";
import { useTerminalStore } from "./useTerminalStore";

/** Put a URL on the clipboard and say so — the card's two copy affordances (the
 *  post-open toast action and the raw `⧉ copy` button) share one program so the
 *  success and failure wording cannot drift between them. */
function copyUrl(url: string): UiAction {
  return writeTextToClipboard(url).pipe(
    Effect.tap(() => Effect.sync(() => toast.success("URL copied"))),
    Effect.catch((err) =>
      Effect.sync(() => {
        toast.error(`Could not copy: ${toError(err).message}`);
      }),
    ),
  );
}

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

  const join = createMemo(
    () =>
      joinPrintedUrl({
        uri: props.target.uri,
        observation: observation(),
        forwards: forwardsForHost(host()),
      }),
    undefined,
    // Structural equality: the keyed <Match> below re-creates its children on
    // every identity change, so a no-op scan tick must not re-key the card.
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  const viewerOnHost = createMemo(() => {
    const v = viewerHost();
    return v !== null && sameHost(v, host());
  });

  const remainder = () => ({
    pathname: props.target.pathname,
    search: props.target.search,
    hash: props.target.hash,
    protocol: props.target.protocol,
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

  // Terminal unmount (host switch, tile kill) drops listeners but the singleton
  // target would survive — remount would reopen a zombie card. Clear if we own it.
  onCleanup(() => {
    if (printedUrlCardTarget()?.terminalId === props.target.terminalId) {
      closePrintedUrlCard();
    }
  });

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
  const forwardAndOpen = (): UiAction =>
    Effect.suspend(() => {
      const action = actionForJoined();
      if (action === undefined || action.kind === "none") return Effect.void;
      if (busy()) return Effect.void;
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
        return Effect.void;
      }
      if (first.kind === "none") {
        setBusy(false);
        return Effect.void;
      }
      // needs-door — claim the tab on the CALLING stack (popup-blocker rule);
      // `runAction` forks synchronously into this `suspend` body.
      const tab = window.open("", "_blank");
      if (tab !== null) {
        try {
          tab.opener = null;
        } catch {
          // Electron can throw; ignore.
        }
      }
      return ensureDoor({
        host: host(),
        port: props.target.port,
        origin: "auto",
      }).pipe(
        Effect.tap((localPort) =>
          Effect.sync(() => {
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
          }),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            tab?.close();
            toast.error(
              `Could not forward port ${props.target.port}: ${toError(err).message}`,
            );
          }),
        ),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      );
    });

  /** Copy = decision (+ act when a door is already ready). Never clipboard-write
   *  after an await — user activation is gone (see clipboard.ts). needs-door
   *  opens the door, then asks for a second click to copy. */
  const copyDoorUrl = (): UiAction =>
    Effect.suspend(() => {
      const action = actionForJoined();
      if (action === undefined || action.kind === "none") return Effect.void;
      if (busy()) return Effect.void;
      const j = join();
      const doorPort = j.kind === "joined" ? j.forward?.localPort : undefined;
      const decided = urlForPort({
        action,
        remotePort: props.target.port,
        doorPort,
        pageHost: window.location.hostname,
        remainder: remainder(),
      });
      // Still inside the click gesture — the clipboard write is the FIRST thing
      // this branch does, with nothing asynchronous in front of it, so the user
      // activation is intact when `execCommand` runs.
      if (decided.kind === "ready") return copyUrl(decided.url);
      if (decided.kind !== "needs-door") return Effect.void;
      setBusy(true);
      return ensureDoor({
        host: host(),
        port: props.target.port,
        origin: "auto",
      }).pipe(
        Effect.tap((localPort) =>
          Effect.sync(() => {
            const ready = urlForPort({
              action: { kind: "forward" },
              remotePort: props.target.port,
              doorPort: localPort,
              pageHost: window.location.hostname,
              remainder: remainder(),
            });
            if (ready.kind !== "ready") return;
            // Second gesture required — a clipboard write out here is past the
            // activation window.
            toast.success(`Door open on port ${localPort}`, {
              description: "Click copy again to put the URL on the clipboard.",
              action: {
                label: "Copy",
                onClick: () => runAction("copy URL", copyUrl(ready.url)),
              },
            });
          }),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(
              `Could not open door for port ${props.target.port}: ${toError(err).message}`,
            );
          }),
        ),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      );
    });

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
          <Match keyed when={join().kind === "joined" ? join() : undefined}>
            {(j) => {
              // `keyed`: `j` is the VALUE at branch entry — a stale accessor
              // read is unspellable. The join memo's structural equality keeps
              // re-keying to real content changes only.
              const joined = () => {
                if (j.kind !== "joined") throw new Error("unreachable");
                return j;
              };
              const action = () => actionForJoined();
              const primaryLabel = () => {
                const a = action();
                if (a === undefined) return null;
                return match(a)
                  .with({ kind: "none" }, () => null)
                  .with({ kind: "viewer" }, () => "↗ open")
                  .with({ kind: "here" }, () => "↗ open")
                  .with({ kind: "forward" }, () =>
                    joined().forward !== undefined
                      ? "↗ open"
                      : "⇄ forward & open ↗",
                  )
                  .exhaustive();
              };
              const copyLabel = () => {
                const a = action();
                if (a === undefined || a.kind === "none") return null;
                return a.kind === "forward" ? "⧉ copy door URL" : "⧉ copy URL";
              };
              const prose = () => {
                const a = action();
                if (a === undefined) return null;
                return match(a)
                  .with({ kind: "viewer" }, () => (
                    <>
                      You are on this host —{" "}
                      <span class="font-mono">localhost</span> is correct here.
                    </>
                  ))
                  .with({ kind: "here" }, () => (
                    <>
                      This port already answers on{" "}
                      <span class="font-mono">{hostName()}</span> — opens
                      directly, path included.
                    </>
                  ))
                  .with({ kind: "forward" }, () =>
                    joined().forward !== undefined ? (
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
                    ),
                  )
                  .with({ kind: "none" }, () => (
                    <>
                      Bound to one interface — no door can reach it, and there
                      is no honest URL to build.
                    </>
                  ))
                  .exhaustive();
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
                      {match(action() ?? { kind: "none" as const })
                        .with({ kind: "forward" }, () =>
                          joined().forward !== undefined
                            ? "door already open"
                            : "this terminal serves it",
                        )
                        .with({ kind: "here" }, () => "opens on this host")
                        .with({ kind: "viewer" }, () => "on your machine")
                        .with({ kind: "none" }, () => "not reachable")
                        .exhaustive()}
                      <span class="text-fg-3 font-normal font-mono">
                        {" "}
                        · {joined().info.name}
                      </span>
                    </span>
                  </div>
                  <p class="text-fg-3 text-[11px] mb-2">{prose()}</p>
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Show keyed when={primaryLabel()}>
                      {(label) => (
                        <button
                          type="button"
                          class="font-semibold text-teal-700 dark:text-teal-300 hover:underline disabled:opacity-50"
                          data-testid="printed-url-forward-open"
                          disabled={busy()}
                          onClick={() =>
                            runAction("open through forward", forwardAndOpen())
                          }
                        >
                          {label}
                        </button>
                      )}
                    </Show>
                    <Show keyed when={copyLabel()}>
                      {(label) => (
                        <button
                          type="button"
                          class="text-fg-3 hover:text-fg disabled:opacity-50"
                          data-testid="printed-url-copy-door"
                          disabled={busy()}
                          onClick={() => runAction("copy URL", copyDoorUrl())}
                        >
                          {label}
                        </button>
                      )}
                    </Show>
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
                onClick={() => runAction("copy URL", copyUrl(props.target.uri))}
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

/** The card's mount — KEYED, so children receive the target as a VALUE and a
 *  dismiss mid-cascade cannot produce a stale accessor read (the production
 *  second-click crash). Terminal renders this; tests render this; there is no
 *  second copy of the mount pattern to drift. */
export const PrintedUrlCardMount: Component<{ terminalId: TerminalId }> = (
  props,
) => (
  <Show
    keyed
    when={
      printedUrlCardTarget()?.terminalId === props.terminalId
        ? printedUrlCardTarget()
        : undefined
    }
  >
    {(t) => <PrintedUrlCard target={t} />}
  </Show>
);
