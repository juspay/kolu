import type { Accessor, Component } from "solid-js";
import { For, Show } from "solid-js";
import Row from "../ui/Row";
import Section from "../ui/Section";
import { formatMB } from "./format";
import type { DiagnosticSnapshot } from "./useDiagnosticSnapshot";

function shortActiveId(snapshot: DiagnosticSnapshot): string {
  return snapshot.session.activeId?.slice(0, 8) ?? "—";
}

/** Xterm and WebGL lifecycle facts shown in the diagnostic info dialog. */
const XtermDiagnosticsSection: Component<{
  snapshot: Accessor<DiagnosticSnapshot>;
}> = (props) => (
  <Section title="Xterm" data-testid="diagnostic-xterm">
    <div class="space-y-0.5">
      <Row label="xterm.js">
        <span class="font-mono text-fg-3">
          {props.snapshot().browser.xtermVersion}
        </span>
      </Row>
      <Row label="Active">
        <span class="font-mono text-fg-3">
          {shortActiveId(props.snapshot())}
        </span>
      </Row>
      <Row label="Count">
        <span class="font-mono text-fg">
          {props.snapshot().session.terminalCount}
        </span>
      </Row>
    </div>

    <div class="mt-3 pt-2 border-t border-edge/50">
      <div class="text-[10px] text-fg-3/70 mb-1">Terminals</div>
    </div>
    <Show
      when={props.snapshot().terminals.length > 0}
      fallback={<div class="text-[11px] text-fg-3/60 italic">No terminals</div>}
    >
      <div class="space-y-1">
        <For each={props.snapshot().terminals}>
          {(d) => (
            <div class="text-[11px] font-mono space-y-0.5">
              <div class="grid grid-cols-[9ch_8ch_1fr_auto] items-baseline gap-3">
                <span class="text-fg-3/70">{d.id.slice(0, 8)}</span>
                <span class="text-fg-2 tabular-nums">
                  {d.cols}×{d.rows}
                </span>
                <span
                  class={d.renderer === "webgl" ? "text-accent" : "text-fg-2"}
                >
                  {d.renderer}
                </span>
                <Show when={props.snapshot().session.activeId === d.id}>
                  <span class="text-[10px] text-fg-3/70">active</span>
                </Show>
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

    <div class="mt-3 pt-2 border-t border-edge/50">
      <div class="text-[10px] text-fg-3/70 mb-1">WebGL lifecycle</div>
      <div class="space-y-0.5">
        <Row label="Created">
          <span class="font-mono text-fg tabular-nums">
            {props.snapshot().webgl.totalCreated}
          </span>
        </Row>
        <Row label="Disposed">
          <span class="font-mono text-fg tabular-nums">
            {props.snapshot().webgl.disposed}
          </span>
        </Row>
        <Row label="In DOM">
          <span class="font-mono text-fg tabular-nums">
            {props.snapshot().webgl.aliveInDom}
          </span>
        </Row>
        <Row label="Zombies">
          <span
            class={`font-mono tabular-nums ${
              props.snapshot().webgl.aliveDetached > 0
                ? "text-danger font-semibold"
                : "text-fg"
            }`}
          >
            {props.snapshot().webgl.aliveDetached}
          </span>
        </Row>
        <Row label="GCed">
          <span class="font-mono text-fg-3 tabular-nums">
            {props.snapshot().webgl.gced}
          </span>
        </Row>
        <Row label="Lost">
          <span class="font-mono text-fg-3 tabular-nums">
            {props.snapshot().webgl.contextsLost}
          </span>
        </Row>
      </div>
    </div>

    <Show when={props.snapshot().webgl.aliveCanvases.length > 0}>
      <div class="mt-2 pt-2 border-t border-edge/50">
        <div class="text-[10px] text-fg-3/70 mb-1">Alive canvases</div>
        <div class="space-y-0.5 text-[10px] font-mono">
          <For each={props.snapshot().webgl.aliveCanvases}>
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

    <details
      data-testid="webgl-recent-events"
      class="mt-2 pt-2 border-t border-edge/50 group"
    >
      <summary class="text-[10px] text-fg-3/70 cursor-pointer select-none list-none flex items-center justify-between gap-3">
        <span>Recent events</span>
        <span class="font-mono tabular-nums">
          {props.snapshot().webgl.recentEvents.length}
        </span>
      </summary>
      <Show
        when={props.snapshot().webgl.recentEvents.length > 0}
        fallback={
          <div class="mt-1 text-[10px] text-fg-3/60 italic">
            No recent events
          </div>
        }
      >
        <div class="mt-1 space-y-0.5 text-[10px] font-mono overflow-x-auto">
          <For each={props.snapshot().webgl.recentEvents}>
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
      </Show>
    </details>
  </Section>
);

export default XtermDiagnosticsSection;
