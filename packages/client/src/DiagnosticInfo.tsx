/** Diagnostic Info — runtime state dump for support tickets and
 *  self-diagnosis. Opened from command palette → Debug → Diagnostic
 *  info. Content split into `<DiagnosticInfoContent/>` so a future
 *  always-visible dev inspector can reuse it without the modal chrome. */

import Dialog from "@corvu/dialog";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { PAINT_STALL_WARN_MS } from "./terminal/renderRecovery";
import { serverProcessId, wsStatus } from "./rpc/rpc";
import { getTerminalRefs } from "./terminal/terminalRefs";
import { getDiagnostics } from "./terminal/useTerminalDiagnostics";
import { webglLifecycleSnapshot } from "./terminal/webglTracker";
import { writeTextToClipboard } from "./ui/clipboard";
import { createDisclosure } from "./ui/createDisclosure";
import { formatMB, readJsHeap } from "./ui/memory";
import { localDaemonStatus } from "./kaval/useDaemonStatus";
import { kavalMemory, serverRssBytes } from "./ui/useMemoryUsage";
import ModalDialog from "./ui/ModalDialog";
import Row from "./ui/Row";
import Section from "./ui/Section";
import { surface } from "./ui/Surface";
import { layoutMode } from "./useMobile";

/** WebGL2 support detection creates a throwaway canvas + WebGL context
 *  that lingers on a detached node until GC. Compute once at module load
 *  so re-opening this dialog doesn't burn one context per open — the exact
 *  zombie-context pattern this dialog exists to diagnose (#591). */
const WEBGL2_SUPPORTED = (() => {
  const canvas = document.createElement("canvas");
  return !!canvas.getContext("webgl2");
})();

/** One-shot browser facts read at first render. Stable for the session,
 *  so no reactive source needed — keeps this module's dependency surface
 *  small. */
function browserFacts() {
  return {
    userAgent: navigator.userAgent,
    webgl2Supported: WEBGL2_SUPPORTED,
    crossOriginIsolated: self.crossOriginIsolated,
    devicePixelRatio: window.devicePixelRatio,
    xtermVersion: __XTERM_VERSION__,
  };
}

