/**
 * Preview tab — the forwarded page inside kolu (PRT3).
 *
 * Header: ◀/▶ trail · ⇄ door pill · draft-vs-applied path bar · ⟳ · ↗
 * Body: iframe through the relay door, or a door-closed / empty state.
 *
 * Location is server-authored (`chrome.previewOpen`); this tab is a reader
 * that builds the frame URL from the forwards store + reach facts, and
 * keeps a per-viewer trail via `@kolu/solid-browser`.
 */

import { type PreviewLocation, samePreviewLocation } from "@kolu/padi/surface";
import {
  attachBackForwardMouse,
  createBrowser,
  DEFAULT_MAX_ENTRIES,
  type Browser,
} from "@kolu/solid-browser";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import { toast } from "solid-sonner";
import { ForwardPill } from "../forwards/ForwardPill";
import {
  createForward,
  forwardsForHost,
  viewerHost,
} from "../forwards/useForwards";
import { isActiveHostLocal } from "../kaval/useDaemonStatus";
import { sameHost } from "../host/hostChipTone";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { ChevronRightIcon, OpenIcon, RestartIcon } from "../ui/Icons";
import { activeHost, activePadiRpc } from "../wire";
import { previewFrameTarget } from "./previewUrl";
import { useRightPanel } from "./useRightPanel";

/** Per-terminal trail — session-local, like the Code tab's browser. */
const trails = new Map<TerminalId, Browser<PreviewLocation>>();

function trailFor(id: TerminalId): Browser<PreviewLocation> {
  let b = trails.get(id);
  if (!b) {
    b = createBrowser<PreviewLocation>({
      isSameEntry: samePreviewLocation,
      maxEntries: DEFAULT_MAX_ENTRIES,
    });
    trails.set(id, b);
  }
  return b;
}

