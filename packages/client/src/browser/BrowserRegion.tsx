/** BrowserRegion — right-side iframe region attached to a terminal (#633).
 *
 *  Peer to the bottom sub-panel: one region per terminal, spans the full
 *  tile height, renders the iframe + minimal chrome (URL bar, reload,
 *  open-externally, close). The URL and the collapsed/panelSize bits live
 *  on the terminal's metadata (`meta.browser`), written via
 *  `terminal.setBrowser` / `terminal.clearBrowser`.
 *
 *  Detection: on URL commit, calls `terminal.probeBrowserUrl` to check
 *  `X-Frame-Options` / CSP `frame-ancestors` headers server-side. When
 *  blocked, swaps the iframe body for a "Open in a new tab" fallback.
 *  Regardless of probe result the header always offers an "open
 *  externally" button so the escape hatch is unconditional. */

import {
  type Component,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
} from "solid-js";
import type { TerminalId, BrowserRegion } from "kolu-common";
import { toast } from "solid-sonner";
import { client } from "../rpc/rpc";
import { resolveTileUrl } from "./resolveTileUrl";
import { OpenExternalIcon, ReloadIcon, GlobeIcon } from "../ui/Icons";
import Tip from "../ui/Tip";
import { TILE_BUTTON_CLASS } from "../ui/tileButton";

/** Bump this counter on the iframe `src` attribute to force a reload
 *  without recreating the element — `location.reload()` on a cross-origin
 *  iframe throws, so this is the safe equivalent. */
function appendReloadNonce(url: string, nonce: number): string {
  if (nonce === 0) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("__kolu_reload", String(nonce));
    return u.toString();
  } catch {
    return url;
  }
}

