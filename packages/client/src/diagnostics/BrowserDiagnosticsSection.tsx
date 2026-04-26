import type { Accessor, Component } from "solid-js";
import { Show } from "solid-js";
import Row from "../ui/Row";
import Section from "../ui/Section";
import type { DiagnosticSnapshot } from "./useDiagnosticSnapshot";

const BrowserDiagnosticsSection: Component<{
  snapshot: Accessor<DiagnosticSnapshot>;
}> = (props) => (
  <Section title="Browser" data-testid="diagnostic-browser">
    <div class="space-y-0.5">
      <Row label="Viewport">
        <span class="text-fg">{props.snapshot().session.viewport}</span>
      </Row>
      <Row label="WebGL 2">
        <span
          class={
            props.snapshot().browser.webgl2Supported ? "text-ok" : "text-danger"
          }
        >
          {props.snapshot().browser.webgl2Supported
            ? "available"
            : "unavailable"}
        </span>
      </Row>
      <Row label="DPR">
        <span class="font-mono text-fg-3">
          {props.snapshot().browser.devicePixelRatio}
        </span>
      </Row>
      <Show when={props.snapshot().session.jsHeap}>
        {(heap) => (
          <Row label="JS heap">
            <span class="font-mono text-fg">
              {heap().usedMB} / {heap().totalMB} MB
              <span class="text-fg-3/70"> (limit {heap().limitMB})</span>
            </span>
          </Row>
        )}
      </Show>
      <Row label="DOM">
        <span class="font-mono text-fg">
          {props.snapshot().session.domNodes}
        </span>
      </Row>
      <Row label="Canvases">
        <span class="font-mono text-fg">
          {props.snapshot().session.canvases}
        </span>
      </Row>
      <Row label="COI">
        <span
          class={
            props.snapshot().browser.crossOriginIsolated
              ? "text-ok"
              : "text-fg-3"
          }
        >
          {props.snapshot().browser.crossOriginIsolated ? "yes" : "no"}
        </span>
      </Row>
      <Row label="UA">
        <span class="font-mono text-fg-3 break-all">
          {props.snapshot().browser.userAgent}
        </span>
      </Row>
    </div>
  </Section>
);

export default BrowserDiagnosticsSection;