const PreviewTab: Component<{
  terminalId: TerminalId | null;
  /** Server-authored location from terminal metadata (or local optimistic). */
  location: PreviewLocation | null;
}> = (props) => {
  const rightPanel = useRightPanel();
  const [draft, setDraft] = createSignal("/");
  let iframeRef: HTMLIFrameElement | undefined;
  let rootEl: HTMLDivElement | undefined;

  const host = () => activeHost();
  const forward = createMemo(() => {
    const loc = props.location;
    if (!loc) return undefined;
    return forwardsForHost(host()).find((f) => f.remotePort === loc.port);
  });

  /** Reach for this preview's port — door wins; else viewer loopback; else
   *  the page host when this is the kolu host; else needs a door we lack. */
  const action = createMemo(() => {
    if (forward()) return { kind: "forward" as const };
    const v = viewerHost();
    if (v !== null && sameHost(v, host())) return { kind: "viewer" as const };
    if (isActiveHostLocal()) return { kind: "here" as const };
    return { kind: "forward" as const };
  });

  const target = createMemo(() => {
    const loc = props.location;
    if (!loc) return null;
    return previewFrameTarget({
      location: loc,
      action: action(),
      localPort: forward()?.localPort,
      pageHostname: window.location.hostname,
    });
  });

  const urlTarget = createMemo(() => {
    const t = target();
    return t?.kind === "url" ? t : null;
  });

  // Draft tracks the applied path; external navigations (MCP, ◀/▶) reset it.
  createEffect(
    on(
      () => props.location?.path,
      (path) => {
        if (path !== undefined) setDraft(path);
      },
    ),
  );

  // Record server-shared current onto this viewer's trail (chip / MCP / other
  // viewer). `navigate` reads the trail signals it then writes — must run
  // untracked or this effect re-enters until the stack blows (live toast:
  // "Metadata error: Maximum call stack size exceeded"). Code tab only
  // records from event handlers for the same reason.
  createEffect(
    on(
      () => {
        const loc = props.location;
        return loc === null ? null : `${loc.port}\0${loc.path}`;
      },
      (key) => {
        if (key === null) return;
        const id = props.terminalId;
        const loc = props.location;
        if (id === null || loc === null) return;
        const plain = { port: loc.port, path: loc.path };
        untrack(() => trailFor(id).navigate(plain));
      },
    ),
  );

  const applyPath = () => {
    const id = props.terminalId;
    const loc = props.location;
    if (id === null || loc === null) return;
    const path = draft().trim() || "/";
    void activePadiRpc.chrome
      .previewOpen({ id, port: loc.port, path })
      .then((next) => {
        rightPanel.applyPreview(id, next);
        trailFor(id).navigate(next);
      })
      .catch((err: Error) =>
        toast.error(`Preview navigate failed: ${err.message}`),
      );
  };

  const refresh = () => {
    const t = target();
    if (iframeRef && t?.kind === "url") {
      // Cross-origin: re-assign src (contentWindow.location.reload is blocked).
      iframeRef.src = t.href;
    }
  };

  const openExternal = () => {
    const t = target();
    if (t?.kind === "url") {
      window.open(t.href, "_blank", "noopener,noreferrer");
    }
  };

  const goBack = () => {
    const id = props.terminalId;
    if (id === null) return;
    const prev = trailFor(id).back();
    if (prev === null) return;
    void activePadiRpc.chrome
      .previewOpen({ id, port: prev.port, path: prev.path })
      .then((next) => rightPanel.applyPreview(id, next))
      .catch((err: Error) =>
        toast.error(`Preview back failed: ${err.message}`),
      );
  };

  const goForward = () => {
    const id = props.terminalId;
    if (id === null) return;
    const nextLoc = trailFor(id).forward();
    if (nextLoc === null) return;
    void activePadiRpc.chrome
      .previewOpen({ id, port: nextLoc.port, path: nextLoc.path })
      .then((next) => rightPanel.applyPreview(id, next))
      .catch((err: Error) =>
        toast.error(`Preview forward failed: ${err.message}`),
      );
  };

  const reforward = async () => {
    const id = props.terminalId;
    const loc = props.location;
    if (id === null || loc === null) return;
    try {
      await createForward({
        host: host(),
        port: loc.port,
        origin: "auto",
      });
    } catch (err) {
      toast.error(
        `Could not re-forward port ${loc.port}: ${(err as Error).message}`,
      );
    }
  };

  // X1/X2 mouse buttons — same attach as the Code tab.
  createEffect(() => {
    const el = rootEl;
    if (!el) return;
    onCleanup(
      attachBackForwardMouse(el, { onBack: goBack, onForward: goForward }),
    );
  });

  const trail = () => {
    const id = props.terminalId;
    return id === null ? null : trailFor(id);
  };

  return (
    <div
      ref={rootEl}
      data-testid="preview-tab"
      class="flex h-full min-w-0 flex-col"
    >
      <div class="flex shrink-0 items-center gap-1 border-b border-edge bg-surface-1 px-1.5 py-1">
        <button
          type="button"
          data-testid="preview-back"
          class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:bg-surface-2/60 hover:text-fg disabled:opacity-30`}
          disabled={!trail()?.canBack()}
          title="Back"
          aria-label="Go back"
          onClick={goBack}
        >
          <ChevronRightIcon class="h-3.5 w-3.5 rotate-180" />
        </button>
        <button
          type="button"
          data-testid="preview-forward"
          class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:bg-surface-2/60 hover:text-fg disabled:opacity-30`}
          disabled={!trail()?.canForward()}
          title="Forward"
          aria-label="Go forward"
          onClick={goForward}
        >
          <ChevronRightIcon class="h-3.5 w-3.5" />
        </button>

        <Show when={forward()}>
          {(f) => <ForwardPill forward={f()} testid="preview-forward-pill" />}
        </Show>
        <Show when={!forward() && props.location}>
          <span
            class="shrink-0 rounded px-1.5 font-mono text-[10px] text-fg-3/70"
            data-testid="preview-port-label"
          >
            :{props.location?.port}
          </span>
        </Show>

        <input
          data-testid="preview-url"
          type="text"
          class="min-w-0 flex-1 rounded border border-edge bg-surface-0 px-2 py-0.5 font-mono text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent/50"
          placeholder="/path"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyPath();
          }}
          disabled={props.location === null}
        />

        <button
          type="button"
          data-testid="preview-refresh"
          class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:bg-surface-2/60 hover:text-fg`}
          title="Refresh"
          aria-label="Refresh"
          onClick={refresh}
          disabled={target()?.kind !== "url"}
        >
          <RestartIcon class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-testid="preview-open-external"
          class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:bg-surface-2/60 hover:text-fg`}
          title="Open in browser tab"
          aria-label="Open in browser tab"
          onClick={openExternal}
          disabled={target()?.kind !== "url"}
        >
          <OpenIcon class="h-3.5 w-3.5" />
        </button>
      </div>

      <Show
        when={props.location}
        fallback={
          <div
            data-testid="preview-empty"
            class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-fg-3"
          >
            <p>No page open.</p>
            <p class="text-xs text-fg-3/70">
              Click a port in the Inspector, or ⌘K → “Preview a port…”.
            </p>
          </div>
        }
      >
        <Show
          when={urlTarget()}
          fallback={
            <div
              data-testid="preview-door-closed"
              class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-fg-3"
            >
              <Show
                when={target()?.kind === "door-closed"}
                fallback={
                  <p data-testid="preview-unreachable">
                    This port is not reachable from here.
                  </p>
                }
              >
                <p>The door closed behind this page.</p>
                <button
                  type="button"
                  data-testid="preview-reforward"
                  class="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25"
                  onClick={() => void reforward()}
                >
                  Re-forward port {props.location?.port}
                </button>
              </Show>
              <p class="max-w-sm text-[11px] leading-snug text-fg-3/60">
                Some servers refuse to be framed (X-Frame-Options /
                Content-Security-Policy). Use ↗ to open in a browser tab — that
                path stays load-bearing.
              </p>
            </div>
          }
        >
          {(t) => (
            <div class="relative min-h-0 flex-1">
              <iframe
                data-testid="preview-iframe"
                ref={iframeRef}
                src={t().href}
                class="h-full w-full border-0 bg-white"
                // Dev servers need scripts/forms; sandbox still limits top-nav.
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                title={`Preview of port ${props.location?.port}`}
              />
              {/* Static framing hint — frame-refusing servers keep ↗ load-bearing. */}
              <p
                data-testid="preview-framing-hint"
                class="pointer-events-none absolute bottom-1 left-1/2 max-w-md -translate-x-1/2 rounded bg-surface-0/80 px-2 py-0.5 text-center text-[10px] text-fg-3/50"
              >
                If this stays blank, the server may refuse framing — use ↗
              </p>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
};

export default PreviewTab;
