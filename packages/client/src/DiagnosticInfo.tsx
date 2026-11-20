import { runAction, type UiAction } from "./runAction";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import Dialog from "@corvu/dialog";
import { encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { useSurfaceApp } from "@kolu/surface-app/solid";
import type { KoluBuildInfo } from "kolu-common/surface";
import { attentionDiagnostic } from "./attention/attentionDiagnostics";
import CopyDiagnosticsButton from "./CopyDiagnosticsButton";
import WireDiagnosticsSection from "./WireDiagnosticsSection";
import PadiDiagnosticsSection, {
  createPadiDiagnosticsFetch,
} from "./PadiDiagnosticsSection";
import { frameClassOf, hostActiveIds } from "@kolu/padi-client/attention";
import { bindStatePip } from "@kolu/solid-dockrow/rowValues";
import { hostFrame } from "./attention/attentionMarks";
import { useAttentionFacts } from "./attention/useAttentionFacts";
import { serverProcessId, wsStatus } from "./rpc/rpc";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { activeHost } from "./wire";
import { PAINT_STALL_WARN_MS } from "@kolu/xterm-kit/solid";
import { getTerminalRefs } from "./terminal/terminalRefs";
import { getDiagnostics } from "./terminal/useTerminalDiagnostics";
import { webglLifecycleSnapshot } from "./terminal/webglTracker";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { createDisclosure } from "./ui/createDisclosure";
import DocLink from "./ui/DocLink";
import ModalDialog from "./ui/ModalDialog";
import { formatSize, readJsHeap } from "./ui/memory";
import Row from "./ui/Row";
import Section from "./ui/Section";
import { surface } from "./ui/Surface";
import {
  kavalMemoryDisplay,
  padiMemoryDisplay,
  serverRssBytes,
} from "./ui/useMemoryUsage";
import { layoutMode } from "./useMobile";

function rssFigure(
  d: { kind: "ok"; rssBytes: number } | { kind: "error" } | null,
): number | "error" | null {
  return d === null ? null : d.kind === "ok" ? d.rssBytes : "error";
}

/** WebGL2 support detection creates a throwaway canvas + WebGL context
 *  that lingers on a detached node until GC. Compute once at module load
 *  so re-opening this dialog doesn't burn one context per open — the exact
 *  zombie-context pattern this dialog exists to diagnose (#591). */
const WEBGL2_SUPPORTED = (() => {
  const canvas = document.createElement("canvas");
  return !!canvas.getContext("webgl2");
})();

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
  const store = useTerminalStore();
  const facts = useAttentionFacts();
  const pwa = useSurfaceApp<KoluBuildInfo>();
  const padiDiagnostics = createPadiDiagnosticsFetch();

  const attention = createMemo(() => {
    const encHost = encodeHostKey(activeHost());
    const urgency = hostFrame(encHost);
    const rows = store.terminalIds().map((id) => {
      const meta = store.getMetadata(id);
      if (!meta) return null;
      const attention = facts.attentionOf(encHost, id);
      const pip = bindStatePip({ meta, attention, unread: false });
      return attentionDiagnostic({
        id,
        meta,
        glyph: pip.glyph,
        pipVariant: pip.variant,
        motion: pip.motion,
        shellLive: pip.shellLive,
        attention,
      });
    });
    const terminals = rows.filter((r) => r !== null);
    const seen = new Set(terminals.map((t) => t.id));
    const uncounted = hostActiveIds(urgency)
      .filter((id: TerminalId) => !seen.has(id))
      .map((id: TerminalId) => ({ id, as: frameClassOf(urgency, id) }));
    return {
      host: encHost,
      hostLive: urgency.live,
      counts: {
        active: hostActiveIds(urgency).length,
        working: urgency.byClass.working.length,
        lingering: urgency.byClass.linger.length,
        asking: urgency.byClass.asking.length,
      },
      disagreements:
        terminals.filter((t) => t.disagreement !== null).length +
        uncounted.length,
      uncounted,
      terminals,
    };
  });

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
        serverRss: serverRssBytes() ?? null,
        padiRss: rssFigure(padiMemoryDisplay()),
        kavalRss: rssFigure(kavalMemoryDisplay()),
        domNodes: document.getElementsByTagName("*").length,
        canvases: webgl.totalDomCanvases,
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
          cols: d.term.cols,
          rows: d.term.rows,
          wantedCols: d.wanted?.cols ?? null,
          wantedRows: d.wanted?.rows ?? null,
          measured: d.wanted !== null,
          renderer: d.renderer,
          bufferLen,
          scrollback: bufferLen !== null ? bufferLen - d.term.rows : null,
          atlas: refs?.probes.webglAtlas() ?? null,
          bufferBytes: refs?.probes.bufferBytes() ?? null,
          scrollLock: d.scrollLock,
          scrollLockEvents: refs?.probes.scrollLockEvents() ?? [],
          render: {
            msSinceLastPaint: refs?.probes.msSinceLastPaint() ?? null,
            debouncerPending: refs?.probes.renderDebouncerPending() ?? null,
            isPaused: refs?.probes.isPaused() ?? null,
            syncOutput: refs?.probes.synchronizedOutput() ?? null,
          },
        };
      }),
      attention: attention(),
      webgl,
      padi: padiDiagnostics.state(),
    };
  });

  function copyJson(): UiAction {
    return Effect.suspend(() =>
      writeTextToClipboard(JSON.stringify(snapshot(), null, 2)),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => toast.success("Diagnostic info copied")),
      ),
      Effect.catch((err) =>
        Effect.sync(() => {
          console.error("Failed to copy diagnostic info:", err);
          toast.error(
            `Failed to copy diagnostic info: ${toError(err).message}`,
          );
        }),
      ),
    );
  }

  const chrome = surface({ portalled: true });

  return (
    <div
      class={`${chrome.class} overflow-hidden flex flex-col max-h-[80vh]`}
      style={chrome.style}
    >
      <div class="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-edge shrink-0">
        <Dialog.Label class="font-semibold text-fg text-sm">
          Diagnostic info
        </Dialog.Label>
        <div class="flex items-center gap-2">
          <DocLink
            slug="troubleshooting"
            class="text-[11px] text-accent hover:underline"
            data-testid="diagnostic-docs"
          >
            Docs →
          </DocLink>
          <CopyDiagnosticsButton serverBuild={pwa.server()} />
          <button
            type="button"
            onClick={() => runAction("copy diagnostic info", copyJson())}
            class="text-[11px] px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-fg-2 hover:text-fg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            Copy JSON
          </button>
        </div>
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
                    {heap().usedMiB} / {heap().totalMiB} MiB
                    <span class="text-fg-3/70">
                      {" "}
                      (limit {heap().limitMiB} MiB)
                    </span>
                  </span>
                </Row>
              )}
            </Show>
            <Show when={snapshot().session.serverRss}>
              {(rss) => (
                <Row label="Server RSS">
                  <span class="font-mono text-fg">{formatSize(rss())}</span>
                </Row>
              )}
            </Show>
            <Show when={snapshot().session.padiRss !== null}>
              <Row label="padi RSS">
                <span class="font-mono text-fg">
                  {(() => {
                    const rss = snapshot().session.padiRss;
                    return rss === "error"
                      ? "poll failed"
                      : formatSize(rss as number);
                  })()}
                </span>
              </Row>
            </Show>
            <Show when={snapshot().session.kavalRss !== null}>
              <Row label="kaval RSS">
                <span class="font-mono text-fg">
                  {(() => {
                    const rss = snapshot().session.kavalRss;
                    return rss === "error"
                      ? "poll failed"
                      : formatSize(rss as number);
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

        <Section title="Attention">
          <div class="text-[11px] font-mono space-y-1">
            <Row label="host counts">
              <span class="tabular-nums">
                {attention().counts.active} active ({attention().counts.working}{" "}
                working · {attention().counts.lingering} lingering) ·{" "}
                {attention().counts.asking} awaiting
                {attention().hostLive ? "" : " (host not live)"}
              </span>
            </Row>
            <Show
              when={attention().disagreements > 0}
              fallback={
                <div class="text-[10px] text-fg-3/60 italic">
                  paint and counts agree on every terminal this list can see
                </div>
              }
            >
              <div class="text-[10px] text-danger font-semibold">
                {attention().disagreements} disagreement(s) — details below
              </div>
            </Show>
            <For each={attention().uncounted}>
              {(u) => (
                <div class="border-l-2 border-danger pl-2 text-[10px] text-danger">
                  {u.id.slice(0, 8)} — padi counts this as{" "}
                  <span class="font-semibold">{u.as}</span>, but it has no row
                  here: the host count includes a terminal no visible surface
                  shows (a split child holds its own agent).
                </div>
              )}
            </For>
            <For each={attention().terminals}>
              {(t) => (
                <div
                  class="space-y-0.5 border-l-2 pl-2"
                  classList={{
                    "border-danger": t.disagreement !== null,
                    "border-edge/40": t.disagreement === null,
                  }}
                >
                  <div class="grid grid-cols-[9ch_1fr_auto] items-baseline gap-3">
                    <span class="text-fg-3/70">{t.id.slice(0, 8)}</span>
                    <span class="text-fg-2 truncate">{t.label}</span>
                    <span class="text-[10px] text-fg-3/70">
                      {t.agentKind ?? "no-agent"}/{t.agentState ?? "—"}
                    </span>
                  </div>
                  <div class="pl-[9ch] text-[10px] text-fg-3/80 tabular-nums">
                    pip={t.pipVariant}
                    {t.shellLive ? "+shellLive" : ""} glyph={t.glyph} live=
                    {String(t.isLive)} fin={String(t.isFinished)} busy=
                    {String(t.paintsBusy)} counted={String(t.countedActive)}
                    {t.spinnerInTitle ? " spinner=YES" : ""} padi=
                    {t.attentionClass}
                  </div>
                  <Show when={t.disagreement}>
                    {(msg) => (
                      <div class="pl-[9ch] text-[10px] text-danger">
                        {msg()}
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </For>
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
                              · buf: {formatSize(bb().primary)}
                              <Show when={bb().alternate > 0}>
                                {" "}
                                (+alt {formatSize(bb().alternate)})
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

        <WireDiagnosticsSection serverBuild={pwa.server()} />

        <PadiDiagnosticsSection fetch={padiDiagnostics} />

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
                        {formatSize(c.bytesEst)}
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