const BrowserRegionComponent: Component<{
  terminalId: TerminalId;
  browser: BrowserRegion;
}> = (props) => {
  const rawUrl = () => props.browser.url;
  const resolved = createMemo(() => resolveTileUrl(rawUrl()));
  const [reloadNonce, setReloadNonce] = createSignal(0);
  const src = createMemo(() => appendReloadNonce(resolved(), reloadNonce()));
  const [draft, setDraft] = createSignal(rawUrl());

  // Keep the URL-bar draft in sync with the committed URL (e.g. session
  // restore or cross-client update); only reset when the draft matches
  // the previous committed value so in-flight user edits aren't clobbered.
  // `on`'s `prevInput` parameter gives us the last rawUrl without a
  // module-local mutable; we return `next` from the effect so the second
  // run sees the prior committed value cleanly.
  createEffect(
    on(rawUrl, (next, prev) => {
      if (prev !== undefined && draft() === prev) setDraft(next);
    }),
  );

  const [probe, setProbe] = createSignal<{
    blocked: boolean;
    reason?: string;
  } | null>(null);

  // Probe whenever the resolved URL changes — using the resolved form so
  // protocol-less input (`news.ycombinator.com`) is checked and rendered
  // as the absolute https:// form, not a relative path that would recurse
  // Kolu into itself.
  createEffect(
    on(resolved, async (url) => {
      if (!url) {
        setProbe(null);
        return;
      }
      setProbe(null);
      try {
        const result = await client.terminal.probeBrowserUrl({ url });
        if (resolved() === url) setProbe(result);
      } catch {
        // Probe failure isn't worth a toast — the iframe itself surfaces
        // the real network/CORS error. Keep probe null so we render the
        // iframe and let the browser handle it.
      }
    }),
  );

  function commit() {
    const next = draft().trim();
    if (next === "" || next === rawUrl()) return;
    void client.terminal
      .setBrowser({
        id: props.terminalId,
        browser: { ...props.browser, url: next },
      })
      .catch((err: Error) =>
        toast.error(`Failed to set browser URL: ${err.message}`),
      );
  }

  function detach() {
    void client.terminal
      .clearBrowser({ id: props.terminalId })
      .catch((err: Error) =>
        toast.error(`Failed to close browser: ${err.message}`),
      );
  }

  const hostLabel = createMemo(() => {
    try {
      return new URL(resolved()).host || rawUrl();
    } catch {
      return rawUrl() || "new browser";
    }
  });

  return (
    <div
      data-testid="browser-region"
      data-terminal-id={props.terminalId}
      class="h-full flex flex-col overflow-hidden bg-surface-1"
    >
      {/* Browser chrome header — URL bar, reload, open-externally, close. */}
      <div
        class="flex items-center gap-2 px-2 py-1.5 shrink-0 select-none bg-surface-2/60"
        style={{ "border-bottom": "1px solid var(--color-edge)" }}
      >
        <div
          class="flex items-center gap-1.5 min-w-0 text-fg-2 text-xs font-medium truncate pl-1"
          data-testid="browser-region-title"
        >
          <GlobeIcon class="w-3.5 h-3.5 shrink-0" />
          <span class="truncate">{hostLabel()}</span>
        </div>
        <input
          data-testid="browser-region-url"
          type="text"
          spellcheck={false}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          placeholder="https://…"
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              e.currentTarget.blur();
            }
          }}
          onBlur={commit}
          class="h-7 flex-1 min-w-0 px-2 rounded-lg text-xs font-mono bg-black/20 border border-transparent hover:border-edge focus:border-accent focus:outline-none"
          style={{ color: "var(--color-fg, currentColor)" }}
        />
        <Tip label="Reload">
          <button
            data-testid="browser-region-reload"
            class={`${TILE_BUTTON_CLASS} w-7`}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onClick={() => setReloadNonce((n) => n + 1)}
            aria-label="Reload"
          >
            <ReloadIcon />
          </button>
        </Tip>
        <Tip label="Open in a new tab">
          <a
            data-testid="browser-region-open-externally"
            href={rawUrl() || "about:blank"}
            target="_blank"
            rel="noopener noreferrer"
            class={`${TILE_BUTTON_CLASS} w-7`}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            aria-label="Open in a new tab"
          >
            <OpenExternalIcon />
          </a>
        </Tip>
        <Tip label="Close browser">
          <button
            data-testid="browser-region-close"
            class={`${TILE_BUTTON_CLASS} w-7`}
            style={{ color: "var(--color-fg-3, currentColor)" }}
            onClick={() => detach()}
            aria-label="Close browser"
          >
            ×
          </button>
        </Tip>
      </div>

      {/* Body — iframe or blocked fallback. */}
      <Show
        when={probe()?.blocked}
        fallback={
          <Show
            when={rawUrl()}
            fallback={
              <div
                data-testid="browser-region-empty"
                class="flex-1 flex items-center justify-center text-fg-3 text-sm"
              >
                Enter a URL above
              </div>
            }
          >
            {/* `allow-same-origin` + `allow-scripts` defeats sandboxing for
             *  same-origin docs, but is required for real-world use (logged-
             *  in Grafana, docs sites with cookies). Kolu is single-user and
             *  the user has opted into framing a specific URL. Cross-origin
             *  iframes ignore `allow-same-origin` anyway, so the risk is
             *  limited to pages served from Kolu's own origin. */}
            <iframe
              data-testid="browser-region-iframe"
              src={src()}
              class="flex-1 min-h-0 w-full bg-white"
              referrerpolicy="no-referrer"
              sandbox="allow-forms allow-popups allow-scripts allow-same-origin allow-downloads"
            />
          </Show>
        }
      >
        <div
          data-testid="browser-region-blocked"
          class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center text-fg-2 text-sm"
        >
          <div class="font-medium text-fg">
            This site refuses to be embedded
          </div>
          <div class="text-fg-3 text-xs font-mono">
            {probe()?.reason ?? "frame-ancestors blocked"}
          </div>
          <a
            data-testid="browser-region-open-externally-fallback"
            href={rawUrl()}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-edge hover:border-edge-bright bg-surface-1 hover:bg-surface-2 transition-colors"
          >
            <OpenExternalIcon />
            <span>Open in a new tab</span>
          </a>
        </div>
      </Show>
    </div>
  );
};

export default BrowserRegionComponent;