const DiagnosticInfoContent: Component<{ activeId: TerminalId | null }> = (
  props,
) => {
  const browser = browserFacts();

  const snapshot = createMemo(() => {
    const webgl = webglLifecycleSnapshot();
    return {
      browser,
      session: {
        layout: layoutMode(),
        wsStatus: wsStatus(),
        serverProcessId: serverProcessId(),
        activeId: props.activeId,
        terminalCount: getDiagnostics().length,
        jsHeap: readJsHeap(),
        // Server + kaval RSS ride the `processMemory` cell (the same source the
        // rail reads). `kavalRss` is the honest three-way: the byte figure when
        // a live daemon answered, `null` for `absent` (no daemon to measure), or
        // the literal `"error"` when a believed-connected daemon's poll failed —
        // so the diagnostic snapshot never conflates a failed poll with no-data.
        // Gated on the daemon being connected RIGHT NOW — same as the rail
        // (IdentityRail's KavalMemReadout): `daemonStatus` flips the instant the
        // daemon leaves connected, but the cell's kaval figure only clears on the
        // next 5s sampler tick, so reading it raw would show stale RSS for a
        // daemon that is no longer live.
        serverRss: serverRssBytes() ?? null,
        kavalRss:
          localDaemonStatus()?.state !== "connected"
            ? null
            : ((m) =>
                m.status === "ok"
                  ? m.rssBytes
                  : m.status === "error"
                    ? "error"
                    : null)(kavalMemory()),
        domNodes: document.getElementsByTagName("*").length,
        canvases: webgl.totalDomCanvases,
        // Page-attention state AT SNAPSHOT TIME. The parked-rAF freeze
        // signature is visibility "visible" + hidden false + hasFocus FALSE
        // (window occluded by app-switch — see renderRecovery.ts). Captured
        // here, not per-terminal, since it's a whole-document fact.
        page: {
          visibility: document.visibilityState,
          hidden: document.hidden,
          hasFocus: document.hasFocus(),
        },
      },
      terminals: getDiagnostics().map((d) => {
        const refs = getTerminalRefs(d.id);
        const bufferLen = refs?.xterm.buffer.active.length ?? null;
        return {
          id: d.id,
          cols: d.cols,
          rows: d.rows,
          renderer: d.renderer,
          bufferLen,
          scrollback: bufferLen !== null ? bufferLen - d.rows : null,
          atlas: refs?.probes.webglAtlas() ?? null,
          bufferBytes: refs?.probes.bufferBytes() ?? null,
          scrollLock: d.scrollLock,
          // Full transition ring for the JSON dump — the live row above only
          // shows the latest one (#1272 field diagnosis).
          scrollLockEvents: refs?.probes.scrollLockEvents() ?? [],
          // Render-pipeline state — climbing msSinceLastPaint with
          // debouncerPending=true while bufferBytes grows is the parked-rAF
          // freeze; debouncerPending=false with a stale paint means refreshRows
          // was never called (a kolu write-path/routing bug instead).
          render: {
            msSinceLastPaint: refs?.probes.msSinceLastPaint() ?? null,
            debouncerPending: refs?.probes.renderDebouncerPending() ?? null,
            isPaused: refs?.probes.isPaused() ?? null,
            syncOutput: refs?.probes.synchronizedOutput() ?? null,
          },
        };
      }),
      webgl,
    };
  });

  async function copyJson() {
    try {
      await writeTextToClipboard(JSON.stringify(snapshot(), null, 2));
      toast.success("Diagnostic info copied");
    } catch (err) {
      console.error("Failed to copy diagnostic info:", err);
      toast.error(`Failed to copy diagnostic info: ${(err as Error).message}`);
    }
  }

  const chrome = surface({ portalled: true });

  return (
    <div
      class={`${chrome.class} overflow-hidden flex flex-col max-h-[80vh]`}
      style={chrome.style}
    >
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-edge shrink-0">
        <Dialog.Label class="font-semibold text-fg text-sm">
          Diagnostic info
        </Dialog.Label>
        <button
          type="button"
          onClick={copyJson}
          class="text-[11px] px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-fg-2 hover:text-fg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          Copy JSON
        </button>
      </div>

      <div class="overflow-y-auto">
        <Section title="Browser">
          <div class="space-y-0.5">
            <Row label="WebGL 2">
              <span class={browser.webgl2Supported ? "text-ok" : "text-danger"}>
                {browser.webgl2Supported ? "available" : "unavailable"}
              </span>
            </Row>
            <Row label="DPR">
              <span class="font-mono text-fg-3">
                {browser.devicePixelRatio}
              </span>
            </Row>
            <Row label="xterm.js">
              <span class="font-mono text-fg-3">{browser.xtermVersion}</span>
            </Row>
            <Row label="UA">
              <span class="font-mono text-fg-3 break-all">
                {browser.userAgent}
              </span>
            </Row>
          </div>
        </Section>

        <Section title="Session">
          <div class="space-y-0.5">
            <Row label="Layout">
              <span class="text-fg">{layoutMode()}</span>
            </Row>
            <Row label="WS" variant="badge">
              {wsStatus()}
            </Row>
            <Show when={serverProcessId()}>
              {(pid) => (
                <Row label="Server">
                  <span class="font-mono text-fg-3">{pid().slice(0, 8)}</span>
                </Row>
              )}
            </Show>
            <Row label="Active">
              <span class="font-mono text-fg-3">
                {props.activeId ? props.activeId.slice(0, 8) : "—"}
              </span>
            </Row>
            <Row label="Count">
              <span class="font-mono text-fg">{getDiagnostics().length}</span>
            </Row>
            <Show when={snapshot().session.jsHeap}>
              {(heap) => (
                <Row label="JS heap">
                  <span class="font-mono text-fg">
                    {heap().usedMB} / {heap().totalMB} MB
                    <span class="text-fg-3/70"> (limit {heap().limitMB})</span>
                  </span>
                </Row>
              )}
            </Show>
            <Show when={snapshot().session.serverRss}>
              {(rss) => (
                <Row label="Server RSS">
                  <span class="font-mono text-fg">{formatMB(rss())}</span>
                </Row>
              )}
            </Show>
            <Show when={snapshot().session.kavalRss !== null}>
              <Row label="kaval RSS">
                <span class="font-mono text-fg">
                  {(() => {
                    const rss = snapshot().session.kavalRss;
                    return rss === "error"
                      ? "poll failed"
                      : formatMB(rss as number);
                  })()}
                </span>
              </Row>
            </Show>
            <Row label="DOM">
              <span class="font-mono text-fg">
                {snapshot().session.domNodes}
              </span>
            </Row>
            <Row label="Canvases">
              <span class="font-mono text-fg">
                {snapshot().session.canvases}
              </span>
            </Row>
            <Row label="COI">
              <span
                class={browser.crossOriginIsolated ? "text-ok" : "text-fg-3"}
              >
                {browser.crossOriginIsolated ? "yes" : "no"}
              </span>
            </Row>
            <Row label="Page">
              {(() => {
                const p = snapshot().session.page;
                // visible + no focus = window occluded by app-switch: the
                // condition that parks xterm's rAF and freezes paints.
                const occluded = !p.hidden && !p.hasFocus;
                return (
                  <span
                    class={`font-mono ${occluded ? "text-danger" : "text-fg-3"}`}
                  >
                    {p.visibility} · focus:{p.hasFocus ? "yes" : "no"}
                    {occluded ? " (occluded)" : ""}
                  </span>
                );
              })()}
            </Row>
          </div>
        </Section>

        <Section title="Terminals">
          <Show
            when={snapshot().terminals.length > 0}
            fallback={
              <div class="text-[11px] text-fg-3/60 italic">No terminals</div>
            }
          >
            <div class="space-y-1">
              <For each={snapshot().terminals}>
                {(d) => (
                  <div class="text-[11px] font-mono space-y-0.5">
                    <div class="grid grid-cols-[9ch_8ch_1fr_auto] items-baseline gap-3">
                      <span class="text-fg-3/70">{d.id.slice(0, 8)}</span>
                      <span class="text-fg-2 tabular-nums">
                        {d.cols}×{d.rows}
                      </span>
                      <span
                        class={
                          d.renderer === "webgl" ? "text-accent" : "text-fg-2"
                        }
                      >
                        {d.renderer}
                      </span>
                      <Show when={props.activeId === d.id}>
                        <span class="text-[10px] text-fg-3/70">active</span>
                      </Show>
                    </div>
                    <Show when={d.scrollLock.locked || d.scrollLock.lastEvent}>
                      <div class="pl-[9ch] text-[10px] tabular-nums">
                        <span
                          class={
                            d.scrollLock.locked
                              ? "text-danger font-semibold"
                              : "text-fg-3/60"
                          }
                        >
                          lock:{" "}
                          {d.scrollLock.locked
                            ? `engaged · ${d.scrollLock.pendingChunks} chunks held`
                            : "released"}
                        </span>
                        <Show when={d.scrollLock.lastEvent}>
                          {(ev) => (
                            <span class="text-fg-3/60">
                              {" "}
                              · last: {ev().kind}
                              {ev().source ? `/${ev().source}` : ""} at{" "}
                              {new Date(ev().at).toISOString().slice(11, 23)}
                            </span>
                          )}
                        </Show>
                      </div>
                    </Show>
                    <div class="pl-[9ch] text-[10px] tabular-nums">
                      <span
                        class={
                          d.render.debouncerPending &&
                          // null = never painted, the most severe unknown
                          // (renderRecovery documents it so) — reds it too,
                          // rather than `?? 0` masquerading as the healthiest.
                          (d.render.msSinceLastPaint === null ||
                            d.render.msSinceLastPaint > PAINT_STALL_WARN_MS)
                            ? "text-danger font-semibold"
                            : "text-fg-3/60"
                        }
                      >
                        paint:{" "}
                        {d.render.msSinceLastPaint === null
                          ? "?"
                          : `${d.render.msSinceLastPaint}ms ago`}
                        <Show when={d.render.debouncerPending !== null}>
                          {" · rAF:"}
                          {d.render.debouncerPending ? "pending" : "idle"}
                        </Show>
                        <Show when={d.render.isPaused}> · paused</Show>
                        <Show when={d.render.syncOutput}> · sync2026</Show>
                      </span>
                    </div>
                    <Show when={d.scrollback !== null}>
                      <div class="pl-[9ch] text-[10px] text-fg-3/60 tabular-nums">
                        scrollback: {d.scrollback}
                        <Show when={d.atlas}>
                          {(a) => (
                            <span>
                              {" "}
                              · atlas: {a().w}×{a().h}
                            </span>
                          )}
                        </Show>
                        <Show when={d.bufferBytes}>
                          {(bb) => (
                            <span>
                              {" "}
                              · buf: {formatMB(bb().primary)}
                              <Show when={bb().alternate > 0}>
                                {" "}
                                (+alt {formatMB(bb().alternate)})
                              </Show>
                            </span>
                          )}
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Section>

        {/* Debug-only instrumentation for #591 (WebGL zombie-context leak).
            Remove this section when the leak is root-caused and fixed. */}
        <Section title="WebGL lifecycle">
          <div class="space-y-0.5">
            <Row label="Created">
              <span class="font-mono text-fg tabular-nums">
                {snapshot().webgl.totalCreated}
              </span>
            </Row>
            <Row label="Disposed">
              <span class="font-mono text-fg tabular-nums">
                {snapshot().webgl.disposed}
              </span>
            </Row>
            <Row label="In DOM">
              <span class="font-mono text-fg tabular-nums">
                {snapshot().webgl.aliveInDom}
              </span>
            </Row>
            <Row label="Zombies">
              <span
                class={`font-mono tabular-nums ${
                  snapshot().webgl.aliveDetached > 0
                    ? "text-danger font-semibold"
                    : "text-fg"
                }`}
              >
                {snapshot().webgl.aliveDetached}
              </span>
            </Row>
            <Row label="GCed">
              <span class="font-mono text-fg-3 tabular-nums">
                {snapshot().webgl.gced}
              </span>
            </Row>
            <Row label="Lost">
              <span class="font-mono text-fg-3 tabular-nums">
                {snapshot().webgl.contextsLost}
              </span>
            </Row>
          </div>
          <Show when={snapshot().webgl.aliveCanvases.length > 0}>
            <div class="mt-2 pt-2 border-t border-edge/50">
              <div class="text-[10px] text-fg-3/70 mb-1">Alive canvases</div>
              <div class="space-y-0.5 text-[10px] font-mono">
                <For each={snapshot().webgl.aliveCanvases}>
                  {(c) => (
                    <div class="flex items-baseline gap-2 whitespace-nowrap">
                      <span class="text-fg-3 tabular-nums w-[5ch] shrink-0">
                        #{c.canvasId}
                      </span>
                      <span
                        class={
                          c.isConnected
                            ? "text-fg-2 w-[9ch] shrink-0"
                            : "text-danger w-[9ch] shrink-0"
                        }
                      >
                        {c.isConnected ? "in-dom" : "detached"}
                      </span>
                      <span class="text-fg-2 tabular-nums">
                        {c.width}×{c.height}
                      </span>
                      <span class="text-fg-3">·</span>
                      <span class="text-fg-2 tabular-nums">
                        {formatMB(c.bytesEst)}
                      </span>
                      <Show when={c.contextLost}>
                        <span class="text-fg-3">·</span>
                        <span class="text-fg-3/70">ctx-lost</span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={snapshot().webgl.recentEvents.length > 0}>
            <div class="mt-2 pt-2 border-t border-edge/50">
              <div class="text-[10px] text-fg-3/70 mb-1">Recent events</div>
              <div class="space-y-0.5 text-[10px] font-mono">
                <For each={snapshot().webgl.recentEvents}>
                  {(ev) => (
                    <div class="flex items-baseline gap-2 whitespace-nowrap">
                      <span class="text-fg-3/60 tabular-nums shrink-0">
                        {new Date(ev.ts).toISOString().slice(11, 23)}
                      </span>
                      <span class="text-fg-3 tabular-nums w-[5ch] shrink-0">
                        #{ev.canvasId}
                      </span>
                      <span class="text-fg-2">
                        {ev.kind}
                        {ev.kind === "contextlost" && (
                          <span class="text-fg-3/70">
                            {" "}
                            (defaultPrevented={String(ev.defaultPrevented)})
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </Section>
      </div>
    </div>
  );
};

/** Diagnostic-info open-state — the component owns it. Opened from the
 *  command palette's Debug group. */
export const diagnosticDialog = createDisclosure();

const DiagnosticInfo: Component<{
  activeId: TerminalId | null;
}> = (props) => (
  <ModalDialog
    open={diagnosticDialog.open()}
    onOpenChange={diagnosticDialog.onOpenChange}
    refocusOnClose
    size="md"
  >
    <Dialog.Content>
      <DiagnosticInfoContent activeId={props.activeId} />
    </Dialog.Content>
  </ModalDialog>
);

export default DiagnosticInfo;
